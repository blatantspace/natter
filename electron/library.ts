import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanName, fileKind, sourceName } from "./ingest";
import type { FileKind, LibraryItem, SuggestedFolder } from "../shared/types";

const EPISODE = /\b(s\d{1,2}e\d{1,3}|\d{1,2}x\d{2,3})\b/i;
const BOOK = /\.(epub|mobi|azw3|cbz|cbr|djvu|pdf)$/i;
const SKIP_DIR = /\.(app|photoslibrary|photolibrary|tvlibrary|musiclibrary|imovielibrary|fcpbundle|lrdata|bundle|framework)$/i;
const PERSONAL = /^(screen ?recording|screen ?shot|img[_-]|mvi[_-]|dsc[_-]?\d|vid[_-]|pxl[_-]|movie on |untitled)/i;
const EXTRA = /\b(sample|trailers?|teasers?|featurettes?|extras?|behind the scenes|deleted scenes|interviews?|bonus|subs|subtitles)\b/i;
const MAX_ITEMS = 600;
const MAX_ENTRIES = 40000;
const MAX_DEPTH = 6;

interface Entry {
  abs: string;
  name: string;
  dir: boolean;
  size: number;
  kind: FileKind;
}

class Budget {
  left = MAX_ENTRIES;
}

function entries(dir: string, budget: Budget): Entry[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  budget.left -= names.length;
  if (budget.left < 0) return [];
  const out: Entry[] = [];
  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    if (name.startsWith(".") || SKIP_DIR.test(name)) continue;
    const abs = path.join(dir, name);
    try {
      const st = fs.statSync(abs);
      if (st.isDirectory()) out.push({ abs, name, dir: true, size: 0, kind: "other" });
      else if (st.isFile()) out.push({ abs, name, dir: false, size: st.size, kind: fileKind(abs) });
    } catch {
      // unreadable, skip
    }
  }
  return out;
}

function sizeOf(abs: string, budget: Budget): number {
  let total = 0;
  const stack = [abs];
  while (stack.length && budget.left > 0) {
    for (const e of entries(stack.pop()!, budget)) {
      if (e.dir) stack.push(e.abs);
      else total += e.size;
    }
  }
  return total;
}

const FEATURE = 700 * 1024 * 1024;
const sum = (list: Entry[]) => list.reduce((n, f) => n + f.size, 0);

function makeItem(paths: string[], kind: LibraryItem["kind"], size: number, sure = false): LibraryItem {
  const base = path.basename(paths[0]);
  const { title, year, season } = cleanName(sourceName(paths));
  const likely = kind !== "video" || sure || !!year || size >= FEATURE;
  return {
    path: paths[0],
    paths,
    title: season !== undefined ? `${title} · Season ${season}` : title,
    year,
    kind,
    size,
    suggested: likely && !PERSONAL.test(base),
  };
}

/** What a folder is when it holds one thing (a movie, a season, an album, a photo set). */
function singleKind(list: Entry[], root: boolean): LibraryItem["kind"] | null {
  const files = list.filter((e) => !e.dir);
  const videos = files.filter((f) => f.kind === "video");
  const audio = files.filter((f) => f.kind === "audio");
  const images = files.filter((f) => f.kind === "image");
  const episodic = videos.filter((v) => EPISODE.test(v.name)).length;
  if (videos.length > 1 && episodic >= videos.length / 2) return "video";
  if (videos.length) {
    const biggest = Math.max(...videos.map((v) => v.size));
    const extrasOnly = videos.every((v) => v.size === biggest || EXTRA.test(v.name) || v.size < biggest * 0.03);
    return extrasOnly ? "video" : null;
  }
  if (audio.length >= 2) return "audio";
  if (images.length >= 5 && !root) return "image";
  return null;
}

function collect(dir: string, depth: number, budget: Budget, out: LibraryItem[]) {
  if (out.length >= MAX_ITEMS || depth > MAX_DEPTH) return;
  const list = entries(dir, budget);
  const single = singleKind(list, depth === 0);
  const subdirs = list.filter((e) => e.dir && !EXTRA.test(e.name));
  const subdirsHoldMedia = () => subdirs.some((d) => entries(d.abs, budget).some((e) => e.dir || e.kind === "video" || e.kind === "audio"));
  if (single && (!subdirs.length || !subdirsHoldMedia())) {
    const episodes = list.filter((e) => e.kind === "video" && EPISODE.test(e.name)).length;
    out.push(makeItem([dir], single, sizeOf(dir, budget), episodes > 1));
    return;
  }
  const seasons = new Map<string, Entry[]>();
  for (const e of list) {
    if (out.length >= MAX_ITEMS) return;
    if (e.dir) collect(e.abs, depth + 1, budget, out);
    else if (e.kind === "video" && EPISODE.test(e.name)) {
      const { title, season } = cleanName(e.name);
      const key = `${title.toLowerCase()}|${season}`;
      seasons.set(key, [...(seasons.get(key) ?? []), e]);
    } else if (e.kind === "video") out.push(makeItem([e.abs], "video", e.size));
    else if (e.kind === "document" && BOOK.test(e.name)) out.push(makeItem([e.abs], "document", e.size));
  }
  for (const eps of seasons.values()) {
    out.push(makeItem(eps.map((e) => e.abs), "video", sum(eps), true));
  }
}

export function findItems(roots: string[], skip: (abs: string) => boolean): LibraryItem[] {
  const budget = new Budget();
  const out: LibraryItem[] = [];
  for (const root of roots) {
    let st: fs.Stats;
    try {
      st = fs.statSync(root);
    } catch {
      continue;
    }
    if (st.isFile()) {
      const k = fileKind(root);
      if (k === "video" || k === "audio" || k === "document") out.push(makeItem([root], k, st.size, true));
    } else collect(root, 0, budget, out);
  }
  const seen = new Set<string>();
  return out
    .filter((i) => !seen.has(i.path) && seen.add(i.path))
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((i) => (i.paths.some(skip) ? { ...i, already: true, suggested: false } : i));
}

export function suggestedFolders(skip: (abs: string) => boolean): SuggestedFolder[] {
  const home = os.homedir();
  const out: SuggestedFolder[] = [];
  for (const [label, abs] of [
    ["Movies", path.join(home, "Movies")],
    ["Music", path.join(home, "Music")],
    ["Books", path.join(home, "Books")],
  ] as const) {
    if (!fs.existsSync(abs)) continue;
    const count = findItems([abs], skip).filter((i) => i.suggested).length;
    if (count) out.push({ label, path: abs, count });
  }
  return out;
}
