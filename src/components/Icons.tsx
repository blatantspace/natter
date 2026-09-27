/** Crisp line icons for Natter chrome — no emoji. */

import type { ReactNode } from "react";

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
      className={className}
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
