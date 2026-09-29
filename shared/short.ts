import type { FileEntry, Post } from "./types";

export const SHORT_MAX_SECONDS = 180;
const SHORT_MAX_BYTES = 400 * 1024 * 1024;
const PLAYABLE = /\.(mp4|m4v|mov|webm)$/i;

/** The clip to loop in the grid when a post is one short video, otherwise null. */
export function shortClip(post: Pick<Post, "files" | "totalSize">): FileEntry | null {
  const videos = post.files.filter((f) => f.kind === "video");
  if (videos.length !== 1 || post.totalSize > SHORT_MAX_BYTES) return null;
  const v = videos[0];
  const seconds = Number(v.tags?.duration);
  if (!seconds || seconds > SHORT_MAX_SECONDS || !PLAYABLE.test(v.path)) return null;
  return v;
}

export function clipLength(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
