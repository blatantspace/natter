import type { Candidate, PostMeta } from "./types";

const norm = (s: string) => s.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "");

export function applyCandidate(base: PostMeta, c: Candidate): PostMeta {
  return {
    ...base,
    kind: c.kind === "music" && base.kind === "audio" ? "music" : base.kind,
    title: c.title,
    subtitle: c.subtitle ?? base.subtitle,
    year: c.year ?? base.year,
    description: c.description ?? base.description,
    creators: c.creators ?? base.creators,
    genres: c.genres?.length ? c.genres : base.genres,
    extra: { ...(base.extra ?? {}), ...(c.extra ?? {}) },
  };
}

const overlaps = (a: string[] = [], b: string[] = []) => a.some((x) => b.some((y) => norm(x).includes(norm(y)) || norm(y).includes(norm(x))));

/** Loose picks the first plausible hit for a person to confirm; strict is for adding without anyone looking. */
export function closeMatch(guess: PostMeta, candidates: Candidate[], strict = false): Candidate | null {
  const g = norm(guess.title);
  const names = strict && guess.kind === "book" ? [g, ...(guess.creators ?? []).map(norm)] : [g];
  for (const c of candidates.slice(0, strict ? 3 : 1)) {
    const t = norm(c.title);
    if (t.length < 2) continue;
    if (!strict) {
      if (t.includes(g) || g.includes(t)) return c;
      continue;
    }
    if (!names.includes(t)) continue;
    if (guess.year && c.year && Math.abs(guess.year - c.year) > 1) continue;
    if ((guess.kind === "music" || guess.kind === "audio") && !overlaps(guess.creators, c.creators)) continue;
    if (guess.kind === "book" && c.provider !== "openlibrary") continue;
    return c;
  }
  return null;
}
