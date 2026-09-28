import type { Kind, Member, PostMeta } from "../shared/types";

export const KIND_LABEL: Record<Kind, string> = {
  movie: "Movie",
  tv: "TV",
  music: "Album",
  book: "Book",
  photos: "Photos",
  video: "Video",
  audio: "Audio",
  image: "Image",
  document: "Docs",
  software: "Software",
  mixed: "Bundle",
};

export const FILTERS: { id: string; label: string; kinds: Kind[] }[] = [
  { id: "watch", label: "Watch", kinds: ["movie", "tv", "video"] },
  { id: "listen", label: "Listen", kinds: ["music", "audio"] },
  { id: "read", label: "Read", kinds: ["book", "document"] },
  { id: "photos", label: "Photos", kinds: ["photos", "image"] },
  { id: "other", label: "Other", kinds: ["software", "mixed"] },
];

export const ALL_KINDS = Object.keys(KIND_LABEL) as Kind[];

export function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

export function clockTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
  return today ? time : `${d.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}, ${time}`;
}

const FALLBACK_TINTS = ["#f0e2a8", "#c5e4e0", "#e8c9b8", "#d6d0e8", "#cfe0c3", "#f2d0d0", "#d3e3ef"];

export function tintFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return FALLBACK_TINTS[h % FALLBACK_TINTS.length];
}

export function aspectFor(meta: PostMeta): number {
  if (meta.artworkAspect) return Math.min(1.9, Math.max(0.62, meta.artworkAspect));
  switch (meta.kind) {
    case "movie":
    case "tv":
    case "book":
      return 2 / 3;
    case "music":
    case "audio":
      return 1;
    case "photos":
    case "image":
      return 4 / 3;
    case "video":
      return 16 / 9;
    default:
      return 5 / 4;
  }
}

export function metaLine(meta: PostMeta): string {
  const year = meta.year && !meta.subtitle?.includes(String(meta.year)) ? meta.year : undefined;
  return [year, meta.subtitle].filter(Boolean).join(" · ");
}

export function memberMap(members: Member[]): Map<string, Member> {
  return new Map(members.flatMap((m) => m.keys.map((k) => [k, m] as const)));
}

export const UNKNOWN_MEMBER: Member = { key: "", keys: [], identity: "", name: "Someone", color: "#7a7468", online: false, you: false, owner: false };

export const artUrl = (author: string, artwork?: string) => (artwork ? `qq://${author}${artwork}` : undefined);
