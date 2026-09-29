import { useEffect, useMemo, useState } from "react";
import type { BulkView, LibraryItem, SuggestedFolder } from "../../shared/types";
import { api } from "../api";
import { formatBytes } from "../format";
import { Modal } from "./Bits";
import { IconFolder, IconKind } from "./Icons";

type Step = "ask" | "scanning" | "review";

const EXAMPLES = "Movies you'd watch again, albums on repeat, books you keep recommending.";

export function FavouritesModal({
  groupName,
  items: initial,
  onClose,
  onShareOne,
  onError,
}: {
  groupName: string;
  items?: { paths: string[]; items: LibraryItem[] };
  onClose: () => void;
  onShareOne?: (paths: string[]) => void;
  onError: (msg: string) => void;
}) {
  const [step, setStep] = useState<Step>(initial ? "review" : "ask");
  const [folders, setFolders] = useState<SuggestedFolder[] | null>(null);
  const [items, setItems] = useState<LibraryItem[]>(initial?.items ?? []);
  const [picked, setPicked] = useState<Set<string>>(() => new Set((initial?.items ?? []).filter((i) => i.suggested).map((i) => i.path)));
  const [roots, setRoots] = useState<string[]>(initial?.paths ?? []);

  useEffect(() => {
    if (initial) return;
    void api.suggestFolders().then(setFolders, () => setFolders([]));
  }, [initial]);

  async function scan(paths: string[]) {
    if (!paths.length) return;
    setRoots(paths);
    setStep("scanning");
    try {
      const found = await api.scanLibrary(paths);
      setItems(found);
      setPicked(new Set(found.filter((i) => i.suggested).map((i) => i.path)));
      setStep("review");
    } catch (e) {
      onError((e as Error).message);
      setStep("ask");
    }
  }

  async function add() {
    const chosen = items.filter((i) => picked.has(i.path)).map((i) => i.paths);
    if (!chosen.length) return;
    try {
      await api.addLibrary(chosen);
      onClose();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  const toggle = (p: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const choosable = items.filter((i) => !i.already);
  const count = picked.size;
  const size = useMemo(() => items.filter((i) => picked.has(i.path)).reduce((n, i) => n + i.size, 0), [items, picked]);
  const already = items.length - choosable.length;
  const hidden = choosable.filter((i) => !i.suggested).length;

  return (
    <Modal
      title={step === "review" ? `Add favourites to ${groupName}` : "Got favourites?"}
      wide={step === "review"}
      onClose={onClose}
      footer={
        step === "review" ? (
          <>
            <span className="faint grow" style={{ fontSize: 12 }}>
              Nothing gets copied. Each one becomes a tile, and friends pull straight from your files.
            </span>
            {onShareOne && roots.length ? (
              <button className="btn" onClick={() => onShareOne(roots)}>
                Share as one thing
              </button>
            ) : null}
            <button className="btn primary" disabled={!count} onClick={() => void add()}>
              {count ? `Add ${count} favourite${count === 1 ? "" : "s"}` : "Pick some"}
            </button>
          </>
        ) : step === "ask" ? (
          <>
            <span className="grow" />
            <button className="btn" onClick={onClose}>
              Maybe later
            </button>
          </>
        ) : null
      }
    >
      {step === "ask" ? (
        <div className="fav-ask">
          <p className="muted" style={{ margin: 0 }}>
            Point queueue at a folder and it'll make a tile for each thing inside, artwork and all. {EXAMPLES}
          </p>
          <div className="fav-folders">
            {folders === null ? (
              <div className="loading-block" style={{ padding: 12 }}>
                <span className="spinner" />
                Peeking in your Movies and Music…
              </div>
            ) : (
              folders.map((f) => (
                <button key={f.path} className="fav-folder" onClick={() => void scan([f.path])}>
                  <IconFolder size={22} />
                  <span className="grow">
                    <strong>{f.label}</strong>
                    <span className="faint">
                      {f.count} thing{f.count === 1 ? "" : "s"} found
                    </span>
                  </span>
                  <span className="pill">Look</span>
                </button>
              ))
            )}
            <button className="fav-folder" onClick={() => void api.pickFolders().then(scan)}>
              <IconFolder size={22} />
              <span className="grow">
                <strong>Choose a folder…</strong>
                <span className="faint">An external drive, a Plex folder, anything</span>
              </span>
              <span className="pill">Pick</span>
            </button>
          </div>
        </div>
      ) : step === "scanning" ? (
        <div className="loading-block">
          <span className="spinner" />
          Looking for movies, albums and books…
        </div>
      ) : (
        <div className="fav-review">
          {items.length ? (
            <>
              <div className="row" style={{ fontSize: 13 }}>
                <span className="grow muted">
                  {choosable.length} found{already ? ` · ${already} already in` : ""}
                  {hidden ? ` · ${hidden} unticked because they look personal` : ""}
                  {count ? ` · ${formatBytes(size)} picked` : ""}
                </span>
                <button className="btn small" onClick={() => setPicked(new Set(choosable.map((i) => i.path)))}>
                  All
                </button>
                <button className="btn small" onClick={() => setPicked(new Set())}>
                  None
                </button>
              </div>
              <div className="file-list" style={{ maxHeight: 360 }}>
                {items.map((i) => (
                  <label key={i.path} className={`file-row fav-row${i.already ? " done" : ""}`} title={i.path}>
                    <input type="checkbox" checked={picked.has(i.path)} disabled={i.already} onChange={() => toggle(i.path)} />
                    <IconKind kind={i.kind} size={13} />
                    <span className="name">
                      {i.title}
                      {i.year ? <span className="faint"> · {i.year}</span> : null}
                    </span>
                    {i.already ? <span className="pill">already in</span> : <span className="size">{formatBytes(i.size)}</span>}
                  </label>
                ))}
              </div>
            </>
          ) : (
            <div className="loading-block" style={{ flexDirection: "column" }}>
              <strong>Nothing to add in there</strong>
              <span className="faint">queueue looks for movies, shows, albums and books.</span>
              <button className="btn" onClick={() => setStep("ask")}>
                Try another folder
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function BulkBar({ bulk }: { bulk: BulkView }) {
  const pct = bulk.total ? Math.round((bulk.done / bulk.total) * 100) : 0;
  return (
    <div className="bulk-bar" role="status">
      {bulk.running ? <span className="spinner" /> : null}
      <span className="grow">
        {bulk.running ? (
          <span>
            <strong>
              Adding favourites · {bulk.done} of {bulk.total}
            </strong>
            {bulk.current ? <span className="faint"> · {bulk.current}</span> : null}
          </span>
        ) : (
          <strong>
            Added {bulk.added} favourite{bulk.added === 1 ? "" : "s"}
            {bulk.failed ? <span className="faint"> · {bulk.failed} skipped</span> : null}
          </strong>
        )}
        {bulk.running ? (
          <span className="bulk-track">
            <span style={{ width: `${pct}%` }} />
          </span>
        ) : null}
      </span>
      <button className="btn small" onClick={() => void (bulk.running ? api.stopBulk() : api.dismissBulk())}>
        {bulk.running ? "Stop" : "OK"}
      </button>
    </div>
  );
}
