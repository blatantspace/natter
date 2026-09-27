import path from "node:path";
import fs from "node:fs";
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, powerMonitor, protocol, shell } from "electron";
import { dataDir, loadIdentity, loadSettings, saveIdentity, saveSettings, type KeyPair } from "./config";
import * as groups from "./groups";
import { Engine } from "./engine";
import { scanSources, type LocalFile } from "./ingest";
import { fetchArtwork, searchMetadata } from "./metadata";
import type { AppState, Candidate, Identity, Kind, PostMeta, PublishInput, Settings, ShareDraft } from "../shared/types";

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
  const g = groups.activeGroup();
  return {
    identity,
    group: g ? groups.toInfo(g) : null,
    groups: groups.loadGroups().groups.map(groups.toInfo),
    members: engine?.memberList() ?? [],
    posts: engine?.postViews() ?? [],
    transfers: Object.fromEntries(engine?.transfers ?? []),
    settings,
    peers: engine?.peerCount() ?? 0,
    ready: !!engine,
  };
}

let pushTimer: NodeJS.Timeout | null = null;
function push() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
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
  const g = groups.activeGroup();
  if (!g || !identity || !keyPair) return push();
  const e = new Engine(dataDir("groups", g.id), g, identity, keyPair, () => settings);
  e.on("state", push);
  await e.start();
  engine = e;
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
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      sandbox: true,
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

function registerProtocol() {
  protocol.handle("qq", async (req) => {
    const url = new URL(req.url);
    const memberKey = url.hostname;
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
    const g = groups.createGroup(name);
    await startEngine();
    return groups.toInfo(g);
  });

  handle("joinGroup", async (invite: string) => {
    const g = groups.joinGroup(invite);
    await startEngine();
    return groups.toInfo(g);
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
    let artwork: { data: Buffer; ext: string; aspect?: number } | null = null;
    const cand: Candidate | null | undefined = input.candidate;
    if (cand?.artworkUrl) artwork = await fetchArtwork(cand.artworkUrl);
    if (!artwork && d.artworkFile && fs.existsSync(d.artworkFile)) {
      artwork = { data: fs.readFileSync(d.artworkFile), ext: path.extname(d.artworkFile).slice(1) || "jpg" };
    }
    if (artwork) artwork.aspect = imageAspect(artwork.data);
    const meta: PostMeta = { ...input.meta };
    if (cand) meta.source = { provider: cand.provider, id: cand.id, url: cand.url };
    const single = d.sources.length === 1 && fs.statSync(d.sources[0]).isDirectory();
    const localPath = single ? d.sources[0] : path.dirname(d.sources[0]);
    const postId = await e.publish({
      files: d.files,
      meta,
      note: input.note,
      artwork,
      localPath,
      onProgress: (bytes, total) => win?.webContents.send("publish-progress", { draftId: input.draftId, bytes, total, done: false }),
    });
    win?.webContents.send("publish-progress", { draftId: input.draftId, bytes: 1, total: 1, done: true, postId });
    fs.rmSync(d.workDir, { recursive: true, force: true });
    drafts.delete(input.draftId);
    return postId;
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
    engine?.changed();
    push();
    return settings;
  });

  handle("pickDownloadDir", async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ["openDirectory", "createDirectory"], defaultPath: settings.downloadDir });
    return r.canceled ? null : r.filePaths[0];
  });

  handle("copy", (text: string) => clipboard.writeText(text));
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
  await startEngine();
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
