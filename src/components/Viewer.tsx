import { useCallback, useEffect, useRef, useState } from "react";
import ePub, { type Book, type Rendition } from "epubjs";
import type { FileEntry, PostView } from "../../shared/types";
import { api } from "../api";
import { artUrl, metaLine } from "../format";
import { DOC_MODES, displayName, extOf, localSrc, srtToVtt, viewFor, type ViewMode } from "../playable";
import { Art } from "./Bits";
import { IconArrow, IconChat, IconExternal, IconFolder, IconKind } from "./Icons";

interface ViewProps {
  post: PostView;
  items: FileEntry[];
  index: number;
  setIndex: (i: number) => void;
  onFail: () => void;
}

export function Viewer({
  post,
  chatOpen,
  onToggleChat,
  onClose,
  onError,
}: {
  post: PostView;
  chatOpen: boolean;
  onToggleChat: () => void;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const [skip, setSkip] = useState<ViewMode[]>([]);
  const view = viewFor(post, skip);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const current = view?.items[index];

  useEffect(() => setFailed(false), [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !chatOpen) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, chatOpen]);

  const openExternally = () => {
    if (current) void api.openFile(post.id, current.path).catch((e: Error) => onError(e.message));
  };

  const mode = view?.mode;
  const onFail = useCallback(() => {
    if (mode && DOC_MODES.includes(mode) && viewFor(post, [...skip, mode])) {
      setSkip([...skip, mode]);
      setIndex(0);
    } else setFailed(true);
  }, [mode, post, skip]);
  const props: ViewProps | null = view ? { post, items: view.items, index, setIndex, onFail } : null;
  const body: Record<ViewMode, (p: ViewProps) => React.ReactElement> = {
    video: VideoView,
    audio: AudioView,
    images: ImagesView,
    pdf: PdfView,
    epub: EpubView,
    text: TextView,
  };
  const Body = view ? body[view.mode] : null;

  return (
    <section className="viewer" aria-label={`Viewing ${post.meta.title}`}>
      <div className="viewer-head">
        <button className="btn small" onClick={onClose} title="Back to the mosaic (Esc)">
          <IconArrow size={12} />
          Mosaic
        </button>
        <div className="grow viewer-title">
          <strong>{post.meta.title}</strong>
          <span className="faint">{current && view && view.items.length > 1 ? displayName(current) : metaLine(post.meta)}</span>
        </div>
        <button className="btn small" onClick={openExternally} title="Open with your usual Mac app">
          <IconExternal size={12} />
          Open in app
        </button>
        <button className="btn small icon" onClick={() => void api.reveal(post.id)} title="Show in Finder">
          <IconFolder size={13} />
        </button>
        <button className={`btn small${chatOpen ? " primary" : ""}`} onClick={onToggleChat}>
          <IconChat size={12} />
          Chat{post.commentCount ? ` · ${post.commentCount}` : ""}
        </button>
      </div>
      {!Body || !props ? (
        <Fallback post={post} message="queueue can't show this kind of file yet." onOpen={() => void api.reveal(post.id)} action="Show in Finder" />
      ) : failed ? (
        <Fallback post={post} message={`This ${extOf(current!.path).toUpperCase()} won't play inside queueue.`} onOpen={openExternally} action="Open in your Mac app" />
      ) : (
        <Body {...props} />
      )}
    </section>
  );
}

function Fallback({ post, message, onOpen, action }: { post: PostView; message: string; onOpen: () => void; action: string }) {
  return (
    <div className="viewer-fail">
      <div style={{ width: 160 }}>
        <Art src={artUrl(post.author, post.meta.artwork)} meta={post.meta} seed={post.id} />
      </div>
      <p>{message}</p>
      <button className="btn primary" onClick={onOpen}>
        {action}
      </button>
    </div>
  );
}

function Playlist({ items, index, setIndex, label }: { items: FileEntry[]; index: number; setIndex: (i: number) => void; label: string }) {
  if (items.length < 2) return null;
  return (
    <div className="playlist">
      <div className="playlist-head">
        {label} · {items.length}
      </div>
      {items.map((f, i) => (
        <button key={f.path} className={i === index ? "active" : ""} onClick={() => setIndex(i)}>
          <span className="num">{i + 1}</span>
          <span className="name">{displayName(f)}</span>
        </button>
      ))}
    </div>
  );
}

function useSubtitles(post: PostView) {
  const [tracks, setTracks] = useState<{ label: string; url: string }[]>([]);
  useEffect(() => {
    const subs = post.files.filter((f) => ["srt", "vtt"].includes(extOf(f.path)));
    const urls: string[] = [];
    let live = true;
    void Promise.all(
      subs.map(async (f) => {
        const text = await fetch(localSrc(post.id, f.path)).then((r) => r.text());
        const url = URL.createObjectURL(new Blob([extOf(f.path) === "srt" ? srtToVtt(text) : text], { type: "text/vtt" }));
        urls.push(url);
        const lang = f.path.match(/[._-]([a-z]{2,3})\.(srt|vtt)$/i)?.[1];
        return { label: lang ? lang.toUpperCase() : displayName(f), url };
      }),
    )
      .then((t) => live && setTracks(t))
      .catch(() => {});
    return () => {
      live = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [post.id, post.files]);
  return tracks;
}

function VideoView({ post, items, index, setIndex, onFail }: ViewProps) {
  const tracks = useSubtitles(post);
  const f = items[index];
  return (
    <div className="viewer-stage">
      <div className="video-wrap">
        <video
          key={f.path}
          src={localSrc(post.id, f.path)}
          controls
          autoPlay
          onError={onFail}
          onEnded={() => index < items.length - 1 && setIndex(index + 1)}
        >
          {tracks.map((t, i) => (
            <track key={t.url} kind="subtitles" label={t.label} src={t.url} default={i === 0} />
          ))}
        </video>
      </div>
      <Playlist items={items} index={index} setIndex={setIndex} label="Episodes" />
    </div>
  );
}

function AudioView({ post, items, index, setIndex, onFail }: ViewProps) {
  const f = items[index];
  return (
    <div className="viewer-stage column">
      <div className="audio-view">
        <div className="audio-art">
          <Art src={artUrl(post.author, post.meta.artwork)} meta={{ ...post.meta, artworkAspect: 1 }} seed={post.id} />
          <div>
            <div className="now-title">{displayName(f)}</div>
            <div className="faint">{[post.meta.subtitle, post.meta.title].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
        <div className="tracklist">
          {items.map((t, i) => (
            <button key={t.path} className={i === index ? "active" : ""} onClick={() => setIndex(i)}>
              <span className="num">{t.tags?.track ?? i + 1}</span>
              <span className="name">{displayName(t)}</span>
              <span className="dur">{t.tags?.duration ? fmtDuration(Number(t.tags.duration)) : ""}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="audio-bar">
        <audio key={f.path} src={localSrc(post.id, f.path)} controls autoPlay onError={onFail} onEnded={() => index < items.length - 1 && setIndex(index + 1)} />
      </div>
    </div>
  );
}

const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function ImagesView({ post, items, index, setIndex, onFail }: ViewProps) {
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setIndex(Math.min(items.length - 1, index + 1));
      if (e.key === "ArrowLeft") setIndex(Math.max(0, index - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, setIndex]);
  useEffect(() => {
    strip.current?.children[index]?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [index]);
  const f = items[index];
  return (
    <div className="viewer-stage column dark">
      <div className="gallery">
        <img key={f.path} src={localSrc(post.id, f.path)} alt={displayName(f)} onError={onFail} draggable={false} />
        {index > 0 ? (
          <button className="page-btn left" onClick={() => setIndex(index - 1)} aria-label="Previous">
            <IconArrow size={18} />
          </button>
        ) : null}
        {index < items.length - 1 ? (
          <button className="page-btn right" onClick={() => setIndex(index + 1)} aria-label="Next">
            <IconArrow dir="right" size={18} />
          </button>
        ) : null}
        <span className="gallery-count">
          {index + 1} / {items.length}
        </span>
      </div>
      {items.length > 1 ? (
        <div className="filmstrip" ref={strip}>
          {items.map((t, i) => (
            <button key={t.path} className={i === index ? "active" : ""} onClick={() => setIndex(i)}>
              <img src={localSrc(post.id, t.path)} alt="" loading="lazy" draggable={false} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PdfView({ post, items, index, setIndex }: ViewProps) {
  const f = items[index];
  return (
    <div className="viewer-stage">
      <iframe key={f.path} className="doc-frame" src={localSrc(post.id, f.path)} title={displayName(f)} />
      <Playlist items={items} index={index} setIndex={setIndex} label="Documents" />
    </div>
  );
}

function TextView({ post, items, index, setIndex, onFail }: ViewProps) {
  const [text, setText] = useState<string | null>(null);
  const f = items[index];
  useEffect(() => {
    let live = true;
    setText(null);
    fetch(localSrc(post.id, f.path))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => live && setText(t))
      .catch(() => live && onFail());
    return () => {
      live = false;
    };
  }, [post.id, f.path, onFail]);
  return (
    <div className="viewer-stage">
      <div className="reader">
        <article className="reader-col">
          <h1>{post.meta.title}</h1>
          {text ?? "Loading…"}
        </article>
      </div>
      <Playlist items={items} index={index} setIndex={setIndex} label="Files" />
    </div>
  );
}

function EpubView({ post, items, index, onFail }: ViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const rendition = useRef<Rendition | null>(null);
  const [where, setWhere] = useState("");
  const f = items[index];

  useEffect(() => {
    let book: Book | null = null;
    let live = true;
    (async () => {
      const buf = await fetch(localSrc(post.id, f.path)).then((r) => r.arrayBuffer());
      if (!live || !host.current) return;
      book = ePub(buf);
      await Promise.race([
        book.opened,
        new Promise((_, reject) => setTimeout(() => reject(new Error("epub did not open")), 5000)),
      ]);
      if (!live || !host.current) return;
      const r = book.renderTo(host.current, { width: "100%", height: "100%", flow: "paginated", spread: "auto" });
      r.themes.default({
        body: { "font-family": '"IBM Plex Serif", Georgia, serif', "line-height": "1.7", color: "#1c1a16" },
        p: { "font-size": "1.05em" },
      });
      r.on("relocated", (loc: { start: { displayed: { page: number; total: number } } }) => {
        const d = loc.start.displayed;
        setWhere(d?.total ? `Page ${d.page} of ${d.total} in this chapter` : "");
      });
      r.on("keyup", (e: KeyboardEvent) => {
        if (e.key === "ArrowRight") void r.next();
        if (e.key === "ArrowLeft") void r.prev();
      });
      rendition.current = r;
      await r.display();
    })().catch(() => live && onFail());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") void rendition.current?.next();
      if (e.key === "ArrowLeft") void rendition.current?.prev();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
      rendition.current = null;
      book?.destroy();
    };
  }, [post.id, f.path, onFail]);

  return (
    <div className="viewer-stage column">
      <div className="epub-stage">
        <div className="epub-host" ref={host} />
        <button className="page-btn left light" onClick={() => void rendition.current?.prev()} aria-label="Previous page">
          <IconArrow size={18} />
        </button>
        <button className="page-btn right light" onClick={() => void rendition.current?.next()} aria-label="Next page">
          <IconArrow dir="right" size={18} />
        </button>
      </div>
      <div className="reader-foot">
        <IconKind kind="book" size={12} />
        {where || "Use the arrow keys to turn pages"}
      </div>
    </div>
  );
}
