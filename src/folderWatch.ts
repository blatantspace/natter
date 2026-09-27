type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
};

type PermissionCapableHandle = FileSystemDirectoryHandle & {
  queryPermission?: (desc?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (desc?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  values?: () => AsyncIterableIterator<FileSystemHandle>;
  entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
};

const IDB_NAME = "natter-folder-watch";
const IDB_STORE = "handles";
const SETTINGS_KEY = "natter.folderWatch.settings";
const SEEDED_KEY = "natter.folderWatch.seeded";
const BLACKLIST_KEY = "natter.folderWatch.blacklist";
const COMPLETE_AGE_MS = 4000;

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|mpeg|mpg)$/i;
const SKIP_EXT = /\.(part|crdownload|tmp|download|!qb|bc!)$/i;

export type FolderWatchSettings = {
  enabled: boolean;
  channelId: string;
  folderName: string;
};

export type FolderQueueItem = {
  key: string;
  name: string;
  size: number;
  status: "copying" | "queued" | "skipped";
  file?: File;
};

const pending = new Map<string, { size: number; hits: number }>();

export function supportsFolderWatch(): boolean {
  return typeof window !== "undefined" && typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function";
}

export function loadFolderWatchSettings(): FolderWatchSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as FolderWatchSettings) : null;
  } catch {
    return null;
  }
}

export function saveFolderWatchSettings(settings: FolderWatchSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function clearFolderWatchSettings() {
  localStorage.removeItem(SETTINGS_KEY);
  localStorage.removeItem(SEEDED_KEY);
  pending.clear();
}

export function loadSeededKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEDED_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(list);
  } catch {
    return new Set();
  }
}

export function saveSeededKeys(seen: Set<string>) {
  const list = [...seen];
  if (list.length > 2500) list.splice(0, list.length - 2500);
  localStorage.setItem(SEEDED_KEY, JSON.stringify(list));
}

export function loadBlacklist(): Set<string> {
  try {
    const raw = localStorage.getItem(BLACKLIST_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(list.map((name) => name.toLowerCase()));
  } catch {
    return new Set();
  }
}

export function saveBlacklist(names: Set<string>) {
  localStorage.setItem(BLACKLIST_KEY, JSON.stringify([...names]));
}

export function isBlacklisted(name: string): boolean {
  return loadBlacklist().has(name.toLowerCase());
}

export function blacklistVideo(name: string) {
  const next = loadBlacklist();
  next.add(name.toLowerCase());
  saveBlacklist(next);
}

export function isWatchableVideo(name: string): boolean {
  if (!name || name.startsWith(".")) return false;
  if (SKIP_EXT.test(name)) return false;
  return VIDEO_EXT.test(name);
}

export function fileFingerprint(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function looksComplete(file: File): boolean {
  return file.size > 0 && Date.now() - file.lastModified >= COMPLETE_AGE_MS;
}

function isSizeStable(key: string, size: number): boolean {
  const prev = pending.get(key);
  if (!prev || prev.size !== size) {
    pending.set(key, { size, hits: 1 });
    return false;
  }
  const hits = prev.hits + 1;
  pending.set(key, { size, hits });
  return hits >= 2;
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle) {
  const db = await openHandleDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(handle, "watch");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get("watch");
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearDirectoryHandle() {
  const db = await openHandleDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete("watch");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function* iterateFiles(dir: FileSystemDirectoryHandle): AsyncGenerator<FileSystemFileHandle> {
  const handle = dir as PermissionCapableHandle;
  if (typeof handle.values === "function") {
    for await (const entry of handle.values()) {
      if (entry.kind === "file") yield entry as FileSystemFileHandle;
    }
    return;
  }
  if (typeof handle.entries === "function") {
    for await (const [, entry] of handle.entries()) {
      if (entry.kind === "file") yield entry as FileSystemFileHandle;
    }
  }
}

async function ensureReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const capable = handle as PermissionCapableHandle;
  const opts = { mode: "read" as const };
  if (typeof capable.queryPermission === "function") {
    const current = await capable.queryPermission(opts);
    if (current === "granted") return true;
  }
  if (typeof capable.requestPermission === "function") {
    const next = await capable.requestPermission(opts);
    return next === "granted";
  }
  return true;
}

export async function pickWatchFolder(
  previousFolderName?: string | null
): Promise<{ handle: FileSystemDirectoryHandle; name: string } | null> {
  if (!supportsFolderWatch()) return null;
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) return null;
  const handle = await picker({ mode: "read" });
  await saveDirectoryHandle(handle);
  if (!previousFolderName || previousFolderName !== handle.name) {
    saveSeededKeys(new Set());
  }
  pending.clear();
  return { handle, name: handle.name };
}

export async function restoreWatchFolder(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await loadDirectoryHandle();
  if (!handle) return null;
  const ok = await ensureReadPermission(handle);
  return ok ? handle : null;
}

export async function stopWatchingFolder() {
  await clearDirectoryHandle();
  clearFolderWatchSettings();
}

export async function scanFolderQueue(dir: FileSystemDirectoryHandle): Promise<FolderQueueItem[]> {
  const seeded = loadSeededKeys();
  const blacklist = loadBlacklist();
  const items: FolderQueueItem[] = [];
  const present = new Set<string>();

  for await (const entry of iterateFiles(dir)) {
    if (!isWatchableVideo(entry.name)) continue;
    const file = await entry.getFile();
    const key = fileFingerprint(file);
    present.add(key);
    if (file.size <= 0) continue;
    if (blacklist.has(file.name.toLowerCase())) {
      pending.delete(key);
      items.push({ key, name: file.name, size: file.size, status: "skipped" });
      continue;
    }
    if (seeded.has(key)) continue;
    const ready = looksComplete(file) || isSizeStable(key, file.size);
    items.push({
      key,
      name: file.name,
      size: file.size,
      status: ready ? "queued" : "copying",
      file,
    });
  }

  for (const key of [...pending.keys()]) {
    if (!present.has(key)) pending.delete(key);
  }

  items.sort((a, b) => {
    const rank = { queued: 0, copying: 1, skipped: 2 };
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return a.name.localeCompare(b.name);
  });

  return items;
}

export function nextQueuedVideo(items: FolderQueueItem[]): FolderQueueItem | undefined {
  return items.find((item) => item.status === "queued" && item.file);
}

export function markVideoSeen(key: string) {
  const seen = loadSeededKeys();
  seen.add(key);
  saveSeededKeys(seen);
  pending.delete(key);
}

export function isUploadCancelled(err: unknown): boolean {
  return err instanceof Error && /cancel/i.test(err.message);
}
