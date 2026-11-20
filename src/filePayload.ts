import { Message } from "./lib";
import { downloadFileBytes, downloadMagnetPayload, parseMagnetURI } from "./swarm";

export const FILE_PAYLOAD_TYPE = "magnet";
export const AUTO_INLINE_MAX_BYTES = 8 * 1024 * 1024;

export type FilePayload = {
  t: typeof FILE_PAYLOAD_TYPE;
  v: 1 | 2;
  kind?: "file" | "uri";
  fileId?: string;
  infoHash?: string;
  magnet?: string;
  name: string;
  mime: string;
  size: number;
  iv?: string;
};

export type FileTransfer = {
  status: "idle" | "downloading" | "ready" | "error";
  progress: number;
  label?: string;
  error?: string;
};

export type SwarmPeer = {
  personId: string;
  displayName: string;
  color: string;
  role: "seed" | "leech";
  progress: number;
  fileId?: string | null;
  updatedAt: number;
};

export function serializeFilePayload(payload: FilePayload): string {
  return JSON.stringify(payload);
}

export function parseFilePayload(text: string): FilePayload | null {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const obj = JSON.parse(trimmed) as Partial<FilePayload>;
    if (!obj || obj.t !== FILE_PAYLOAD_TYPE || typeof obj.name !== "string") return null;

    if (obj.kind === "uri") {
      if (typeof obj.infoHash !== "string" || !obj.infoHash) return null;
      return {
        t: FILE_PAYLOAD_TYPE,
        v: 2,
        kind: "uri",
        infoHash: obj.infoHash,
        magnet: typeof obj.magnet === "string" ? obj.magnet : undefined,
        name: obj.name,
        mime: obj.mime || "application/x-bittorrent",
        size: typeof obj.size === "number" ? obj.size : 0,
      };
    }

    if (typeof obj.fileId !== "string" || typeof obj.size !== "number") {
      return null;
    }
    return {
      t: FILE_PAYLOAD_TYPE,
      v: obj.v === 2 ? 2 : 1,
      kind: "file",
      fileId: obj.fileId,
      infoHash: obj.infoHash || undefined,
      name: obj.name,
      mime: obj.mime || "application/octet-stream",
      size: obj.size,
      iv: typeof obj.iv === "string" ? obj.iv : undefined,
    };
  } catch {
    // not a file payload
  }
  return null;
}

export function isUriMagnet(msg: Message): boolean {
  return msg.filePayload?.kind === "uri" || Boolean(msg.infoHash && !msg.attachmentIv && !msg.attachmentId);
}

export function hasFileShare(msg: Message): boolean {
  return Boolean(msg.filePayload || msg.attachmentId || msg.infoHash);
}

export function libraryKey(msg: Message): string | null {
  if (msg.infoHash) return `hash:${msg.infoHash}`;
  if (msg.attachmentId) return msg.attachmentId;
  return null;
}

export function applyFilePayload(msg: Message, text: string): Message {
  const payload = parseFilePayload(text);
  if (!payload) {
    return { ...msg, decryptedBody: text };
  }
  return {
    ...msg,
    decryptedBody: "",
    attachmentId: payload.fileId || msg.attachmentId || null,
    attachmentName: payload.name,
    attachmentType: payload.mime,
    attachmentSize: payload.size,
    attachmentIv: payload.iv || null,
    infoHash: payload.infoHash || msg.infoHash || null,
    filePayload: payload,
  };
}

export function hydrateMessage(msg: Message, blobCache: Map<string, string>): Message {
  if (msg.deletedAt) {
    return {
      ...msg,
      decryptedBody: "",
      filePayload: null,
      attachmentId: null,
      attachmentName: null,
      attachmentType: null,
      attachmentSize: null,
      attachmentIv: null,
      infoHash: null,
      decryptedAttachmentUrl: undefined,
    };
  }
  const text = msg.body || "";

  const hydrated = applyFilePayload(msg, text);
  const keyId = libraryKey(hydrated);
  if (keyId && blobCache.has(keyId)) {
    hydrated.decryptedAttachmentUrl = blobCache.get(keyId);
  } else if (hydrated.attachmentId && blobCache.has(hydrated.attachmentId)) {
    hydrated.decryptedAttachmentUrl = blobCache.get(hydrated.attachmentId);
  }
  return hydrated;
}

export function shouldAutoInline(msg: Message): boolean {
  if (isUriMagnet(msg)) return false;
  const mime = msg.attachmentType || "";
  const size = msg.attachmentSize || 0;
  if (!mime.startsWith("image/") && !mime.startsWith("audio/")) return false;
  return size > 0 && size <= AUTO_INLINE_MAX_BYTES;
}

export function isInlineMedia(mime?: string | null): boolean {
  if (!mime) return false;
  return mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/");
}

export function fileIcon(mime?: string | null): string {
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  if (mime === "application/x-bittorrent") return "torrent";
  return "file";
}

export function namedFileFromBlob(blob: Blob, name: string, mime: string): File {
  return new File([blob], name, { type: mime || blob.type || "application/octet-stream", lastModified: Date.now() });
}

export function displayMessageText(msg: Message): string {
  if (msg.deletedAt) return "";
  if (msg.filePayload) return "";
  const text = msg.decryptedBody ?? msg.body ?? "";
  return text;
}

export async function fetchNamedFile(opts: {
  fileId: string;
  mime: string;
  name: string;
  infoHash?: string;
  onProgress?: (ratio: number, label: string) => void;
}): Promise<File> {
  opts.onProgress?.(0.02, "Fetching file…");
  const blob = await downloadFileBytes(opts.fileId, opts.infoHash, (ratio, label) => {
    opts.onProgress?.(Math.max(0.02, ratio), label);
  });
  opts.onProgress?.(1, "Ready");
  return namedFileFromBlob(blob, opts.name, opts.mime);
}

export function guessMimeFromName(name: string, fallback = "application/octet-stream"): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    mkv: "video/x-matroska",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    flac: "audio/flac",
    pdf: "application/pdf",
  };
  return map[ext] || fallback;
}

export async function fetchNamedMagnet(opts: {
  magnet: string;
  infoHash: string;
  name: string;
  mime?: string;
  onProgress?: (ratio: number, label: string) => void;
}): Promise<File> {
  opts.onProgress?.(0.02, "Joining swarm…");
  let blob: Blob;
  try {
    blob = await downloadMagnetPayload(opts.magnet, opts.infoHash, (ratio, label) => {
      opts.onProgress?.(Math.max(0.02, ratio), label);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/stalled|metadata|timed out/i.test(msg)) {
      throw new Error("No lounge seeds yet. Someone who already has the file needs to hit Get first.");
    }
    throw err instanceof Error ? err : new Error(msg);
  }
  const mime =
    (blob.type && blob.type !== "application/octet-stream" ? blob.type : "") ||
    opts.mime ||
    guessMimeFromName(opts.name);
  opts.onProgress?.(1, "Ready");
  const fileName = blob instanceof File && blob.name && blob.name !== "natter.bin" ? blob.name : opts.name;
  return namedFileFromBlob(blob, fileName, mime === "application/x-bittorrent" ? guessMimeFromName(fileName, mime) : mime);
}

export async function isMagnetLikeFile(file: File): Promise<boolean> {
  if (/\.(torrent|magnet)$/i.test(file.name)) return true;
  if (file.type === "application/x-bittorrent") return true;
  if (file.size > 0 && file.size < 8192) {
    const head = await file.slice(0, 80).text();
    if (parseMagnetURI(head)) return true;
  }
  return false;
}

export function uniqueChannelFiles(messages: Message[]): Message[] {
  return uniqueLibraryItems(messages);
}

export function uniqueLibraryItems(messages: Message[]): Message[] {
  const seen = new Set<string>();
  const files: Message[] = [];
  for (const msg of messages) {
    const key = libraryKey(msg);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    files.push(msg);
  }
  return files.sort((a, b) => b.createdAt - a.createdAt);
}
