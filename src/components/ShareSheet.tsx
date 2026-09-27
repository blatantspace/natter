import { useEffect, useMemo, useState } from "react";
import type { Candidate, FileKind, Kind, PostMeta, PublishProgress, ShareDraft } from "../../shared/types";
import { api } from "../api";
import { ALL_KINDS, formatBytes, KIND_LABEL } from "../format";
import { Art, Modal } from "./Bits";
import { IconKind, IconSearch } from "./Icons";

type Phase = "scanning" | "review" | "publishing";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function applyCandidate(base: PostMeta, c: Candidate): PostMeta {
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

export function ShareSheet({
  paths,
  groupName,
  onClose,
  onPublished,
}: {
  paths: string[];
  groupName: string;
  onClose: () => void;
  onPublished: (postId: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("scanning");
  const [draft, setDraft] = useState<ShareDraft | null>(null);
  const [meta, setMeta] = useState<PostMeta | null>(null);
  const [note, setNote] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [artChoice, setArtChoice] = useState<"candidate" | "local">("candidate");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .prepareShare(paths)
      .then((d) => {
        if (!live) return;
        setDraft(d);
        setCandidates(d.candidates);
        setQuery(d.guess.title);
        const first = d.candidates[0];
        const close = first && norm(first.title).length > 1 && (norm(first.title).includes(norm(d.guess.title)) || norm(d.guess.title).includes(norm(first.title)));
        if (first && close) {
          setPicked(first);
          setMeta(applyCandidate(d.guess, first));
          setArtChoice(first.artworkUrl || !d.localArtwork ? "candidate" : "local");
        } else {
          setMeta(d.guess);
          setArtChoice("local");
        }
        setPhase("review");
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [paths]);

  useEffect(() => api.onPublishProgress((p) => draft && p.draftId === draft.draftId && setProgress(p)), [draft]);

  const kinds = useMemo(() => {
    const counts = new Map<FileKind, number>();
    for (const f of draft?.files ?? []) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [draft]);

  function pick(c: Candidate | null) {
    if (!draft || !meta) return;
    setPicked(c);
    if (c) {
      setMeta(applyCandidate(meta, c));
      setArtChoice(c.artworkUrl ? "candidate" : "local");
    } else setArtChoice("local");
  }

  async function search() {
    if (!draft || !meta) return;
    setSearching(true);
    try {
      setCandidates(await api.searchMetadata(draft.draftId, query, meta.kind, meta.year));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  async function publish() {
    if (!draft || !meta) return;
    setPhase("publishing");
    setError(null);
    try {
      const candidate = picked ? { ...picked, artworkUrl: artChoice === "candidate" ? picked.artworkUrl : undefined } : null;
      const id = await api.publish({ draftId: draft.draftId, meta, note, candidate });
      onPublished(id);
    } catch (e) {
      setError((e as Error).message);
      setPhase("review");
    }
  }

  const set = (patch: Partial<PostMeta>) => setMeta((m) => (m ? { ...m, ...patch } : m));
  const artSrc = artChoice === "candidate" && picked?.artworkUrl ? picked.artworkUrl : draft?.localArtwork;
  const pct = progress?.total ? Math.round((progress.bytes / progress.total) * 100) : 0;

  return (
    <Modal
      title={`Share with ${groupName}`}
      wide
      onClose={phase === "publishing" ? () => {} : onClose}
      footer={
        phase === "scanning" ? null : (
          <>
            {phase === "publishing" ? (
              <span className="muted grow" style={{ fontSize: 13 }}>
                Copying into your drive… {pct}% · {formatBytes(progress?.bytes ?? 0)} of {formatBytes(draft?.totalSize ?? 0)}
              </span>
            ) : (
              <span className="faint grow" style={{ fontSize: 12 }}>
                Friends get a real copy, straight from your Mac. Encrypted for this queueue only.
              </span>
            )}
            <button className="btn" onClick={onClose} disabled={phase === "publishing"}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => void publish()} disabled={phase !== "review" || !meta?.title.trim()}>
              {phase === "publishing" ? "Sharing…" : "Share it"}
            </button>
          </>
        )
      }
    >
      {error ? <div className="error-text">{error}</div> : null}
      {phase === "scanning" || !draft || !meta ? (
        error ? null : (
          <div className="loading-block">
            <span className="spinner" />
            Reading your files and looking up the details…
          </div>
        )
      ) : (
        <div className="share-grid">
          <div className="share-art">
            <Art src={artSrc} meta={meta} seed={draft.draftId} />
            {picked?.artworkUrl && draft.localArtwork ? (
              <div className="row" style={{ gap: 6 }}>
                <button className={`chip${artChoice === "candidate" ? " active" : ""}`} onClick={() => setArtChoice("candidate")}>
                  Found art
                </button>
                <button className={`chip${artChoice === "local" ? " active" : ""}`} onClick={() => setArtChoice("local")}>
                  From files
                </button>
              </div>
            ) : null}
            <div className="scan-summary">
              <span className="pill">
                {draft.files.length} file{draft.files.length === 1 ? "" : "s"}
              </span>
              <span className="pill">{formatBytes(draft.totalSize)}</span>
              {kinds.slice(0, 3).map(([k, n]) => (
                <span className="pill" key={k} style={{ gap: 4 }}>
                  <IconKind kind={k} size={11} />
                  {n}
                </span>
              ))}
            </div>
            <div className="file-list" style={{ maxHeight: 150 }}>
              {draft.files.slice(0, 80).map((f) => (
                <div className="file-row" key={f.path}>
                  <IconKind kind={f.kind} size={12} />
                  <span className="name" title={f.path}>
                    {f.path}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <div className="field">
              <span>Best match</span>
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void search();
                }}
              >
                <div className="search" style={{ margin: 0, maxWidth: "none" }}>
                  <IconSearch size={14} />
                  <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title" />
                </div>
                <button className="btn" type="submit" disabled={searching}>
                  {searching ? "Looking…" : "Search"}
                </button>
              </form>
              <div className="candidates">
                <button className={`cand${!picked ? " active" : ""}`} onClick={() => pick(null)}>
                  <span className="thumb">
                    <IconKind kind={meta.kind} size={22} />
                  </span>
                  <strong>Just my files</strong>
                  <span className="src">no lookup</span>
                </button>
                {candidates.map((c) => (
                  <button key={`${c.provider}:${c.id}`} className={`cand${picked?.id === c.id ? " active" : ""}`} onClick={() => pick(c)} title={c.description}>
                    <span className="thumb">{c.artworkUrl ? <img src={c.artworkUrl} alt="" loading="lazy" /> : <IconKind kind={c.kind} size={22} />}</span>
                    <strong>{c.title}</strong>
                    <span className="faint">{[c.year, c.subtitle].filter(Boolean).join(" · ")}</span>
                    <span className="src">{c.provider}</span>
                  </button>
                ))}
                {!candidates.length && !searching ? <span className="faint" style={{ fontSize: 13, alignSelf: "center" }}>No matches. Edit the details below.</span> : null}
              </div>
            </div>

            <div className="form-grid">
              <label className="field span-2">
                <span>Title</span>
                <input className="input" value={meta.title} onChange={(e) => set({ title: e.target.value })} />
              </label>
              <label className="field">
                <span>Kind</span>
                <select className="select" value={meta.kind} onChange={(e) => set({ kind: e.target.value as Kind })}>
                  {ALL_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Year</span>
                <input
                  className="input"
                  inputMode="numeric"
                  value={meta.year ?? ""}
                  onChange={(e) => set({ year: e.target.value ? Number(e.target.value.replace(/\D/g, "").slice(0, 4)) : undefined })}
                />
              </label>
              <label className="field span-2">
                <span>Subtitle</span>
                <input className="input" value={meta.subtitle ?? ""} placeholder="Artist, director, author, dates…" onChange={(e) => set({ subtitle: e.target.value || undefined })} />
              </label>
              <label className="field span-2">
                <span>Genres</span>
                <input
                  className="input"
                  value={(meta.genres ?? []).join(", ")}
                  placeholder="Comma separated"
                  onChange={(e) => set({ genres: e.target.value.split(",").map((g) => g.trim()).filter(Boolean) })}
                />
              </label>
              <label className="field span-2">
                <span>About</span>
                <textarea className="textarea" rows={3} value={meta.description ?? ""} onChange={(e) => set({ description: e.target.value || undefined })} />
              </label>
              <label className="field span-2">
                <span>Why your friends will like it</span>
                <textarea className="textarea" rows={2} value={note} maxLength={500} placeholder="Optional, shows on the tile" onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
