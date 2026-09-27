import type { FileEntry, PostView } from "../shared/types";

export type ViewMode = "video" | "audio" | "images" | "pdf" | "epub" | "text";

const EXT: Record<ViewMode, string[]> = {
  video: ["mp4", "m4v", "mov", "webm", "mkv"],
  audio: ["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus"],
  images: ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp"],
  pdf: ["pdf"],
  epub: ["epub"],
  text: ["txt", "md"],
};

const ORDER: ViewMode[] = ["video", "audio", "images", "epub", "pdf", "text"];

export const extOf = (p: string) => p.split(".").pop()?.toLowerCase() ?? "";

const byName = (a: FileEntry, b: FileEntry) => {
  const ta = Number(a.tags?.track ?? NaN);
  const tb = Number(b.tags?.track ?? NaN);
  if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta - tb;
  return a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" });
};

export const DOC_MODES: ViewMode[] = ["epub", "pdf", "text"];

export function viewFor(post: PostView, skip: ViewMode[] = []): { mode: ViewMode; items: FileEntry[] } | null {
  const groups = new Map<ViewMode, FileEntry[]>();
  for (const f of post.files) {
    const mode = ORDER.find((m) => EXT[m].includes(extOf(f.path)));
    if (mode && skip.includes(mode)) continue;
    if (mode) groups.set(mode, [...(groups.get(mode) ?? []), f]);
  }
  const bytes = (m: ViewMode) => (groups.get(m) ?? []).reduce((n, f) => n + f.size, 0);
  const media = (["video", "audio", "images"] as ViewMode[]).filter((m) => groups.has(m)).sort((a, b) => bytes(b) - bytes(a));
  const mode = media[0] ?? DOC_MODES.find((m) => groups.has(m));
  if (!mode) return null;
  return { mode, items: [...groups.get(mode)!].sort(byName) };
}

export const ACTION_LABEL: Record<ViewMode, string> = {
  video: "Play",
  audio: "Play",
  images: "View",
  pdf: "Read",
  epub: "Read",
  text: "Read",
};

export const localSrc = (postId: string, filePath: string) =>
  `qq://local/${postId}/${filePath.split("/").map(encodeURIComponent).join("/")}`;

export function srtToVtt(srt: string): string {
  return (
    "WEBVTT\n\n" +
    srt
      .replace(/\r/g, "")
      .replace(/^\d+\n(?=\d{2}:\d{2})/gm, "")
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
  );
}

export const displayName = (f: FileEntry) => String(f.tags?.title ?? f.path.split("/").pop()!.replace(/\.[^.]+$/, ""));
