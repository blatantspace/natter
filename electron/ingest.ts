import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseFile } from "music-metadata";
import exifr from "exifr";
import type { FileEntry, FileKind, Kind, PostMeta } from "../shared/types";

const run = promisify(execFile);

const EXT: Record<FileKind, string[]> = {
  video: ["mp4", "mkv", "mov", "avi", "m4v", "webm", "wmv", "flv", "ts", "mpg", "mpeg"],
  audio: ["mp3", "flac", "m4a", "aac", "wav", "ogg", "opus", "aiff", "aif", "alac", "wma"],
  image: ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "tif", "tiff", "bmp", "avif", "dng", "cr2", "cr3", "nef", "arw", "raf"],
  document: ["pdf", "epub", "mobi", "azw3", "txt", "md", "doc", "docx", "rtf", "cbz", "cbr", "djvu", "pages", "key", "numbers"],
  subtitle: ["srt", "vtt", "ass", "ssa", "sub", "idx"],
  archive: ["zip", "rar", "7z", "tar", "gz", "tgz", "dmg", "pkg", "iso"],
  other: [],
};

const MIME: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/mp4", mkv: "video/webm", webm: "video/webm", avi: "video/x-msvideo",
  mp3: "audio/mpeg", flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/opus", aiff: "audio/aiff",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic", avif: "image/avif", tif: "image/tiff", tiff: "image/tiff",
  pdf: "application/pdf", epub: "application/epub+zip", txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8", zip: "application/zip", srt: "text/plain", vtt: "text/vtt",
};

const BOOK_EXT = new Set(["epub", "mobi", "azw3", "cbz", "cbr", "djvu"]);

export interface LocalFile extends FileEntry {
  abs: string;
}

export interface Scan {
  files: LocalFile[];
  totalSize: number;
  guess: PostMeta;
  artworkFile?: string;
}

const ext = (p: string) => path.extname(p).slice(1).toLowerCase();

export function fileKind(p: string): FileKind {
  const e = ext(p);
  for (const [k, list] of Object.entries(EXT) as [FileKind, string[]][]) if (list.includes(e)) return k;
  return "other";
}

export const mimeFor = (p: string) => MIME[ext(p)] ?? "application/octet-stream";

function walk(abs: string, rel: string, out: LocalFile[]) {
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(abs).sort()) {
      if (name.startsWith(".")) continue;
      walk(path.join(abs, name), rel ? `${rel}/${name}` : name, out);
    }
  } else if (st.isFile()) {
    out.push({ abs, path: rel, size: st.size, kind: fileKind(abs), mime: mimeFor(abs) });
  }
}

export function listSources(sources: string[]): LocalFile[] {
  const out: LocalFile[] = [];
  if (sources.length === 1 && fs.statSync(sources[0]).isDirectory()) {
    walk(sources[0], "", out);
  } else {
    for (const s of sources) walk(s, path.basename(s), out);
  }
  return out;
}

const JUNK =
  /\b(2160p|1080p|720p|480p|4k|uhd|hdr10?|dv|bluray|blu-ray|brrip|bdrip|web-?dl|webrip|web|hdtv|dvdrip|x264|x265|h\.?264|h\.?265|hevc|aac\d?|ac3|dts|atmos|remux|proper|repack|extended|unrated|imax|10bit|yts|rarbg|flac|mp3|320|v0)\b.*$/i;
const EPISODE = /\b(s(\d{1,2})e(\d{1,3})|(\d{1,2})x(\d{2,3})|season\s*(\d{1,2}))\b/i;

export function cleanName(raw: string): { title: string; year?: number; season?: number; episode?: number } {
  let s = raw.replace(/\.[a-z0-9]{2,4}$/i, "");
  s = s.replace(/[._]+/g, " ").replace(/\[[^\]]*\]/g, " ").trim();
  let season: number | undefined;
  let episode: number | undefined;
  const ep = s.match(EPISODE);
  if (ep) {
    season = Number(ep[2] ?? ep[4] ?? ep[6]);
    episode = ep[3] ? Number(ep[3]) : ep[5] ? Number(ep[5]) : undefined;
    s = s.slice(0, ep.index).trim();
  }
  let year: number | undefined;
  const y = [...s.matchAll(/[([]?\b(19[2-9]\d|20[0-4]\d)\b[)\]]?/g)].filter((m) => m.index! > 0).pop();
  if (y) {
    year = Number(y[1]);
    s = s.slice(0, y.index).trim();
  }
  s = s.replace(JUNK, "").replace(/\([^)]*\)/g, " ").replace(/[-–\s]+$/g, "").replace(/\s+/g, " ").trim();
  return { title: s || raw, year, season, episode };
}

function which(bin: string): string | null {
  for (const dir of ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]) {
    const p = path.join(dir, bin);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function ffprobe(abs: string): Promise<Record<string, string | number>> {
  const bin = which("ffprobe");
  if (!bin) return {};
  try {
    const { stdout } = await run(bin, ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", abs], { timeout: 15000 });
    const j = JSON.parse(stdout);
    const v = (j.streams || []).find((s: { codec_type: string }) => s.codec_type === "video");
    const tags: Record<string, string | number> = {};
    if (j.format?.duration) tags.duration = Math.round(Number(j.format.duration));
    if (v?.width) tags.resolution = `${v.width}×${v.height}`;
    if (v?.codec_name) tags.codec = v.codec_name;
    if (j.format?.tags?.title) tags.title = j.format.tags.title;
    return tags;
  } catch {
    return {};
  }
}

async function videoFrame(abs: string, out: string, duration?: number): Promise<boolean> {
  const bin = which("ffmpeg");
  if (!bin) return false;
  const at = duration ? Math.max(1, Math.floor(duration * 0.12)) : 8;
  try {
    await run(bin, ["-y", "-ss", String(at), "-i", abs, "-frames:v", "1", "-vf", "scale=900:-2", "-q:v", "3", out], { timeout: 20000 });
    return fs.existsSync(out);
  } catch {
    return false;
  }
}

export async function thumbnail(abs: string, out: string, max = 1000): Promise<boolean> {
  try {
    await run("/usr/bin/sips", ["-s", "format", "jpeg", "-Z", String(max), abs, "--out", out], { timeout: 20000 });
    return fs.existsSync(out);
  } catch {
    return false;
  }
}

function dominant(files: LocalFile[]): FileKind {
  const bytes = new Map<FileKind, number>();
  const counts = new Map<FileKind, number>();
  for (const f of files) {
    if (f.kind === "subtitle" || f.kind === "other") continue;
    bytes.set(f.kind, (bytes.get(f.kind) ?? 0) + f.size);
    counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  }
  if (!bytes.size) return "other";
  const byBytes = [...bytes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const images = counts.get("image") ?? 0;
  if (images >= 5 && images > (counts.get("video") ?? 0) * 3) return "image";
  return byBytes;
}

const SEASON_DIR = /^(season|series|s)\s*\d{1,2}$/i;
const GENERIC_DIR = /^(music|media|itunes|itunes media|music\.localized|media\.localized|downloads|desktop|documents|albums?|compilations|unknown artist|various artists|tmp|private|volumes|users)$/i;

/** The name to read a title from: "Show/Season 1" reads as "Show Season 1", loose episodes read from the first file. */
export function sourceName(sources: string[]): string {
  const first = sources[0];
  const name = path.basename(first);
  if (sources.length === 1) return SEASON_DIR.test(name) ? `${path.basename(path.dirname(first))} ${name}` : name;
  if (sources.every((s) => EPISODE.test(path.basename(s)))) return name;
  return path.basename(path.dirname(first));
}

const fmtDate = (d: Date) => d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });

export async function scanSources(sources: string[], workDir: string): Promise<Scan> {
  const files = listSources(sources);
  if (!files.length) throw new Error("Nothing to share in there. Hidden files are skipped.");
  const totalSize = files.reduce((n, f) => n + f.size, 0);
  const base = cleanName(sourceName(sources));
  const main = dominant(files);
  fs.mkdirSync(workDir, { recursive: true });

  const guess: PostMeta = { kind: "mixed", title: base.title, year: base.year, extra: {} };
  let artworkFile: string | undefined;

  if (main === "video") {
    const videos = files.filter((f) => f.kind === "video").sort((a, b) => b.size - a.size);
    const episodic = videos.filter((v) => EPISODE.test(v.path)).length;
    const first = cleanName(path.basename(videos[0].path));
    const isTv = episodic >= 1 || base.season !== undefined || first.season !== undefined;
    guess.kind = isTv ? "tv" : base.year || first.year || videos.length === 1 ? "movie" : "video";
    if (sources.length === 1 && !fs.statSync(sources[0]).isDirectory()) Object.assign(guess, { title: first.title, year: first.year });
    if (isTv) {
      const season = base.season ?? first.season;
      if (season !== undefined) guess.subtitle = `Season ${season}`;
      guess.extra!.episodes = videos.length;
    }
    const tags = await ffprobe(videos[0].abs);
    videos[0].tags = tags;
    if (Number(tags.duration) >= 60) guess.extra!.runtime = `${Math.round(Number(tags.duration) / 60)} min`;
    if (tags.resolution) guess.extra!.resolution = tags.resolution;
    const frame = path.join(workDir, "frame.jpg");
    if (await videoFrame(videos[0].abs, frame, Number(tags.duration) || undefined)) artworkFile = frame;
  } else if (main === "audio") {
    const tracks = files.filter((f) => f.kind === "audio");
    const artists = new Map<string, number>();
    let album: string | undefined;
    let year: number | undefined;
    const genres = new Set<string>();
    let seconds = 0;
    for (const [i, t] of tracks.entries()) {
      try {
        const { common, format } = await parseFile(t.abs, { duration: i < 40, skipCovers: artworkFile !== undefined });
        t.tags = {};
        if (common.title) t.tags.title = common.title;
        if (common.artist) t.tags.artist = common.artist;
        if (common.track?.no) t.tags.track = common.track.no;
        if (format.duration) {
          t.tags.duration = Math.round(format.duration);
          seconds += format.duration;
        }
        const artist = common.albumartist || common.artist;
        if (artist) artists.set(artist, (artists.get(artist) ?? 0) + 1);
        album = album ?? common.album;
        year = year ?? common.year;
        common.genre?.forEach((g) => genres.add(g));
        const pic = common.picture?.[0];
        if (!artworkFile && pic) {
          const raw = path.join(workDir, `cover-raw.${pic.format.includes("png") ? "png" : "jpg"}`);
          fs.writeFileSync(raw, pic.data);
          const out = path.join(workDir, "cover.jpg");
          artworkFile = (await thumbnail(raw, out, 900)) ? out : raw;
        }
      } catch {
        // unreadable tags, keep going
      }
      if (i > 200) break;
    }
    const parent = sources.length === 1 && fs.statSync(sources[0]).isDirectory() ? path.basename(path.dirname(sources[0])) : "";
    const folderArtist = parent && !GENERIC_DIR.test(parent) ? parent : undefined;
    const artist = [...artists.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? folderArtist;
    guess.kind = tracks.length > 1 || album ? "music" : "audio";
    guess.title = album || (tracks.length === 1 ? String(tracks[0].tags?.title ?? base.title) : base.title);
    if (artist) {
      guess.subtitle = artist;
      guess.creators = [artist];
    }
    guess.year = year ?? base.year;
    if (genres.size) guess.genres = [...genres].slice(0, 4);
    guess.extra!.tracks = tracks.length;
    if (seconds >= 60) guess.extra!.length = `${Math.round(seconds / 60)} min`;
  } else if (main === "image") {
    const images = files.filter((f) => f.kind === "image");
    guess.kind = images.length > 1 ? "photos" : "image";
    const dates: Date[] = [];
    const cameras = new Set<string>();
    for (const img of images.slice(0, 60)) {
      try {
        const x = await exifr.parse(img.abs, ["DateTimeOriginal", "CreateDate", "Make", "Model", "latitude", "longitude"]);
        if (!x) continue;
        const d = x.DateTimeOriginal || x.CreateDate;
        if (d instanceof Date) dates.push(d);
        if (x.Model) cameras.add(String(x.Model).startsWith(String(x.Make ?? "")) ? x.Model : `${x.Make ?? ""} ${x.Model}`.trim());
        img.tags = {};
        if (d instanceof Date) img.tags.taken = d.toISOString();
        if (x.latitude) img.tags.gps = `${x.latitude.toFixed(4)}, ${x.longitude.toFixed(4)}`;
      } catch {
        // no exif
      }
    }
    guess.extra!.photos = images.length;
    if (dates.length) {
      dates.sort((a, b) => a.getTime() - b.getTime());
      const a = fmtDate(dates[0]);
      const b = fmtDate(dates[dates.length - 1]);
      guess.subtitle = a === b ? a : `${a} to ${b}`;
      guess.year = dates[0].getFullYear();
    }
    if (cameras.size) guess.extra!.camera = [...cameras].slice(0, 2).join(", ");
    const out = path.join(workDir, "cover.jpg");
    if (await thumbnail(images[0].abs, out)) artworkFile = out;
  } else if (main === "document") {
    const docs = files.filter((f) => f.kind === "document");
    const isBook = docs.some((d) => BOOK_EXT.has(ext(d.abs)));
    guess.kind = isBook ? "book" : "document";
    if (sources.length === 1 && docs.length === 1) {
      const n = cleanName(path.basename(docs[0].path));
      const [maybeAuthor, maybeTitle] = n.title.split(/\s+-\s+/);
      if (maybeTitle) {
        guess.title = maybeTitle;
        guess.subtitle = maybeAuthor;
        guess.creators = [maybeAuthor];
      } else guess.title = n.title;
    }
    guess.extra!.files = docs.length;
  } else if (main === "archive") {
    guess.kind = "software";
  }

  if (guess.kind === "mixed" || guess.kind === "document") guess.extra!.files = files.length;
  return { files, totalSize, guess, artworkFile };
}

export function kindLabel(kind: Kind): string {
  return { movie: "Movie", tv: "TV", music: "Album", book: "Book", photos: "Photos", video: "Video", audio: "Audio", image: "Image", document: "Docs", software: "Software", mixed: "Bundle" }[kind];
}
