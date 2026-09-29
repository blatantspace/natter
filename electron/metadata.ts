import type { Candidate, Kind } from "../shared/types";

const UA = "queueue/0.1.0 (peer-to-peer desktop app)";

const TMDB_GENRES: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
  14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 53: "Thriller",
  10752: "War", 37: "Western", 10759: "Action & Adventure", 10762: "Kids", 10765: "Sci-Fi & Fantasy", 10764: "Reality", 10768: "War & Politics",
};

async function getJson<T = any>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", ...headers }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

let mbNext = 0;
async function musicbrainz<T = any>(url: string): Promise<T> {
  const wait = Math.max(0, mbNext - Date.now());
  mbNext = Date.now() + wait + 1100;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  return getJson<T>(url);
}

const stripHtml = (s?: string | null) => (s ? s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : undefined);
const yearOf = (d?: string | null) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : undefined);
const q = encodeURIComponent;

async function tmdb(query: string, kind: "movie" | "tv", year: number | undefined, key: string): Promise<Candidate[]> {
  const yearParam = year ? (kind === "movie" ? `&year=${year}` : `&first_air_date_year=${year}`) : "";
  const j = await getJson(`https://api.themoviedb.org/3/search/${kind}?query=${q(query)}${yearParam}&api_key=${key}`);
  const list: Candidate[] = (j.results || []).slice(0, 6).map((r: any) => ({
    provider: "tmdb",
    id: `${kind}/${r.id}`,
    url: `https://www.themoviedb.org/${kind}/${r.id}`,
    kind,
    title: r.title || r.name,
    year: yearOf(r.release_date || r.first_air_date),
    description: r.overview || undefined,
    genres: (r.genre_ids || []).map((g: number) => TMDB_GENRES[g]).filter(Boolean).slice(0, 3),
    artworkUrl: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : undefined,
    extra: r.vote_average ? { rating: `${Number(r.vote_average).toFixed(1)} / 10` } : undefined,
  }));
  if (list[0]) {
    try {
      const d = await getJson(`https://api.themoviedb.org/3/${list[0].id}?append_to_response=credits&api_key=${key}`);
      const crew = d.credits?.crew || [];
      const directors = crew.filter((c: any) => c.job === "Director").map((c: any) => c.name);
      const creators = kind === "tv" ? (d.created_by || []).map((c: any) => c.name) : directors;
      if (creators.length) {
        list[0].creators = creators.slice(0, 3);
        list[0].subtitle = kind === "tv" ? `Created by ${creators[0]}` : `Directed by ${creators[0]}`;
      }
      const cast = (d.credits?.cast || []).slice(0, 4).map((c: any) => c.name);
      list[0].extra = { ...(list[0].extra || {}), ...(cast.length ? { starring: cast.join(", ") } : {}), ...(d.runtime ? { runtime: `${d.runtime} min` } : {}) };
      if (d.genres?.length) list[0].genres = d.genres.map((g: any) => g.name).slice(0, 3);
    } catch {
      // details are a bonus
    }
  }
  return list;
}

async function tvmaze(query: string): Promise<Candidate[]> {
  const j = await getJson<any[]>(`https://api.tvmaze.com/search/shows?q=${q(query)}`);
  return j.slice(0, 6).map(({ show: s }) => ({
    provider: "tvmaze",
    id: String(s.id),
    url: s.url,
    kind: "tv",
    title: s.name,
    subtitle: s.network?.name || s.webChannel?.name || undefined,
    year: yearOf(s.premiered),
    description: stripHtml(s.summary),
    genres: (s.genres || []).slice(0, 3),
    artworkUrl: s.image?.original || s.image?.medium,
    extra: s.rating?.average ? { rating: `${s.rating.average} / 10` } : undefined,
  }));
}

async function musicbrainzSearch(query: string, artist?: string): Promise<Candidate[]> {
  const parts = [`releasegroup:"${query.replace(/"/g, "")}"`];
  if (artist) parts.push(`artist:"${artist.replace(/"/g, "")}"`);
  const j = await musicbrainz(`https://musicbrainz.org/ws/2/release-group/?query=${q(parts.join(" AND "))}&fmt=json&limit=6`);
  return (j["release-groups"] || []).map((rg: any) => {
    const who = (rg["artist-credit"] || []).map((a: any) => a.name).join(", ");
    return {
      provider: "musicbrainz",
      id: rg.id,
      url: `https://musicbrainz.org/release-group/${rg.id}`,
      kind: "music",
      title: rg.title,
      subtitle: who || undefined,
      creators: who ? [who] : undefined,
      year: yearOf(rg["first-release-date"]),
      genres: (rg.tags || []).sort((a: any, b: any) => b.count - a.count).map((t: any) => t.name).slice(0, 3),
      artworkUrl: `https://coverartarchive.org/release-group/${rg.id}/front-500`,
      extra: rg["primary-type"] ? { type: rg["primary-type"] } : undefined,
    } satisfies Candidate;
  });
}

async function openLibrary(query: string, author?: string): Promise<Candidate[]> {
  const a = author ? `&author=${q(author)}` : "";
  const j = await getJson(`https://openlibrary.org/search.json?title=${q(query)}${a}&limit=6&fields=key,title,author_name,first_publish_year,cover_i,subject,number_of_pages_median`);
  const list: Candidate[] = (j.docs || []).map((d: any) => ({
    provider: "openlibrary",
    id: d.key,
    url: `https://openlibrary.org${d.key}`,
    kind: "book",
    title: d.title,
    subtitle: d.author_name?.[0],
    creators: d.author_name?.slice(0, 3),
    year: d.first_publish_year,
    genres: (d.subject || []).slice(0, 3),
    artworkUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : undefined,
    extra: d.number_of_pages_median ? { pages: d.number_of_pages_median } : undefined,
  }));
  if (list[0]) {
    try {
      const w = await getJson(`https://openlibrary.org${list[0].id}.json`);
      const desc = typeof w.description === "string" ? w.description : w.description?.value;
      if (desc) list[0].description = desc.split(/\n\s*\n/)[0].slice(0, 700);
    } catch {
      // optional
    }
  }
  return list;
}

async function wikipedia(query: string, kind: Kind): Promise<Candidate[]> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=6&gsrsearch=${q(query)}` +
    `&prop=pageimages|extracts|description|info&inprop=url&exintro=1&explaintext=1&exsentences=3&piprop=thumbnail&pithumbsize=700&pilicense=any`;
  const j = await getJson(url);
  const pages = Object.values<any>(j.query?.pages || {}).sort((a, b) => a.index - b.index);
  return pages.map((p) => ({
    provider: "wikipedia",
    id: String(p.pageid),
    url: p.fullurl,
    kind,
    title: p.title.replace(/\s*\((\d{4}\s+)?(\w+\s+)?(film|TV series|miniseries|album|novel|book|band)\)$/i, ""),
    subtitle: p.description,
    year: yearOf(p.description?.match(/\b(19|20)\d{2}\b/)?.[0]),
    description: p.extract || undefined,
    artworkUrl: p.thumbnail?.source,
  }));
}

export async function searchMetadata(opts: {
  query: string;
  kind: Kind;
  year?: number;
  creator?: string;
  tmdbKey?: string;
}): Promise<Candidate[]> {
  const { query, kind, year, creator, tmdbKey } = opts;
  if (!query.trim()) return [];
  const safe = async (p: Promise<Candidate[]>) => {
    try {
      return await p;
    } catch (err) {
      console.warn("[metadata]", (err as Error).message);
      return [];
    }
  };
  const pair = query.split(/\s+[-–]\s+/);
  if (pair.length === 2 && !creator && ["book", "document", "music", "audio"].includes(kind)) {
    const [a, b] = pair.map((s) => s.trim());
    const kindSearch = (title: string, who: string) =>
      kind === "book" || kind === "document" ? safe(openLibrary(title, who)) : safe(musicbrainzSearch(title, who));
    const first = await kindSearch(a, b);
    if (first.length) return first;
    const second = await kindSearch(b, a);
    if (second.length) return second;
  }
  let results: Candidate[] = [];
  switch (kind) {
    case "movie":
      results = tmdbKey ? await safe(tmdb(query, "movie", year, tmdbKey)) : [];
      if (!results.length) results = await safe(wikipedia(`${query} ${year ?? ""} film`, "movie"));
      break;
    case "tv":
      results = tmdbKey ? await safe(tmdb(query, "tv", year, tmdbKey)) : [];
      if (!results.length) results = await safe(tvmaze(query));
      break;
    case "music":
    case "audio":
      results = await safe(musicbrainzSearch(query, creator));
      if (!results.length && creator) results = await safe(musicbrainzSearch(query));
      break;
    case "book":
    case "document":
      results = await safe(openLibrary(query, creator));
      if (!results.length) results = await safe(wikipedia(query, kind));
      break;
    case "photos":
    case "image":
      return [];
    default:
      results = await safe(wikipedia(query, kind));
  }
  if (year) {
    results.sort((a, b) => Number(b.year === year) - Number(a.year === year));
  }
  return results;
}

export async function fetchArtwork(url: string): Promise<{ data: Buffer; ext: string } | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (!type.startsWith("image/")) return null;
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    return { data: Buffer.from(await res.arrayBuffer()), ext };
  } catch {
    return null;
  }
}
