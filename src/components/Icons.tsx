import type { ReactNode } from "react";
import type { FileKind, Kind } from "../../shared/types";

type IconProps = {
  size?: number;
  className?: string;
  title?: string;
};

function Svg({
  size = 14,
  className,
  title,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `ui-icon ${className}` : "ui-icon"}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 4h12M2 8h12M2 12h12" />
    </Svg>
  );
}

export function IconPaperclip(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 11.5l5-5a2.1 2.1 0 10-3-3l-5.5 5.5a3.2 3.2 0 104.5 4.5l5.2-5.2" />
    </Svg>
  );
}

export function IconLock(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="7" width="9" height="7" rx="1.5" />
      <path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" />
    </Svg>
  );
}

export function IconSeed(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 13.5V7" />
      <path d="M8 7c-3.2 0-5-2.2-5-4.5C5.5 2.5 8 4 8 7c0-3 2.5-4.5 5-4.5C13 4.8 11.2 7 8 7z" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3v10M3 8h10" />
    </Svg>
  );
}

export function IconReply(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 5L2 8.5 6 12" />
      <path d="M2.5 8.5H10a3.5 3.5 0 010 7H9" />
    </Svg>
  );
}

export function IconBell(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 11.5h8l-1-1.5V7a3 3 0 10-6 0v3l-1 1.5z" />
      <path d="M7 13a1 1 0 002 0" />
    </Svg>
  );
}

export function IconThread(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 4h10M3 8h7M3 12h5" />
      <path d="M12 10v4M10 12h4" />
    </Svg>
  );
}

export function IconDrop(props: IconProps) {
  return (
    <Svg {...props} size={props.size ?? 18}>
      <path d="M8 2.5c2.8 3.2 4.5 5.2 4.5 7.2a4.5 4.5 0 11-9 0C3.5 7.7 5.2 5.7 8 2.5z" />
    </Svg>
  );
}

export function IconReactAdd(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5.5v5M5.5 8h5" />
    </Svg>
  );
}

export function IconFile({
  kind = "file",
  ...props
}: IconProps & { kind?: "image" | "video" | "audio" | "torrent" | "file" }) {
  if (kind === "image") {
    return (
      <Svg {...props}>
        <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
        <circle cx="6" cy="7" r="1" fill="currentColor" stroke="none" />
        <path d="M2.5 11l3.2-3.2 2.3 2.3 2-2 3.5 3.5" />
      </Svg>
    );
  }
  if (kind === "video") {
    return (
      <Svg {...props}>
        <rect x="2.5" y="4" width="11" height="8" rx="1.5" />
        <path d="M7 6.5l3.5 1.5L7 9.5z" fill="currentColor" stroke="none" />
      </Svg>
    );
  }
  if (kind === "audio") {
    return (
      <Svg {...props}>
        <path d="M5 11.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
        <path d="M6.5 10.2V4.5l6-1v5.7" />
        <path d="M12.5 9.2a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
      </Svg>
    );
  }
  if (kind === "torrent") {
    return (
      <Svg {...props}>
        <path d="M8 2.5v11" />
        <path d="M4.5 6.5L8 3l3.5 3.5" />
        <path d="M4.5 11L8 14.5 11.5 11" />
      </Svg>
    );
  }
  return <IconPaperclip {...props} />;
}

export function fileKindFromMime(mime?: string | null): "image" | "video" | "audio" | "torrent" | "file" {
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  if (mime === "application/x-bittorrent") return "torrent";
  return "file";
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </Svg>
  );
}

export function IconGear(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.9 1.8h2.2l.4 1.7 1.3.6 1.5-.9 1.6 1.6-.9 1.5.6 1.3 1.7.4v2.2l-1.7.4-.6 1.3.9 1.5-1.6 1.6-1.5-.9-1.3.6-.4 1.7H6.9l-.4-1.7-1.3-.6-1.5.9-1.6-1.6.9-1.5-.6-1.3-1.7-.4V6.9l1.7-.4.6-1.3-.9-1.5 1.6-1.6 1.5.9 1.3-.6z" />
      <circle cx="8" cy="8" r="2" />
    </Svg>
  );
}

export function IconShare(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 10V2.5M5 5.2L8 2.3l3 2.9" />
      <path d="M3 9v3.5A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V9" />
    </Svg>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.5V10M5 7.3L8 10.2l3-2.9" />
      <path d="M3 11v1.5A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V11" />
    </Svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 8.5l3 3 7-7" />
    </Svg>
  );
}

export function IconChat(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 4a1.5 1.5 0 011.5-1.5h8A1.5 1.5 0 0113.5 4v5.5A1.5 1.5 0 0112 11H7l-3 2.5V11A1.5 1.5 0 012.5 9.5z" />
    </Svg>
  );
}

export function IconFolder(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 4.5A1.5 1.5 0 013.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5z" />
    </Svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Svg>
  );
}

export function IconChevron(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 6.5L8 10l3.5-3.5" />
    </Svg>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="6" cy="5.5" r="2.3" />
      <path d="M1.8 13.5c.5-2.4 2.1-3.7 4.2-3.7s3.7 1.3 4.2 3.7" />
      <path d="M10.5 3.4a2.2 2.2 0 010 4.3M12 9.9c1.2.5 2 1.7 2.3 3.6" />
    </Svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V4A1.5 1.5 0 009 2.5H4A1.5 1.5 0 002.5 4v5A1.5 1.5 0 004 10.5h1.5" />
    </Svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 8.6A1 1 0 005.7 14h4.6a1 1 0 001-.9l.7-8.6" />
    </Svg>
  );
}

export function IconExternal(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5" />
      <path d="M11.5 9.5v3a1 1 0 01-1 1h-7a1 1 0 01-1-1v-7a1 1 0 011-1h3" />
    </Svg>
  );
}

export function IconQueue(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="2.5" width="11" height="3" rx="1" />
      <rect x="2.5" y="6.5" width="11" height="3" rx="1" />
      <rect x="2.5" y="10.5" width="11" height="3" rx="1" />
    </Svg>
  );
}

export function IconKind({ kind, ...props }: IconProps & { kind: Kind | FileKind }) {
  switch (kind) {
    case "movie":
      return (
        <Svg {...props}>
          <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
          <path d="M5 2.5v11M11 2.5v11M2.5 5.5H5M2.5 8H5M2.5 10.5H5M11 5.5h2.5M11 8h2.5M11 10.5h2.5" />
        </Svg>
      );
    case "tv":
      return (
        <Svg {...props}>
          <rect x="2" y="4" width="12" height="8" rx="1.5" />
          <path d="M6 1.8L8 4l2-2.2M5.5 14h5" />
        </Svg>
      );
    case "music":
      return (
        <Svg {...props}>
          <circle cx="8" cy="8" r="5.5" />
          <circle cx="8" cy="8" r="1.5" />
        </Svg>
      );
    case "book":
      return (
        <Svg {...props}>
          <path d="M3 3a1 1 0 011-1h8.5v10H4a1 1 0 00-1 1z" />
          <path d="M3 13a1 1 0 001 1h8.5v-2" />
        </Svg>
      );
    case "photos":
      return (
        <Svg {...props}>
          <rect x="4" y="4.5" width="9.5" height="8" rx="1.3" />
          <path d="M2.5 11V3.8a1.3 1.3 0 011.3-1.3H11" />
          <path d="M4 11l2.8-2.6 2 1.8 1.6-1.4 3.1 2.6" />
        </Svg>
      );
    case "video":
      return (
        <Svg {...props}>
          <rect x="2" y="4" width="8.5" height="8" rx="1.5" />
          <path d="M10.5 7l3.5-2v6l-3.5-2" />
        </Svg>
      );
    case "audio":
      return <IconFile {...props} kind="audio" />;
    case "image":
      return <IconFile {...props} kind="image" />;
    case "subtitle":
      return (
        <Svg {...props}>
          <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
          <path d="M4.5 9.5h3M9 9.5h2.5M4.5 7h7" />
        </Svg>
      );
    case "software":
    case "archive":
      return (
        <Svg {...props}>
          <path d="M2.5 5L8 2.5 13.5 5v6L8 13.5 2.5 11z" />
          <path d="M2.5 5L8 7.5 13.5 5M8 7.5v6" />
        </Svg>
      );
    case "document":
      return (
        <Svg {...props}>
          <path d="M4 2h5.5L12.5 5v8.5a.5.5 0 01-.5.5H4a.5.5 0 01-.5-.5v-11A.5.5 0 014 2z" />
          <path d="M9.5 2v3h3M5.5 8h5M5.5 10.5h5" />
        </Svg>
      );
    default:
      return (
        <Svg {...props}>
          <rect x="2.5" y="6" width="11" height="7.5" rx="1.3" />
          <path d="M4 6V4.5h8V6M5.5 4.5V3h5v1.5" />
        </Svg>
      );
  }
}
