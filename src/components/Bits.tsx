import { useState, type ReactNode } from "react";
import type { Member, PostMeta } from "../../shared/types";
import { aspectFor, KIND_LABEL, tintFor } from "../format";
import { IconKind } from "./Icons";

export function Avatar({ member, size = 22, showOnline = false }: { member: Member; size?: number; showOnline?: boolean }) {
  return (
    <span
      className={`avatar${showOnline && member.online ? " online" : ""}`}
      style={{ background: member.color, ["--size" as string]: `${size}px` }}
      title={member.you ? `${member.name} (you)` : member.name}
    >
      {member.name.slice(0, 1)}
    </span>
  );
}

export function AvatarStack({ members, max = 4, size = 22, showOnline = false }: { members: Member[]; max?: number; size?: number; showOnline?: boolean }) {
  const shown = members.slice(0, max);
  return (
    <span className="avatar-stack">
      {shown.map((m) => (
        <Avatar key={m.key} member={m} size={size} showOnline={showOnline} />
      ))}
      {members.length > max ? <span className="more">+{members.length - max}</span> : null}
    </span>
  );
}

export function Art({ src, meta, seed, children }: { src?: string; meta: PostMeta; seed: string; children?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  const ratio = aspectFor(meta);
  const showImg = src && !failed;
  return (
    <div className="art" style={{ aspectRatio: String(ratio), background: showImg ? undefined : tintFor(seed) }}>
      {showImg ? (
        <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <div className="art-fallback">
          <IconKind kind={meta.kind} size={26} />
          <div>
            <div className="big-title">{meta.title}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4, fontWeight: 600 }}>
              {KIND_LABEL[meta.kind]}
            </div>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  wide,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`mac-window modal${wide ? " wide" : ""}`} role="dialog" aria-label={title}>
        <div className="mac-titlebar" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <button className="mac-close-box" aria-label="Close" onClick={onClose} />
          <span className="title">{title}</span>
          <span />
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}
