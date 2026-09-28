import { useEffect, useRef, useState } from "react";
import type { Comment, Member, PostView, Transfer } from "../../shared/types";
import { api } from "../api";
import { artUrl, clockTime, formatBytes, KIND_LABEL, metaLine, timeAgo, UNKNOWN_MEMBER } from "../format";
import { Art, Avatar } from "./Bits";
import { IconChat, IconClose, IconDownload, IconExternal, IconFolder, IconKind, IconPlay, IconTrash, IconUsers } from "./Icons";
import { ACTION_LABEL, viewFor } from "../playable";

const REACTIONS = ["🔥", "❤️", "😂", "👀", "🙌"];

const PROVIDER_LABEL: Record<string, string> = {
  tmdb: "TMDB",
  tvmaze: "TVmaze",
  musicbrainz: "MusicBrainz",
  openlibrary: "Open Library",
  wikipedia: "Wikipedia",
};

export function DetailSheet({
  post,
  members,
  transfer,
  onClose,
  onError,
  onPlay,
  compact,
}: {
  post: PostView;
  members: Map<string, Member>;
  transfer?: Transfer;
  onClose: () => void;
  onError: (msg: string) => void;
  onPlay?: () => void;
  compact?: boolean;
}) {
  const playable = viewFor(post);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const me = [...members.values()].find((m) => m.you);
  const author = members.get(post.author) ?? UNKNOWN_MEMBER;
  const mine = author.you;
  const have = !!post.localPath;
  const busy = transfer && (transfer.state === "queued" || transfer.state === "downloading");
  const pct = transfer?.total ? Math.round((transfer.bytes / transfer.total) * 100) : 0;
  const holdersOnline = post.holders.filter((k) => members.get(k)?.online && !members.get(k)?.you).length;

  useEffect(() => {
    let live = true;
    void api.getComments(post.id).then((c) => {
      if (live) setComments(c);
    });
    void api.markRead(post.id);
    return () => {
      live = false;
    };
  }, [post.id, post.commentCount]);

  const seenCount = useRef<number | null>(null);
  useEffect(() => {
    if (seenCount.current !== null && comments.length > seenCount.current) chatEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    if (comments.length || seenCount.current !== null) seenCount.current = comments.length;
  }, [comments.length]);

  const run = (p: Promise<unknown>) => p.catch((e: Error) => onError(e.message));

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      await api.comment(post.id, text);
      setDraft("");
      setComments(await api.getComments(post.id));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const facts: [string, string][] = [];
  if (post.meta.creators?.length) facts.push([post.meta.kind === "music" ? "Artist" : post.meta.kind === "book" ? "Author" : "By", post.meta.creators.join(", ")]);
  for (const [k, v] of Object.entries(post.meta.extra ?? {})) {
    if (k === "files") continue;
    facts.push([k.charAt(0).toUpperCase() + k.slice(1), String(v)]);
  }
  facts.push(["Files", `${post.files.length} · ${formatBytes(post.totalSize)}`]);

  return (
    <aside className={`sheet${compact ? " compact" : ""}`} aria-label={post.meta.title}>
      <div className="sheet-head">
        <IconKind kind={post.meta.kind} size={14} />
        <strong style={{ fontSize: 13 }}>{KIND_LABEL[post.meta.kind]}</strong>
        <span className="faint" style={{ fontSize: 12 }}>
          shared by {author.you ? "you" : author.name} · {timeAgo(post.createdAt)}
        </span>
        <span className="grow" />
        <button className="btn small icon" onClick={onClose} aria-label="Close">
          <IconClose size={12} />
        </button>
      </div>

      <div className="sheet-scroll">
        <div className="hero">
          <Art src={artUrl(post.author, post.meta.artwork)} meta={post.meta} seed={post.id} />
          <div>
            <h2>{post.meta.title}</h2>
            <div className="sub">{metaLine(post.meta)}</div>
            <div className="pills">
              {(post.meta.genres ?? []).map((g) => (
                <span className="pill" key={g}>
                  {g}
                </span>
              ))}
              {post.meta.source?.url ? (
                <a className="pill" href={post.meta.source.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", gap: 4 }}>
                  {PROVIDER_LABEL[post.meta.source.provider] ?? post.meta.source.provider}
                  <IconExternal size={10} />
                </a>
              ) : null}
            </div>
            <div className="actions" style={{ marginTop: 14 }}>
              {have ? (
                <>
                  {playable && onPlay ? (
                    <button className="btn primary" onClick={onPlay}>
                      <IconPlay size={13} />
                      {ACTION_LABEL[playable.mode]}
                    </button>
                  ) : null}
                  <button className={`btn${playable && onPlay ? "" : " primary"}`} onClick={() => run(api.reveal(post.id))}>
                    <IconFolder size={14} />
                    Show in Finder
                  </button>
                </>
              ) : (
                <button className="btn primary" disabled={!!busy} onClick={() => run(api.download(post.id))}>
                  <IconDownload size={14} />
                  {busy ? (transfer?.state === "queued" ? (holdersOnline ? "Queued" : "Waiting for a friend") : `Getting it… ${pct}%`) : "Get a copy"}
                </button>
              )}
              {mine ? (
                <button
                  className="btn danger"
                  onClick={() => {
                    if (confirm(`Remove “${post.meta.title}” from the queueue? Friends who already have a copy keep theirs.`)) {
                      void run(api.deletePost(post.id).then(onClose));
                    }
                  }}
                >
                  <IconTrash size={14} />
                  Remove
                </button>
              ) : null}
            </div>
            {busy ? (
              <div className="transfer-bar">
                <div style={{ width: `${pct}%` }} />
              </div>
            ) : null}
            {!have && !holdersOnline && transfer?.state !== "downloading" ? (
              <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
                Nobody with a copy is online right now. {busy ? "It'll start" : "Tap it anyway and it'll start"} as soon as one of them is.
              </div>
            ) : null}
            {transfer?.state === "error" ? <div className="error-text" style={{ marginTop: 8 }}>{transfer.error}</div> : null}
          </div>
        </div>

        {post.note ? (
          <div className="section">
            <div className="note-card">
              <Avatar member={author} size={24} />
              <div>
                <strong style={{ fontSize: 13 }}>{author.you ? "You said" : `${author.name} says`}</strong>
                <div>{post.note}</div>
              </div>
            </div>
          </div>
        ) : null}

        {post.meta.description ? (
          <div className="section extra">
            <h3>About</h3>
            <p>{post.meta.description}</p>
          </div>
        ) : null}

        <div className="section extra">
          <h3>Details</h3>
          <dl className="facts">
            {facts.map(([k, v]) => (
              <FactRow key={k} k={k} v={v} />
            ))}
          </dl>
        </div>

        <div className="section extra">
          <h3>
            <IconUsers size={13} />
            Who has a copy · {post.holders.length}
          </h3>
          <div className="holders">
            {post.holders.map((k) => {
              const m = members.get(k) ?? UNKNOWN_MEMBER;
              return (
                <div className="holder" key={k}>
                  <Avatar member={m} size={22} showOnline />
                  <span>{m.you ? "You" : m.name}</span>
                  <span className="tag">{m === author ? "shared it" : m.you ? "your copy" : m.online ? "online" : "offline"}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="section extra">
          <h3>Files</h3>
          <div className="file-list">
            {post.files.map((f) =>
              have ? (
                <button className="file-row" key={f.path} onClick={() => run(api.openFile(post.id, f.path))} title="Open">
                  <IconKind kind={f.kind} size={13} />
                  <span className="name">{f.path}</span>
                  <span className="size">{formatBytes(f.size)}</span>
                </button>
              ) : (
                <div className="file-row" key={f.path}>
                  <IconKind kind={f.kind} size={13} />
                  <span className="name">{f.path}</span>
                  <span className="size">{formatBytes(f.size)}</span>
                </div>
              ),
            )}
          </div>
        </div>

        <div className="section">
          <div className="reactions">
            {REACTIONS.map((emoji) => {
              const r = post.reactions.find((x) => x.emoji === emoji);
              const on = !!(me && r?.authors.includes(me.key));
              const names = r?.authors.map((k) => members.get(k)?.name ?? "Someone").join(", ");
              return (
                <button key={emoji} className={`react-btn${on ? " mine" : ""}`} title={names} onClick={() => run(api.react(post.id, emoji))}>
                  {emoji}
                  {r?.authors.length ? <span className="n">{r.authors.length}</span> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="section" style={{ borderBottom: "none" }}>
          <h3>
            <IconChat size={13} />
            Chat · {comments.length}
          </h3>
          {comments.length ? (
            <div className="chat">
              {comments.map((c) => {
                const m = members.get(c.author) ?? UNKNOWN_MEMBER;
                return (
                  <div className="msg" key={c.id}>
                    <Avatar member={m} size={26} />
                    <div>
                      <div className="msg-head">
                        <strong>{m.you ? "You" : m.name}</strong>
                        <time>{clockTime(c.createdAt)}</time>
                      </div>
                      <div className="msg-text">{c.text}</div>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEnd} />
            </div>
          ) : (
            <p className="faint">No chat yet. Say what you think.</p>
          )}
        </div>
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className="textarea"
          rows={1}
          value={draft}
          placeholder={`Talk about ${post.meta.title}…`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="btn primary" type="submit" disabled={sending || !draft.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}

function FactRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
