import path from "node:path";
import fs from "node:fs";
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, Notification, powerMonitor, powerSaveBlocker, protocol, shell } from "electron";
import { dataDir, loadIdentity, loadSettings, saveIdentity, saveSettings, type KeyPair } from "./config";
import * as groups from "./groups";
import { Engine } from "./engine";
import { InviteJoiner } from "./joiner";
import { Readable } from "node:stream";
import { cleanName, mimeFor, scanSources, sourceName, type LocalFile } from "./ingest";
import { fetchArtwork, searchMetadata } from "./metadata";
import { findItems, suggestedFolders } from "./library";
import { applyCandidate, closeMatch } from "../shared/match";
import type { AppState, BulkView, Candidate, Identity, Kind, PostMeta, PublishInput, Settings, ShareDraft } from "../shared/types";

const profile = process.env.QUEUEUE_PROFILE;
if (profile) app.setPath("userData", path.join(app.getPath("appData"), `queueue-${profile}`));

protocol.registerSchemesAsPrivileged([
  { scheme: "qq", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
let identity: Identity | null = null;
let keyPair: KeyPair | null = null;
let settings: Settings = loadSettings();
let engine: Engine | null = null;
let joiner: InviteJoiner | null = null;
let notice: string | null = null;
let pendingLink: string | null = null;

interface Draft {
  sources: string[];
  files: LocalFile[];
  guess: PostMeta;
  artworkFile?: string;
  workDir: string;
}
const drafts = new Map<string, Draft>();

function state(): AppState {
  const me = identity?.publicKey ?? "";
  const g = groups.activeGroup(me);
  return {
    identity,
    group: g ? groups.toInfo(g, me) : null,
    groups: groups.loadGroups(me).groups.map((x) => groups.toInfo(x, me)),
    members: engine?.memberList() ?? [],
    posts: engine?.postViews() ?? [],
    transfers: Object.fromEntries(engine?.transfers ?? []),
    settings,
    peers: engine?.peerCount() ?? 0,
    ready: !!engine,
    invites: engine?.inviteViews() ?? [],
    joinRequests: engine?.joinRequests() ?? [],
    pendingJoin: joiner?.view ?? null,
    notice,
    bulk,
  };
}

let awakeId: number | null = null;
function keepAwakeWhileDownloading() {
  const busy = [...(engine?.transfers.values() ?? [])].some((t) => t.state === "downloading");
  if (busy && awakeId === null) awakeId = powerSaveBlocker.start("prevent-app-suspension");
  if (!busy && awakeId !== null) {
    powerSaveBlocker.stop(awakeId);
    awakeId = null;
  }
}

function applyLoginItem() {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.openAtLogin });
}

let pushTimer: NodeJS.Timeout | null = null;
function push() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    keepAwakeWhileDownloading();
    win?.webContents.send("state", state());
  }, 60);
}

async function startEngine() {
  if (engine) {
    const old = engine;
    engine = null;
    old.removeAllListeners();
    await old.stop();
  }
  const g = groups.activeGroup(identity?.publicKey);
  if (!g || !identity || !keyPair) return push();
  const e = new Engine(dataDir("groups", g.id), g, identity, keyPair, () => settings);
  e.on("state", push);
  e.on("epoch", ({ secret, removed }: { secret: string; removed: string[] }) => {
    groups.addEpoch(g.id, secret, removed);
    void startEngine();
  });
  e.on("removed", () => {
    groups.removeGroup(g.id);
    notice = `You're no longer in ${g.name}. Anything you already downloaded is still on your Mac.`;
    void startEngine();
  });
  e.on("join-request", (r: { name: string }) => {
    if (Notification.isSupported()) new Notification({ title: `${r.name} wants to join ${g.name}`, body: "Check the safety code with them before letting them in." }).show();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
    }
  });
  await e.start();
  engine = e;
  push();
}

async function startJoiner() {
  await joiner?.stop();
  joiner = null;
  const pending = groups.loadGroups().pending;
  if (!pending || !identity || !keyPair) return push();
  const j = new InviteJoiner(pending, keyPair, identity.name);
  j.on("update", push);
  j.on("welcome", async (welcome) => {
    groups.addJoinedGroup(welcome);
    await j.stop();
    if (joiner === j) joiner = null;
    await startEngine();
  });
  joiner = j;
  await j.start();
  push();
}

function knows(): (abs: string) => boolean {
  const known = engine?.knows() ?? (() => false);
  const downloads = settings.downloadDir;
  return (abs) => known(abs) || abs === downloads || abs.startsWith(downloads + path.sep);
}

async function publishDraft(
  e: Engine,
  d: Draft,
  input: PostMeta,
  cand: Candidate | null | undefined,
  note: string | undefined,
  onProgress: (bytes: number, total: number) => void,
): Promise<string> {
  let artwork: { data: Buffer; ext: string; aspect?: number } | null = null;
  if (cand?.artworkUrl) artwork = await fetchArtwork(cand.artworkUrl);
  if (!artwork && d.artworkFile && fs.existsSync(d.artworkFile)) {
    artwork = { data: fs.readFileSync(d.artworkFile), ext: path.extname(d.artworkFile).slice(1) || "jpg" };
  }
  if (artwork) artwork.aspect = imageAspect(artwork.data);
  const meta: PostMeta = { ...input };
  if (cand) meta.source = { provider: cand.provider, id: cand.id, url: cand.url };
  const single = d.sources.length === 1 && fs.statSync(d.sources[0]).isDirectory();
  const localPath = single ? d.sources[0] : path.dirname(d.sources[0]);
  try {
    return await e.publish({ files: d.files, meta, note, artwork, localPath, onProgress });
  } finally {
    fs.rmSync(d.workDir, { recursive: true, force: true });
  }
}

let bulk: BulkView | null = null;
let bulkQueue: string[][] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runBulk() {
  while (bulk && bulkQueue.length) {
    const src = bulkQueue.shift()!;
    const e = engine;
    if (!e) break;
    bulk.current = cleanName(sourceName(src)).title;
    push();
    const workDir = dataDir("drafts", `bulk-${Math.random().toString(36).slice(2, 10)}`);
    try {
      if (src.some(knows())) throw new Error("already shared");
      const scan = await scanSources(src, workDir);
      const g = scan.guess;
      const eitherOrder = g.kind === "book" && g.creators?.length;
      const candidates = await searchMetadata({
        query: eitherOrder ? `${g.creators![0]} - ${g.title}` : g.title,
        kind: g.kind,
        year: g.year,
        creator: eitherOrder ? undefined : g.creators?.[0],
        tmdbKey: settings.tmdbKey,
      }).catch(() => []);
      const cand = closeMatch(scan.guess, candidates, true);
      const meta = cand ? applyCandidate(scan.guess, cand) : scan.guess;
      await publishDraft(e, { sources: src, files: scan.files, guess: scan.guess, artworkFile: scan.artworkFile, workDir }, meta, cand, undefined, () => {});
      bulk.added++;
    } catch {
      bulk.failed++;
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    bulk.done++;
    push();
    await sleep(1100);
  }
  if (bulk) {
    bulk.running = false;
    bulk.current = undefined;
    bulk.total = bulk.done;
    if (bulk.added && Notification.isSupported() && !win?.isFocused()) {
      new Notification({ title: `Added ${bulk.added} favourite${bulk.added === 1 ? "" : "s"}`, body: "Your friends will see them next time they're online." }).show();
    }
  }
  push();
}

function requireEngine(): Engine {
  if (!engine) throw new Error("Join or create a queueue first.");
  return engine;
}

function handleLink(url: string) {
  if (!url.startsWith("queueue://")) return;
  if (win) {
    win.webContents.send("join-link", url);
    if (win.isMinimized()) win.restore();
    win.focus();
  } else pendingLink = url;
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleLink(url);
});

app.on("second-instance", (_e, argv) => {
  const link = argv.find((a) => a.startsWith("queueue://"));
  if (link) handleLink(link);
  else win?.focus();
});

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient("queueue", process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient("queueue");
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 860,
    minHeight: 600,
    title: profile ? `queueue (${profile})` : "queueue",
    backgroundColor: "#4a9a94",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      plugins: true,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.on("closed", () => {
    win = null;
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(import.meta.dirname, "../renderer/index.html"));
  win.webContents.on("did-finish-load", () => {
    if (pendingLink) {
      win?.webContents.send("join-link", pendingLink);
      pendingLink = null;
    }
  });
}

function serveLocal(req: Request, url: URL): Response {
  const [, postId, ...rest] = url.pathname.split("/");
  const dir = engine?.localPath(postId);
  if (!dir) return new Response(null, { status: 404 });
  const target = path.resolve(dir, rest.map(decodeURIComponent).join("/"));
  if (!target.startsWith(dir + path.sep) || !fs.existsSync(target)) return new Response(null, { status: 404 });
  const size = fs.statSync(target).size;
  const headers: Record<string, string> = { "content-type": mimeFor(target), "accept-ranges": "bytes" };
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const body = Readable.toWeb(fs.createReadStream(target, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
    });
  }
  const body = Readable.toWeb(fs.createReadStream(target)) as ReadableStream;
  return new Response(body, { headers: { ...headers, "content-length": String(size) } });
}

function registerProtocol() {
  protocol.handle("qq", async (req) => {
    const url = new URL(req.url);
    const memberKey = url.hostname;
    if (memberKey === "local") return serveLocal(req, url);
    const filePath = decodeURIComponent(url.pathname);
    if (url.searchParams.has("local")) {
      const draft = drafts.get(memberKey);
      if (draft?.artworkFile && fs.existsSync(draft.artworkFile)) {
        return new Response(fs.readFileSync(draft.artworkFile), { headers: { "content-type": "image/jpeg" } });
      }
      return new Response(null, { status: 404 });
    }
    const buf = await engine?.readFile(memberKey, filePath);
    if (!buf) return new Response(null, { status: 404 });
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return new Response(buf, { headers: { "content-type": type, "cache-control": "max-age=31536000, immutable" } });
  });
}

function imageAspect(data: Buffer): number | undefined {
  const img = nativeImage.createFromBuffer(data);
  const { width, height } = img.getSize();
  return width && height ? Math.round((width / height) * 1000) / 1000 : undefined;
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...(args as A)) };
    } catch (err) {
      console.error(`[ipc:${channel}]`, err);
      return { ok: false, error: (err as Error).message };
    }
  });
}

function registerIpc() {
  handle("getState", () => state());

  handle("setIdentity", async (name: string) => {
    const clean = name.trim().slice(0, 40);
    if (!clean) throw new Error("Pick a name first.");
    const saved = saveIdentity(clean);
    identity = saved.identity;
    keyPair = saved.keyPair;
    if (engine) engine.setIdentity(identity);
    else await startEngine();
    push();
    return identity;
  });

  handle("createGroup", async (name: string) => {
    if (!identity) throw new Error("Pick a name first.");
    const g = groups.createGroup(name, identity.publicKey);
    await startEngine();
    return groups.toInfo(g, identity.publicKey);
  });

  handle("joinGroup", async (invite: string) => {
    groups.setPending(groups.parseInvite(invite));
    await startJoiner();
  });

  handle("cancelJoin", async () => {
    groups.setPending(null);
    await startJoiner();
  });

  handle("createInvite", () => requireEngine().createInvite());
  handle("cancelInvite", (id: string) => requireEngine().cancelInvite(id));
  handle("answerJoin", (requestId: string, approve: boolean) => requireEngine().answerJoin(requestId, approve));
  handle("removeMember", (id: string) => requireEngine().removeMember(id));
  handle("dismissNotice", () => {
    notice = null;
    push();
  });

  handle("switchGroup", async (id: string) => {
    groups.setActive(id);
    await startEngine();
  });

  handle("leaveGroup", async (id: string) => {
    groups.removeGroup(id);
    await startEngine();
  });

  handle("pickSources", async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "Share with your queueue",
      buttonLabel: "Share",
      properties: ["openFile", "openDirectory", "multiSelections"],
    });
    return r.canceled ? [] : r.filePaths;
  });

  handle("prepareShare", async (paths: string[]): Promise<ShareDraft> => {
    const draftId = Math.random().toString(36).slice(2, 12);
    const workDir = dataDir("drafts", draftId);
    const scan = await scanSources(paths, workDir);
    drafts.set(draftId, { sources: paths, files: scan.files, guess: scan.guess, artworkFile: scan.artworkFile, workDir });
    const candidates = await searchMetadata({
      query: scan.guess.title,
      kind: scan.guess.kind,
      year: scan.guess.year,
      creator: scan.guess.creators?.[0],
      tmdbKey: settings.tmdbKey,
    });
    return {
      draftId,
      sources: paths,
      files: scan.files.map(({ abs: _abs, ...f }) => f),
      totalSize: scan.totalSize,
      guess: scan.guess,
      localArtwork: scan.artworkFile ? `qq://${draftId}/cover?local=1` : undefined,
      candidates,
    };
  });

  handle("searchMetadata", async (draftId: string, query: string, kind: Kind, year?: number) => {
    const d = drafts.get(draftId);
    return searchMetadata({ query, kind, year, creator: d?.guess.creators?.[0], tmdbKey: settings.tmdbKey });
  });

  handle("publish", async (input: PublishInput) => {
    const e = requireEngine();
    const d = drafts.get(input.draftId);
    if (!d) throw new Error("That share draft expired. Drop the files again.");
    const postId = await publishDraft(e, d, input.meta, input.candidate, input.note, (bytes, total) =>
      win?.webContents.send("publish-progress", { draftId: input.draftId, bytes, total, done: false }),
    );
    win?.webContents.send("publish-progress", { draftId: input.draftId, bytes: 1, total: 1, done: true, postId });
    drafts.delete(input.draftId);
    return postId;
  });

  handle("suggestFolders", () => suggestedFolders(knows()));
  handle("pickFolders", async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "Pick a folder of favourites",
      buttonLabel: "Look inside",
      properties: ["openDirectory", "multiSelections"],
    });
    return r.canceled ? [] : r.filePaths;
  });
  handle("scanLibrary", (paths: string[]) => findItems(paths, knows()));
  handle("addLibrary", (items: string[][]) => {
    requireEngine();
    if (bulk?.running) {
      bulkQueue.push(...items);
      bulk.total += items.length;
    } else {
      bulkQueue = [...items];
      bulk = { total: items.length, done: 0, added: 0, failed: 0, running: true };
      void runBulk();
    }
    push();
  });
  handle("stopBulk", () => {
    bulkQueue = [];
    if (bulk) bulk.total = bulk.done + (bulk.current ? 1 : 0);
    push();
  });
  handle("dismissBulk", () => {
    if (!bulk?.running) bulk = null;
    push();
  });

  handle("deletePost", (postId: string) => requireEngine().deletePost(postId));
  handle("comment", (postId: string, text: string) => requireEngine().comment(postId, text));
  handle("getComments", (postId: string) => requireEngine().commentsFor(postId));
  handle("react", (postId: string, emoji: string) => requireEngine().react(postId, emoji));
  handle("markRead", (postId: string) => requireEngine().markRead(postId));
  handle("download", (postId: string) => requireEngine().enqueueDownload(postId));

  handle("reveal", (postId: string) => {
    const e = requireEngine();
    const dir = e.localPath(postId);
    const post = e.findPost(postId);
    if (!dir || !post) throw new Error("Download it first.");
    const target = post.files.length === 1 ? path.join(dir, post.files[0].path) : dir;
    shell.showItemInFolder(fs.existsSync(target) ? target : dir);
  });

  handle("openFile", async (postId: string, rel: string) => {
    const dir = requireEngine().localPath(postId);
    if (!dir) throw new Error("Download it first.");
    const target = path.resolve(dir, rel);
    if (!target.startsWith(dir)) throw new Error("Bad path");
    const err = await shell.openPath(target);
    if (err) throw new Error(err);
  });

  handle("updateSettings", (patch: Partial<Settings>) => {
    settings = { ...settings, ...patch };
    saveSettings(settings);
    applyLoginItem();
    engine?.changed();
    push();
    return settings;
  });

  handle("pickDownloadDir", async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ["openDirectory", "createDirectory"], defaultPath: settings.downloadDir });
    return r.canceled ? null : r.filePaths[0];
  });

  handle("copy", (text: string) => clipboard.writeText(text));
  handle("inviteFromClipboard", async () => {
    const text = await clipboard.readText();
    try {
      groups.parseInvite(text);
      return text.trim();
    } catch {
      return null;
    }
  });
}

app.whenReady().then(async () => {
  const loaded = loadIdentity();
  if (loaded) {
    identity = loaded.identity;
    keyPair = loaded.keyPair;
  }
  registerProtocol();
  registerIpc();
  createWindow();
  const link = process.argv.find((a) => a.startsWith("queueue://"));
  if (link) pendingLink = link;
  powerMonitor.on("resume", () => engine?.refreshNow());
  if (app.isPackaged && !profile && !app.isInApplicationsFolder()) {
    const { response } = await dialog.showMessageBox({
      type: "question",
      buttons: ["Move to Applications", "Not now"],
      defaultId: 0,
      message: "Move queueue to your Applications folder?",
      detail: "That way it keeps running after you eject the download and starts up with your Mac.",
    });
    if (response === 0 && app.moveToApplicationsFolder()) return;
  }
  applyLoginItem();
  await startEngine();
  await startJoiner();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (!win) createWindow();
});

let quitting = false;
app.on("before-quit", (e) => {
  if (quitting || !engine) return;
  e.preventDefault();
  quitting = true;
  void engine.stop().finally(() => app.quit());
});
