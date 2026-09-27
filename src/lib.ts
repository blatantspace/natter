export type Person = {
  id: string;
  displayName: string;
  color: string;
  lastSeen?: number;
  hasPin?: boolean;
};

export type Channel = {
  id: string;
  name: string;
  topic: string;
  kind: "lounge" | "dm";
  dmUser1Id?: string | null;
  dmUser2Id?: string | null;
  createdAt: number;
};

export type ReactionGroup = {
  emoji: string;
  count: number;
  personIds: string[];
  personNames: string[];
};

export type Message = {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  body: string;
  createdAt: number;
  source: string;
  parentId?: string | null;
  replyCount?: number;
  lastReplyAt?: number | null;
  reactions?: ReactionGroup[];
  attachmentId?: string | null;
  attachmentName?: string | null;
  attachmentType?: string | null;
  attachmentSize?: number | null;
  attachmentIv?: string | null;
  infoHash?: string | null;
  editedAt?: number | null;
  deletedAt?: number | null;
  channelName?: string;
  filePayload?: import("./filePayload").FilePayload | null;
  // Client-side decrypted state
  decryptedBody?: string;
  decryptedAttachmentUrl?: string;
};

export type Bootstrap = {
  workspace: { name: string; emoji: string };
  channels: Channel[];
  people: Person[];
  unreadCounts?: Record<string, number>;
};

const PERSON_KEY = "natter.person";
const TOKEN_KEY = "natter.token";

export function loadSavedPerson(): Person | null {
  try {
    const raw = localStorage.getItem(PERSON_KEY);
    return raw ? (JSON.parse(raw) as Person) : null;
  } catch {
    return null;
  }
}

export function loadSavedToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function saveAuth(person: Person, token?: string) {
  localStorage.setItem(PERSON_KEY, JSON.stringify(person));
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  }
}

export function clearAuth() {
  localStorage.removeItem(PERSON_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

export function savePerson(person: Person) {
  localStorage.setItem(PERSON_KEY, JSON.stringify(person));
}

export function clearPerson() {
  clearAuth();
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
}

export function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatRelativeTime(ts: number) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatDay(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function sameDay(a: number, b: number) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function shouldCompact(prev: Message | undefined, next: Message) {
  if (!prev) return false;
  if (prev.authorId !== next.authorId) return false;
  return next.createdAt - prev.createdAt < 5 * 60 * 1000;
}

export function renderBody(body: string, currentPersonName?: string) {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Bold formatting **text**
  let formatted = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // @mentions formatting (@Name or @"Display Name")
  formatted = formatted.replace(
    /@([a-zA-Z0-9_.-]+)/g,
    (match, name) => {
      const isMe =
        currentPersonName &&
        name.toLowerCase() === currentPersonName.toLowerCase();
      return `<span class="mention-tag ${isMe ? "mention-me" : ""}">@${name}</span>`;
    }
  );

  return formatted;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export type UploadProgress = {
  label: string;
  ratio?: number;
};

export function uploadBlob(
  url: string,
  blob: Blob,
  headers: Record<string, string>,
  onProgress?: (sent: number, total: number) => void,
  signal?: AbortSignal
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }
    const abort = () => xhr.abort();
    if (signal) {
      if (signal.aborted) {
        reject(new Error("Upload cancelled"));
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    }
    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable ? event.total : blob.size;
      onProgress?.(event.loaded, total || blob.size);
    };
    xhr.onload = () => {
      signal?.removeEventListener("abort", abort);
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        // ignore non-JSON
      }
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        json,
      });
    };
    xhr.onerror = () => {
      signal?.removeEventListener("abort", abort);
      reject(new Error("Upload failed"));
    };
    xhr.onabort = () => {
      signal?.removeEventListener("abort", abort);
      reject(new Error("Upload cancelled"));
    };
    xhr.send(blob);
  });
}

export const ROOM_KEY_STORAGE = "natter.room_key";

export function loadSavedRoomKey(): string {
  const hashMatch = window.location.hash.match(/key=([a-f0-9]+)/i);
  if (hashMatch && hashMatch[1]) {
    const key = hashMatch[1];
    localStorage.setItem(ROOM_KEY_STORAGE, key);
    return key;
  }
  return localStorage.getItem(ROOM_KEY_STORAGE) || "canadian-sovereign-lounge-default-2026";
}

export function saveRoomKey(key: string) {
  localStorage.setItem(ROOM_KEY_STORAGE, key);
}

export async function api<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

const NOTIFICATIONS_KEY = "natter.notifications_enabled";
const SOUND_KEY = "natter.sound_enabled";

export function loadNotificationSetting(): boolean {
  const val = localStorage.getItem(NOTIFICATIONS_KEY);
  if (val === null) {
    return typeof Notification !== "undefined" && Notification.permission === "granted";
  }
  return val === "true";
}

export function saveNotificationSetting(enabled: boolean) {
  localStorage.setItem(NOTIFICATIONS_KEY, String(enabled));
}

export function loadSoundSetting(): boolean {
  const val = localStorage.getItem(SOUND_KEY);
  return val === null ? true : val === "true";
}

export function saveSoundSetting(enabled: boolean) {
  localStorage.setItem(SOUND_KEY, String(enabled));
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  return await Notification.requestPermission();
}

export function playNotificationChime() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880, now + 0.08); // A5

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.12);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.45);
  } catch {
    // AudioContext blocked or not supported
  }
}

export function showDesktopNotification(
  title: string,
  options?: NotificationOptions,
  onClick?: () => void
) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return null;
  }
  if (!loadNotificationSetting()) {
    return null;
  }

  try {
    const notif = new Notification(title, {
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      ...options,
    });
    if (onClick) {
      notif.onclick = () => {
        window.focus();
        onClick();
        notif.close();
      };
    }
    return notif;
  } catch (err) {
    console.warn("Notification error", err);
    return null;
  }
}
