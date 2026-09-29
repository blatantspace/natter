import { useEffect, useRef, useState } from "react";
import type { Member, PostView, Transfer } from "../../shared/types";
import { clipLength, shortClip } from "../../shared/short";
import { artUrl, KIND_LABEL, metaLine, timeAgo, UNKNOWN_MEMBER } from "../format";
import { Art, Avatar, AvatarStack } from "./Bits";
import { IconChat, IconCheck, IconKind, IconPlay } from "./Icons";
import { localSrc, viewFor } from "../playable";

/** Muted loop that only decodes while at least half the tile is on screen. */
function LoopingClip({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) void v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.5 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);
  if (failed) return null;
  return <video ref={ref} className="tile-clip" src={src} muted loop playsInline preload="metadata" onError={() => setFailed(true)} />;
}

export function Tile({
  post,
  members,
  transfer,
  selected,
  autoplay,
  onOpen,
}: {
  post: PostView;
  members: Map<string, Member>;
  transfer?: Transfer;
  selected: boolean;
  autoplay: boolean;
  onOpen: () => void;
}) {
  const author = members.get(post.author) ?? UNKNOWN_MEMBER;
  const holders = post.holders.map((k) => members.get(k) ?? UNKNOWN_MEMBER).filter((m) => m !== author);
  const me = [...members.values()].find((m) => m.you);
  const have = !!post.localPath || (me && post.holders.includes(me.key));
  const downloading = transfer && (transfer.state === "downloading" || transfer.state === "queued");
  const pct = transfer && transfer.total ? Math.round((transfer.bytes / transfer.total) * 100) : 0;
  const sub = metaLine(post.meta);
  const ready = post.localPath ? viewFor(post) : null;
  const clip = shortClip(post);
  const looping = autoplay && clip && post.localPath ? clip : null;

  return (
    <button className={`tile${selected ? " selected" : ""}`} onClick={onOpen} aria-label={post.meta.title}>
      <Art src={artUrl(post.author, post.meta.artwork)} meta={post.meta} seed={post.id}>
        {looping ? <LoopingClip src={localSrc(post.id, looping.path)} /> : null}
        {clip ? <span className="badge clip-length">{clipLength(Number(clip.tags?.duration))}</span> : null}
        <span className="badge kind">
          <IconKind kind={post.meta.kind} size={12} />
          {clip ? "Clip" : KIND_LABEL[post.meta.kind]}
        </span>
        {post.unread > 0 ? <span className="badge unread">{post.author === me?.key || post.commentCount ? `${post.unread} new` : "New"}</span> : null}
        {have && !downloading ? (
          <span className="badge have" title="You have a copy">
            <IconCheck size={11} />
            Yours
          </span>
        ) : null}
        {ready && !looping ? (
          <span className="play-hint" aria-hidden>
            <span>{ready.mode === "video" || ready.mode === "audio" ? <IconPlay size={20} /> : <IconKind kind={ready.mode === "images" ? "photos" : "book"} size={20} />}</span>
          </span>
        ) : null}
        {downloading ? (
          <div className="progress">
            <div style={{ width: `${pct}%` }} />
          </div>
        ) : null}
      </Art>
      <div className="tile-body">
        <div className="tile-title">{post.meta.title}</div>
        {sub ? <div className="tile-sub">{sub}</div> : null}
        {post.note ? <div className="tile-note">“{post.note}”</div> : null}
        <div className="tile-foot">
          <Avatar member={author} size={18} />
          <span className="who">{author.you ? "You" : author.name}</span>
          <span>{timeAgo(post.createdAt)}</span>
          <span className="grow" />
          {holders.length ? <AvatarStack members={holders} max={3} size={16} /> : null}
          {post.commentCount ? (
            <span className="stat">
              <IconChat size={12} />
              {post.commentCount}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export function QueueGrid({
  posts,
  members,
  transfers,
  selectedId,
  autoplay,
  onOpen,
}: {
  posts: PostView[];
  members: Map<string, Member>;
  transfers: Record<string, Transfer>;
  selectedId: string | null;
  autoplay: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="queue-grid">
      {posts.map((p) => (
        <Tile
          key={p.id}
          post={p}
          members={members}
          transfer={transfers[p.id]}
          selected={p.id === selectedId}
          autoplay={autoplay}
          onOpen={() => onOpen(p.id)}
        />
      ))}
    </div>
  );
}
