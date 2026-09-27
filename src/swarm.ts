type WebTorrentCtor = new (opts?: Record<string, unknown>) => WebTorrentClient;

type TorrentFile = {
  name: string;
  length?: number;
  blob: () => Promise<Blob>;
};

type TorrentHandle = {
  infoHash: string;
  name?: string;
  magnetURI: string;
  torrentFile: Uint8Array;
  done: boolean;
  progress: number;
  files: TorrentFile[];
  destroy: (opts?: { destroyStore?: boolean }, cb?: () => void) => void;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
};

type WebTorrentClient = {
  seed: (
    input: Blob | File | Blob[],
    opts: Record<string, unknown>,
    onseed?: (torrent: TorrentHandle) => void
  ) => TorrentHandle;
  add: (
    input: Uint8Array | string,
    opts: Record<string, unknown>,
    ontorrent?: (torrent: TorrentHandle) => void
  ) => TorrentHandle;
  get: (infoHash: string) => Promise<TorrentHandle | null>;
  destroy: (cb?: () => void) => void;
  torrents: TorrentHandle[];
};

declare global {
  interface Window {
    WebTorrent?: WebTorrentCtor;
  }
}

let clientPromise: Promise<WebTorrentClient | null> | null = null;
let client: WebTorrentClient | null = null;

export function getTrackerUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/tracker`;
}

export function getWebseedUrl(fileId: string): string {
  return `${location.origin}/api/files/${fileId}/raw`;
}

export function opaqueWireName(fileId: string): string {
  return `natter-${fileId}.bin`;
}

export function magnetURI(infoHash: string, fileId: string): string {
  const params = new URLSearchParams();
  params.set("xt", `urn:btih:${infoHash}`);
  params.set("tr", getTrackerUrl());
  params.set("ws", getWebseedUrl(fileId));
  return `magnet:?${params.toString()}`;
}

export function parseMagnetURI(raw: string): { infoHash: string; name?: string; magnet: string } | null {
  const first = String(raw || "").trim().split(/\s+/)[0];
  if (!/^magnet:\?/i.test(first)) return null;
  const xt =
    first.match(/xt=urn:btih:([a-fA-F0-9]{40})/i) ||
    first.match(/xt=urn:btih:([a-zA-Z2-7]{32})/i);
  if (!xt) return null;
  const infoHash = xt[1].toLowerCase();
  const dn = first.match(/[?&]dn=([^&]+)/i);
  let name: string | undefined;
  if (dn) {
    try {
      name = decodeURIComponent(dn[1].replace(/\+/g, " "));
    } catch {
      name = dn[1];
    }
  }
  return { infoHash, name, magnet: first };
}

export function loungeMagnet(uri: string): string {
  let stripped = uri
    .replace(/&dn=[^&]*/gi, "")
    .replace(/\?dn=[^&]*&/i, "?")
    .replace(/\?dn=[^&]*$/i, "");
  const tracker = getTrackerUrl();
  const encoded = encodeURIComponent(tracker);
  if (stripped.includes(tracker) || stripped.includes(encoded)) return stripped;
  const join = stripped.includes("?") ? "&" : "?";
  return `${stripped}${join}tr=${encoded}`;
}

async function loadWebTorrent(): Promise<WebTorrentCtor | null> {
  if (window.WebTorrent) return window.WebTorrent;
  const src = `${window.location.origin}/vendor/webtorrent.min.js`;
  const mod = await import(/* @vite-ignore */ src);
  const Ctor = (mod as { default?: WebTorrentCtor }).default;
  if (!Ctor) return null;
  window.WebTorrent = Ctor;
  return Ctor;
}

export async function getTorrentClient(): Promise<WebTorrentClient | null> {
  if (client) return client;
  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        const Ctor = await loadWebTorrent();
        if (!Ctor) return null;
        client = new Ctor({
          dht: false,
          lsd: false,
          webSeeds: true,
          tracker: { announce: [getTrackerUrl()] },
        });
        return client;
      } catch (err) {
        console.warn("WebTorrent unavailable, HTTP webseed only", err);
        return null;
      }
    })();
  }
  return clientPromise;
}

export async function seedCiphertext(
  blob: Blob,
  fileId: string,
  timeoutMs = 12000
): Promise<{ infoHash: string; torrentFile: Uint8Array } | null> {
  const wt = await getTorrentClient();
  if (!wt) return null;

  const seedPromise = new Promise<{ infoHash: string; torrentFile: Uint8Array }>((resolve, reject) => {
    try {
      const handle = wt.seed(
        blob,
        {
          name: opaqueWireName(fileId),
          announce: [getTrackerUrl()],
          urlList: [getWebseedUrl(fileId)],
          private: true,
          createdBy: "natter",
        },
        (torrent) => {
          const raw = torrent.torrentFile;
          const torrentFile = raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);
          resolve({ infoHash: torrent.infoHash, torrentFile });
        }
      );
      if (typeof handle?.on === "function") {
        handle.on("error", (err) => {
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      }
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });

  const timeout = new Promise<null>((resolve) => {
    window.setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    return await Promise.race([seedPromise, timeout]);
  } catch (err) {
    console.warn("Seed failed", err);
    return null;
  }
}

export async function uploadTorrentFile(
  fileId: string,
  torrentFile: Uint8Array,
  infoHash: string,
  uploaderId: string
): Promise<void> {
  const res = await fetch(`/api/files/${fileId}/torrent`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Info-Hash": infoHash,
      "X-Uploader-Id": uploaderId,
    },
    body: new Blob([torrentFile], { type: "application/octet-stream" }),
  });
  if (!res.ok) {
    throw new Error(`Failed to store torrent (${res.status})`);
  }
}

function findTorrent(wt: WebTorrentClient, infoHash: string): TorrentHandle | undefined {
  const needle = String(infoHash || "").toLowerCase();
  return wt.torrents.find((t) => String(t.infoHash || "").toLowerCase() === needle);
}

async function getExistingTorrent(wt: WebTorrentClient, infoHash: string): Promise<TorrentHandle | null> {
  const local = findTorrent(wt, infoHash);
  if (local) return local;
  try {
    const got = await wt.get(infoHash);
    return got || null;
  } catch {
    return findTorrent(wt, infoHash) || null;
  }
}

function onTorrentEvent(
  torrent: TorrentHandle,
  event: string,
  cb: (...args: unknown[]) => void
) {
  if (typeof torrent.on === "function") {
    torrent.on(event, cb);
    return;
  }
  throw new Error("WebTorrent handle is missing events");
}

function pickTorrentFile(torrent: TorrentHandle): TorrentFile {
  const files = torrent.files || [];
  if (!files.length) throw new Error("Torrent has no files");
  return files.reduce((best, file) => ((file.length || 0) > (best.length || 0) ? file : best), files[0]);
}

function addTorrent(
  wt: WebTorrentClient,
  input: Uint8Array | string,
  extraOpts: Record<string, unknown> = {},
  timeoutMs = 8000
): Promise<TorrentHandle> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err: Error | null, torrent?: TorrentHandle) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (err) reject(err);
      else if (torrent) resolve(torrent);
      else reject(new Error("Torrent add failed"));
    };
    const timer = window.setTimeout(() => {
      finish(new Error("Timed out waiting for torrent metadata"));
    }, timeoutMs);

    try {
      const handle = wt.add(
        input,
        { announce: [getTrackerUrl()], ...extraOpts },
        (torrent) => finish(null, torrent)
      );
      if (typeof handle?.on === "function") {
        handle.on("error", (err) => {
          finish(err instanceof Error ? err : new Error(String(err)));
        });
      }
    } catch (err) {
      finish(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

async function torrentToCipherBlob(
  torrent: TorrentHandle,
  onProgress?: (ratio: number, label: string) => void,
  stallMs = 8000
): Promise<Blob> {
  if (!torrent.done) {
    await new Promise<void>((resolve, reject) => {
      let lastBump = Date.now();
      const onDone = () => {
        window.clearInterval(watch);
        resolve();
      };
      const onError = (err: unknown) => {
        window.clearInterval(watch);
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      const watch = window.setInterval(() => {
        if (torrent.done) {
          onDone();
          return;
        }
        if (Date.now() - lastBump > stallMs) {
          window.clearInterval(watch);
          reject(new Error("Swarm stalled waiting for seeds"));
        }
      }, 400);
      try {
        onTorrentEvent(torrent, "done", onDone);
        onTorrentEvent(torrent, "error", onError);
        onTorrentEvent(torrent, "download", () => {
          lastBump = Date.now();
          onProgress?.(Math.min(0.8, torrent.progress * 0.8), "Swarm download…");
        });
      } catch (err) {
        window.clearInterval(watch);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
  return pickTorrentFile(torrent).blob();
}

export async function inspectTorrentInput(
  input: File | Uint8Array
): Promise<{ infoHash: string; name: string; torrentFile: Uint8Array } | null> {
  const wt = await getTorrentClient();
  if (!wt) return null;
  const buf = input instanceof File ? new Uint8Array(await input.arrayBuffer()) : input;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: { infoHash: string; name: string; torrentFile: Uint8Array } | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    try {
      const handle = wt.add(buf, { announce: [getTrackerUrl()] }, (torrent) => {
        const raw = torrent.torrentFile;
        const torrentFile = raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);
        finish({
          infoHash: torrent.infoHash,
          name: torrent.name || torrent.files[0]?.name || "Shared torrent",
          torrentFile,
        });
        try {
          torrent.destroy({ destroyStore: true });
        } catch {
          // ignore
        }
      });
      if (typeof handle?.on === "function") {
        handle.on("error", () => finish(null));
      }
      window.setTimeout(() => {
        try {
          handle.destroy({ destroyStore: true });
        } catch {
          // ignore
        }
        finish(null);
      }, 12000);
    } catch {
      finish(null);
    }
  });
}

export async function uploadMagnetTorrent(infoHash: string, torrentFile: Uint8Array): Promise<void> {
  const res = await fetch(`/api/magnets/${infoHash}/torrent`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Blob([torrentFile], { type: "application/x-bittorrent" }),
  });
  if (!res.ok) throw new Error(`Failed to store torrent (${res.status})`);
}

export async function downloadMagnetPayload(
  magnet: string,
  infoHash: string,
  onProgress?: (ratio: number, label: string) => void
): Promise<Blob> {
  const wt = await getTorrentClient();
  if (!wt) throw new Error("WebTorrent unavailable in this browser");

  onProgress?.(0.03, "Looking for lounge seeds…");
  const existing = await getExistingTorrent(wt, infoHash);
  if (existing) {
    return torrentToCipherBlob(existing, onProgress, existing.done ? 1000 : 30000);
  }

  try {
    const torrentRes = await fetch(`/api/magnets/${infoHash}/torrent`);
    if (torrentRes.ok) {
      const buf = new Uint8Array(await torrentRes.arrayBuffer());
      const added = await addTorrent(wt, buf, {}, 8000);
      return torrentToCipherBlob(added, onProgress, 30000);
    }
  } catch (err) {
    console.warn("Stored torrent missing, using magnet URI", err);
  }

  onProgress?.(0.04, "Waiting for torrent metadata…");
  const added = await addTorrent(wt, loungeMagnet(magnet), {}, 15000);
  return torrentToCipherBlob(added, onProgress, 30000);
}

export async function downloadCiphertext(
  fileId: string,
  infoHash?: string,
  onProgress?: (ratio: number, label: string) => void
): Promise<Blob> {
  const http = downloadViaHttp(fileId, onProgress);

  if (!infoHash) return http;

  const swarm = (async () => {
    const wt = await getTorrentClient();
    if (!wt) return null;
    const existing = await getExistingTorrent(wt, infoHash);
    if (existing?.done) return torrentToCipherBlob(existing, onProgress, 1000);
    if (existing) return torrentToCipherBlob(existing, onProgress, 4000);

    const torrentRes = await fetch(`/api/files/${fileId}/torrent`);
    if (!torrentRes.ok) return null;
    const buf = new Uint8Array(await torrentRes.arrayBuffer());
    const added = await addTorrent(
      wt,
      buf,
      { urlList: [getWebseedUrl(fileId)] },
      4000
    );
    return torrentToCipherBlob(added, onProgress, 4000);
  })().catch((err) => {
    console.warn("Magnet download failed, falling back to webseed", err);
    return null;
  });

  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    let httpErr: unknown = null;
    let swarmDone = false;
    const finish = (blob: Blob) => {
      if (settled) return;
      settled = true;
      resolve(blob);
    };
    const failIfBoth = () => {
      if (settled || !swarmDone || httpErr === null) return;
      settled = true;
      reject(httpErr instanceof Error ? httpErr : new Error(String(httpErr)));
    };
    swarm.then((blob) => {
      swarmDone = true;
      if (blob) finish(blob);
      else failIfBoth();
    });
    http.then(finish, (err) => {
      httpErr = err;
      failIfBoth();
    });
  });
}

async function downloadViaHttp(
  fileId: string,
  onProgress?: (ratio: number, label: string) => void
): Promise<Blob> {
  const res = await fetch(`/api/files/${fileId}/raw`);
  if (!res.ok) throw new Error(`Encrypted file not found (${res.status})`);
  const total = Number(res.headers.get("content-length") || 0);
  if (!res.body || !total) {
    const buf = await res.arrayBuffer();
    onProgress?.(0.8, "Webseed complete");
    return new Blob([buf], { type: "application/octet-stream" });
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      onProgress?.(Math.min(0.8, (received / total) * 0.8), "Webseed…");
    }
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([out], { type: "application/octet-stream" });
}

export function destroyTorrentClient() {
  try {
    client?.destroy();
  } catch {
    // ignore
  }
  client = null;
  clientPromise = null;
}
