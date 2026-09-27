import type { Member, PostView, Transfer } from "../../shared/types";
import { artUrl, KIND_LABEL, metaLine, timeAgo, UNKNOWN_MEMBER } from "../format";
import { Art, Avatar, AvatarStack } from "./Bits";
import { IconChat, IconCheck, IconKind } from "./Icons";

export function Tile({
  post,
  members,
  transfer,
  selected,
  onOpen,
}: {
  post: PostView;
  members: Map<string, Member>;
  transfer?: Transfer;
  selected: boolean;
  onOpen: () => void;
}) {
  const author = members.get(post.author) ?? UNKNOWN_MEMBER;
  const holders = post.holders.filter((k) => k !== post.author).map((k) => members.get(k) ?? UNKNOWN_MEMBER);
  const me = [...members.values()].find((m) => m.you);
  const have = !!post.localPath || (me && post.holders.includes(me.key));
  const downloading = transfer && (transfer.state === "downloading" || transfer.state === "queued");
  const pct = transfer && transfer.total ? Math.round((transfer.bytes / transfer.total) * 100) : 0;
  const sub = metaLine(post.meta);

  return (
    <button className={`tile${selected ? " selected" : ""}`} onClick={onOpen} aria-label={post.meta.title}>
      <Art src={artUrl(post.author, post.meta.artwork)} meta={post.meta} seed={post.id}>
        <span className="badge kind">
          <IconKind kind={post.meta.kind} size={12} />
          {KIND_LABEL[post.meta.kind]}
        </span>
        {post.unread > 0 ? <span className="badge unread">{post.author === me?.key || post.commentCount ? `${post.unread} new` : "New"}</span> : null}
        {have && !downloading ? (
          <span className="badge have" title="You have a copy">
            <IconCheck size={11} />
            Yours
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

export function Mosaic({
  posts,
  members,
  transfers,
  selectedId,
  onOpen,
}: {
  posts: PostView[];
  members: Map<string, Member>;
  transfers: Record<string, Transfer>;
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="mosaic">
      {posts.map((p) => (
        <Tile key={p.id} post={p} members={members} transfer={transfers[p.id]} selected={p.id === selectedId} onOpen={() => onOpen(p.id)} />
      ))}
    </div>
  );
}
