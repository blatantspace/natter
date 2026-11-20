import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  Bootstrap,
  Channel,
  clearAuth,
  formatBytes,
  loadNotificationSetting,
  clearPerson,
  loadSavedToken,
  loadSoundSetting,
  Message,
  Person,
  playNotificationChime,
  requestNotificationPermission,
  saveAuth,
  saveNotificationSetting,
  showDesktopNotification,
  uploadBlob,
  UploadProgress,
} from "./lib";
import {
  hydrateMessage,
  fetchNamedFile,
  fetchNamedMagnet,
  FileTransfer,
  hasFileShare,
  isMagnetLikeFile,
  isUriMagnet,
  libraryKey,
  parseFilePayload,
  serializeFilePayload,
  shouldAutoInline,
  SwarmPeer,
  uniqueLibraryItems,
} from "./filePayload";
import {
  destroyTorrentClient,
  inspectTorrentInput,
  loungeMagnet,
  parseMagnetURI,
  seedFileBytes,
  uploadMagnetTorrent,
  uploadTorrentFile,
} from "./swarm";
import {
  blacklistVideo,
  isBlacklisted,
  isUploadCancelled,
  loadFolderWatchSettings,
  markVideoSeen,
  nextQueuedVideo,
  pickWatchFolder,
  restoreWatchFolder,
  saveFolderWatchSettings,
  scanFolderQueue,
  stopWatchingFolder,
  supportsFolderWatch,
  type FolderQueueItem,
  type FolderWatchSettings,
} from "./folderWatch";
import { generatePoster } from "./posters";
import { Welcome } from "./components/Welcome";
import { Sidebar } from "./components/Sidebar";
import { MessagePane } from "./components/MessagePane";
import { SeedsPage } from "./components/SeedsPage";
import { ThreadPane } from "./components/ThreadPane";
import { SettingsModal } from "./components/SettingsModal";
import { NewChannelModal } from "./components/NewChannelModal";
import { InviteModal } from "./components/InviteModal";

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [person, setPerson] = useState<Person | null>(null);
  // A saved login is only a hint. The server's answer decides who we are.
  const [restoring, setRestoring] = useState<boolean>(() => Boolean(loadSavedToken()));
  const [channels, setChannels] = useState<Channel[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [online, setOnline] = useState<Person[]>([]);
  const [activeId, setActiveId] = useState<string>("ch_general");
  const [rawMessages, setRawMessages] = useState<Message[]>([]);
  const [decryptedMessages, setDecryptedMessages] = useState<Message[]>([]);
  const [typing, setTyping] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [folderWatch, setFolderWatch] = useState<FolderWatchSettings | null>(() =>
    loadFolderWatchSettings()
  );
  const [folderWatchStatus, setFolderWatchStatus] = useState<string | null>(null);
  const [folderQueue, setFolderQueue] = useState<FolderQueueItem[]>([]);
  const [folderCurrentKey, setFolderCurrentKey] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [mentionCounts, setMentionCounts] = useState<Record<string, number>>({});
  const [notificationsEnabled, setNotificationsEnabled] = useState(() =>
    loadNotificationSetting()
  );

  // Thread states
  const [activeThreadParent, setActiveThreadParent] = useState<Message | null>(null);
  const [threadRawReplies, setThreadRawReplies] = useState<Message[]>([]);
  const [threadDecryptedReplies, setThreadDecryptedReplies] = useState<Message[]>([]);
  const [threadTyping, setThreadTyping] = useState<string | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadUploading, setThreadUploading] = useState(false);
  const [threadUploadProgress, setThreadUploadProgress] = useState<UploadProgress | null>(null);
  const [swarmByHash, setSwarmByHash] = useState<Record<string, SwarmPeer[]>>({});
  const [fileTransfers, setFileTransfers] = useState<Record<string, FileTransfer>>({});
  const [mainView, setMainView] = useState<"chat" | "seeds">("chat");
  const [libraryRaw, setLibraryRaw] = useState<Message[]>([]);
  const [library, setLibrary] = useState<Message[]>([]);
  const [discovered, setDiscovered] = useState<Message[]>([]);
  const [posterByKey, setPosterByKey] = useState<Record<string, string>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const typingTimer = useRef<number | null>(null);
  const threadTypingTimer = useRef<number | null>(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const activeThreadParentRef = useRef(activeThreadParent);
  activeThreadParentRef.current = activeThreadParent;
  const blobCacheRef = useRef<Map<string, string>>(new Map());
  const lastSwarmSentRef = useRef<Record<string, number>>({});
  const fetchingRef = useRef<Set<string>>(new Set());
  const shareFileRef = useRef<
    (file: File, parentId?: string, channelId?: string, signal?: AbortSignal) => Promise<void>
  >(async () => {});
  const uploadingRef = useRef(false);
  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const folderAbortRef = useRef<AbortController | null>(null);
  uploadingRef.current = uploading || threadUploading;

  const markChannelAsRead = useCallback((channelId: string) => {
    if (!channelId) return;
    setUnreadCounts((prev) => {
      if (!prev[channelId]) return prev;
      const next = { ...prev };
      delete next[channelId];
      return next;
    });
    setMentionCounts((prev) => {
      if (!prev[channelId]) return prev;
      const next = { ...prev };
      delete next[channelId];
      return next;
    });
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "channel.read", channelId }));
    } else {
      const savedToken = loadSavedToken();
      if (savedToken) {
        api(`/api/channels/${channelId}/read`, {
          method: "POST",
          headers: { Authorization: `Bearer ${savedToken}` },
        }).catch(() => {});
      }
    }
  }, []);

  // Verify saved token on load. The server's answer always wins over the browser's saved person.
  useEffect(() => {
    const savedToken = loadSavedToken();
    if (!savedToken) {
      clearPerson();
      setRestoring(false);
      return;
    }
    api<{ ok: boolean; person: Person; token: string; unreadCounts?: Record<string, number> }>("/api/auth/me", {
      headers: { Authorization: `Bearer ${savedToken}` },
    })
      .then((res) => {
        if (res.ok && res.person) {
          saveAuth(res.person, res.token || savedToken);
          setPerson(res.person);
          if (res.unreadCounts) setUnreadCounts(res.unreadCounts);
        } else {
          clearAuth();
          setError("Please log in again.");
        }
      })
      .catch((err: Error & { status?: number }) => {
        if (err.status === 401) {
          // Bad token, or the person is gone: forget the saved login.
          clearAuth();
          setError("Please log in again.");
        } else {
          // Network trouble: keep the saved token so a refresh can retry.
          setError("Can't reach Natter, try again.");
        }
      })
      .finally(() => setRestoring(false));
  }, []);

  const active = useMemo(
    () => channels.find((c) => c.id === activeId) || channels[0],
    [channels, activeId]
  );

  useEffect(() => {
    api<Bootstrap>("/api/bootstrap")
      .then((data) => {
        setBoot(data);
        setChannels(data.channels);
        setPeople(data.people);
        if (data.unreadCounts) setUnreadCounts(data.unreadCounts);
        if (data.channels.length) {
          setActiveId((prev) =>
            data.channels.some((c) => c.id === prev)
              ? prev
              : data.channels[0].id
          );
        }
      })
      .catch((err) => setError(err.message));
  }, []);

  const loadMessages = useCallback(async (channelId: string) => {
    setLoadingMessages(true);
    setRawMessages([]);
    setDecryptedMessages([]);
    try {
      const data = await api<{ messages: Message[] }>(
        `/api/channels/${channelId}/messages?limit=100`
      );
      setRawMessages(data.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (!person || !active) return;
    setTyping(null);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    // If we switch channels and the open thread is in another channel, close it
    if (activeThreadParent && activeThreadParent.channelId !== active.id) {
      setActiveThreadParent(null);
      setThreadRawReplies([]);
    }
    loadMessages(active.id);
    markChannelAsRead(active.id);
  }, [person, active?.id, loadMessages, markChannelAsRead]);

  useEffect(() => {
    if (!person) return;
    const token = loadSavedToken();
    api<{ messages: Message[] }>("/api/seeds", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((data) => setLibraryRaw(data.messages))
      .catch(() => {});
  }, [person]);

  useEffect(() => {
    setLibrary(
      libraryRaw.filter((msg) => !msg.legacyEnc).map((msg) => hydrateMessage(msg, blobCacheRef.current))
    );
  }, [libraryRaw]);

  // Window focus listener to clear active channel unreads
  useEffect(() => {
    const handleFocus = () => {
      if (activeIdRef.current) {
        markChannelAsRead(activeIdRef.current);
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [markChannelAsRead]);

  // Read the file card out of each message, and start inline files. Old
  // room-password rows (legacyEnc) are hidden but stay in the database.
  useEffect(() => {
    const hydrated = rawMessages
      .filter((msg) => !msg.legacyEnc)
      .map((msg) => hydrateMessage(msg, blobCacheRef.current));
    setDecryptedMessages(hydrated);

    for (const msg of hydrated) {
      if (msg.attachmentId && !msg.decryptedAttachmentUrl && shouldAutoInline(msg)) {
        handleFetchFile(msg, { silent: true });
      } else if (msg.infoHash && msg.decryptedAttachmentUrl) {
        announceSwarm(msg.infoHash, msg.attachmentId || undefined, "seed", 1);
      }
    }
  }, [rawMessages]);

  // Same for the open thread's replies
  useEffect(() => {
    const hydrated = threadRawReplies
      .filter((msg) => !msg.legacyEnc)
      .map((msg) => hydrateMessage(msg, blobCacheRef.current));
    setThreadDecryptedReplies(hydrated);

    for (const msg of hydrated) {
      if (msg.attachmentId && !msg.decryptedAttachmentUrl && shouldAutoInline(msg)) {
        handleFetchFile(msg, { silent: true });
      }
    }
  }, [threadRawReplies]);

  useEffect(() => {
    if (!person) return;

    let closed = false;
    let retryTimer: number | null = null;
    let ws: WebSocket | null = null;

    function connect() {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${proto}://${location.host}/ws`);
      ws = socket;
      wsRef.current = socket;

      socket.onopen = () => {
        if (ws !== socket) return;
        setConnected(true);
        setError(null);
        socket.send(JSON.stringify({ type: "identify", personId: person.id }));
      };

      socket.onclose = () => {
        if (ws !== socket) return;
        setConnected(false);
        if (wsRef.current === socket) wsRef.current = null;
        if (closed) return;
        retryTimer = window.setTimeout(connect, 1200);
      };

      socket.onerror = () => {
        // onclose handles retry
      };

      socket.onmessage = (event) => {
        if (ws !== socket) return;
        const msg = JSON.parse(event.data);
        if (msg.type === "identified" || msg.type === "hello" || msg.type === "presence") {
          setOnline(msg.online || []);
          if (msg.unreadCounts) {
            setUnreadCounts(msg.unreadCounts);
          }
          if (msg.swarm) {
            setSwarmByHash(msg.swarm);
          }
        }
        if (msg.type === "swarm.snapshot") {
          setSwarmByHash(msg.swarm || {});
        }
        if (msg.type === "unread.updated") {
          if (msg.unreadCounts) {
            setUnreadCounts(msg.unreadCounts);
          }
        }
        if (msg.type === "message.created") {
          const m: Message = msg.message;

          // Look at the body for @mentions
          const checkMention = async (rawBody: string): Promise<{ mentioned: boolean; fileName?: string }> => {
            if (!rawBody || !person) return { mentioned: false };
            const text = rawBody;
            const payload = parseFilePayload(text);
            const myHandle = person.displayName.toLowerCase().replace(/\s+/g, "_");
            const myName = person.displayName.toLowerCase();
            const pattern = new RegExp(`@(${myHandle}|${myName})\\b`, "i");
            return {
              mentioned: pattern.test(text),
              fileName: payload?.name,
            };
          };

          // Sound & Desktop Notifications & Unread/Mention Badges
          if (m.authorId !== person.id) {
            checkMention(m.body).then(({ mentioned: isMentioned, fileName }) => {
              if (loadSoundSetting()) {
                playNotificationChime();
              }
              if (document.hidden || !document.hasFocus()) {
                const targetChannel = channels.find((c) => c.id === m.channelId);
                const chanName = targetChannel
                  ? targetChannel.kind === "dm"
                    ? "Direct Message"
                    : `#${targetChannel.name}`
                  : "Lounge";

                showDesktopNotification(
                  isMentioned
                    ? `📢 ${m.authorName} mentioned you in ${chanName}`
                    : `${m.authorName} in ${chanName}`,
                  {
                    body: fileName
                      ? `${fileName}`
                      : m.attachmentId
                        ? `Shared ${m.attachmentName || "a file"}`
                        : "New message",
                  },
                  () => {
                    setActiveId(m.channelId);
                    markChannelAsRead(m.channelId);
                    if (m.parentId) {
                      const parent = rawMessages.find((pm) => pm.id === m.parentId);
                      if (parent) handleOpenThread(parent);
                    }
                  }
                );
              }

              // Update unread and mention counts for channels not currently active
              if (m.channelId !== activeIdRef.current || document.hidden || !document.hasFocus()) {
                setUnreadCounts((prev) => ({
                  ...prev,
                  [m.channelId]: (prev[m.channelId] || 0) + 1,
                }));
                if (isMentioned) {
                  setMentionCounts((prev) => ({
                    ...prev,
                    [m.channelId]: (prev[m.channelId] || 0) + 1,
                  }));
                }
              } else {
                markChannelAsRead(m.channelId);
              }
            });
          }

          if (m.parentId) {
            // Thread reply
            if (activeThreadParentRef.current && activeThreadParentRef.current.id === m.parentId) {
              setThreadRawReplies((prev) => {
                if (prev.some((r) => r.id === m.id)) return prev;
                return [...prev, m];
              });
            }
          } else {
            // Top-level channel message
            setRawMessages((prev) => {
              if (m.channelId !== activeIdRef.current) return prev;
              if (prev.some((r) => r.id === m.id)) return prev;
              return [...prev, m];
            });
          }

          if (m.attachmentId || m.infoHash) {
            setLibraryRaw((prev) => {
              if (prev.some((r) => r.id === m.id)) return prev;
              return [m, ...prev];
            });
          }
        }
        if (msg.type === "message.updated" || msg.type === "message.deleted") {
          const next: Message = msg.message;
          if (!next?.id) return;
          const patch = (list: Message[]) =>
            list.map((m) => (m.id === next.id ? { ...m, ...next } : m));
          setRawMessages((prev) => patch(prev));
          setThreadRawReplies((prev) => patch(prev));
          setActiveThreadParent((prev) => (prev?.id === next.id ? { ...prev, ...next } : prev));
          setLibraryRaw((prev) => {
            if (next.deletedAt || !(next.attachmentId || next.infoHash)) {
              return prev.filter((m) => m.id !== next.id);
            }
            return prev.map((m) => (m.id === next.id ? { ...m, ...next } : m));
          });
        }
        if (msg.type === "reaction.updated") {
          const { messageId, reactions } = msg;
          setRawMessages((prev) =>
            prev.map((m) => (m.id === messageId ? { ...m, reactions } : m))
          );
          setThreadRawReplies((prev) =>
            prev.map((m) => (m.id === messageId ? { ...m, reactions } : m))
          );
          if (activeThreadParentRef.current && activeThreadParentRef.current.id === messageId) {
            setActiveThreadParent((prev) => (prev ? { ...prev, reactions } : null));
          }
        }
        if (msg.type === "thread.updated") {
          // Update reply stats in parent message
          setRawMessages((prev) =>
            prev.map((m) =>
              m.id === msg.parentId
                ? { ...m, replyCount: msg.replyCount, lastReplyAt: msg.lastReplyAt }
                : m
            )
          );
          if (activeThreadParentRef.current && activeThreadParentRef.current.id === msg.parentId) {
            setActiveThreadParent((prev) =>
              prev
                ? { ...prev, replyCount: msg.replyCount, lastReplyAt: msg.lastReplyAt }
                : null
            );
          }
        }
        if (msg.type === "channel.created") {
          setChannels((prev) => {
            if (prev.some((c) => c.id === msg.channel.id)) {
              return prev.map((c) =>
                c.id === msg.channel.id ? msg.channel : c
              );
            }
            return [...prev, msg.channel].sort((a, b) =>
              a.name.localeCompare(b.name)
            );
          });
        }
        if (msg.type === "people.joined") {
          setPeople((prev) => {
            if (prev.some((p) => p.id === msg.person.id)) return prev;
            return [...prev, msg.person];
          });
        }
        if (msg.type === "people.removed") {
          setPeople((prev) => prev.filter((p) => p.id !== msg.personId));
        }
        if (msg.type === "typing") {
          if (msg.parentId) {
            if (
              activeThreadParentRef.current &&
              activeThreadParentRef.current.id === msg.parentId &&
              msg.person.id !== person.id
            ) {
              setThreadTyping(`${msg.person.displayName} is typing…`);
              if (threadTypingTimer.current) window.clearTimeout(threadTypingTimer.current);
              threadTypingTimer.current = window.setTimeout(() => setThreadTyping(null), 1800);
            }
          } else if (msg.channelId === activeIdRef.current && msg.person.id !== person.id) {
            setTyping(`${msg.person.displayName} is typing…`);
            if (typingTimer.current) window.clearTimeout(typingTimer.current);
            typingTimer.current = window.setTimeout(() => setTyping(null), 1800);
          }
        }
        if (msg.type === "error") setError(msg.error);
      };
    }

    connect();

    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      if (threadTypingTimer.current) window.clearTimeout(threadTypingTimer.current);
      const socket = ws;
      ws = null;
      if (wsRef.current === socket) wsRef.current = null;
      socket?.close();
    };
  }, [person]);

  async function handleLogin(displayName: string, pin?: string) {
    setError(null);
    try {
      const savedToken = loadSavedToken();
      const data = await api<{ person: Person; token: string; unreadCounts?: Record<string, number> }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ displayName, pin, token: savedToken }),
      });
      saveAuth(data.person, data.token);
      setPerson(data.person);
      if (data.unreadCounts) {
        setUnreadCounts(data.unreadCounts);
      }
      setPeople((prev) => {
        const filtered = prev.filter((p) => p.id !== data.person.id);
        return [...filtered, data.person].sort((a, b) =>
          a.displayName.localeCompare(b.displayName)
        );
      });
    } catch (err) {
      throw err;
    }
  }

  async function handleSend(body: string) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !active) {
      setError("Not connected. Refresh and try again.");
      return;
    }

    if (parseMagnetURI(body)) {
      await shareMagnetUri(body);
      return;
    }

    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    setTyping(null);
    wsRef.current.send(
      JSON.stringify({
        type: "message.send",
        channelId: active.id,
        body,
      })
    );
  }

  async function handleEditMessage(message: Message, body: string) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError("Not connected. Refresh and try again.");
      return;
    }
    const trimmed = body.trim();
    if (!trimmed) return;
    wsRef.current.send(
      JSON.stringify({
        type: "message.edit",
        messageId: message.id,
        body: trimmed,
      })
    );
  }

  function handleDeleteMessage(message: Message) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError("Not connected. Refresh and try again.");
      return;
    }
    const file = hasFileShare(message);
    const label = file ? message.attachmentName || "this file" : "this message";
    if (!window.confirm(`Delete ${label} from the lounge?`)) return;
    wsRef.current.send(
      JSON.stringify({
        type: "message.delete",
        messageId: message.id,
      })
    );
  }

  function announceSwarm(
    infoHash: string,
    fileId?: string,
    role: "seed" | "leech" = "seed",
    progress = 1
  ) {
    if (!infoHash || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const key = `${infoHash}:${role}`;
    const now = Date.now();
    if (role === "leech" && now - (lastSwarmSentRef.current[key] || 0) < 800) return;
    lastSwarmSentRef.current[key] = now;
    wsRef.current.send(
      JSON.stringify({
        type: "swarm.update",
        infoHash,
        fileId: fileId || null,
        role,
        progress,
      })
    );
  }

  function attachUrlToMessages(cacheKey: string, url: string) {
    const patch = (m: Message) => {
      const key = libraryKey(m);
      if (key === cacheKey || m.attachmentId === cacheKey) {
        return { ...m, decryptedAttachmentUrl: url };
      }
      return m;
    };
    setDecryptedMessages((prev) => prev.map(patch));
    setThreadDecryptedReplies((prev) => prev.map(patch));
    setLibrary((prev) => prev.map(patch));
    setDiscovered((prev) => prev.map(patch));
    setActiveThreadParent((prev) => (prev ? patch(prev) : prev));
  }

  async function handleFetchFile(message: Message, opts?: { silent?: boolean }) {
    const cacheKey = libraryKey(message);
    if (!cacheKey) return;
    const uri = isUriMagnet(message);
    const fileId = message.attachmentId;
    const name = message.attachmentName || "download";
    const mime = message.attachmentType || "application/octet-stream";
    if (!uri && !fileId) return;

    const cached = blobCacheRef.current.get(cacheKey) || (fileId ? blobCacheRef.current.get(fileId) : undefined);
    if (cached) {
      attachUrlToMessages(cacheKey, cached);
      if (message.infoHash) announceSwarm(message.infoHash, fileId || undefined, "seed", 1);
      return;
    }

    if (fetchingRef.current.has(cacheKey)) return;
    fetchingRef.current.add(cacheKey);

    if (!opts?.silent) {
      setFileTransfers((prev) => ({
        ...prev,
        [cacheKey]: { status: "downloading", progress: 0, label: "Starting…" },
      }));
    }
    if (message.infoHash) announceSwarm(message.infoHash, fileId || undefined, "leech", 0);

    try {
      let file: File;
      if (uri) {
        const magnet =
          message.filePayload?.magnet || loungeMagnet(`magnet:?xt=urn:btih:${message.infoHash}`);
        file = await fetchNamedMagnet({
          magnet,
          infoHash: message.infoHash as string,
          name,
          mime,
          onProgress: (ratio, label) => {
            setFileTransfers((prev) => ({
              ...prev,
              [cacheKey]: { status: "downloading", progress: ratio, label },
            }));
            if (message.infoHash) announceSwarm(message.infoHash, fileId || undefined, "leech", ratio);
          },
        });
      } else {
        file = await fetchNamedFile({
          fileId: fileId as string,
          mime,
          name,
          infoHash: message.infoHash || undefined,
          onProgress: (ratio, label) => {
            setFileTransfers((prev) => ({
              ...prev,
              [cacheKey]: { status: "downloading", progress: ratio, label },
            }));
            if (message.infoHash) announceSwarm(message.infoHash, fileId || undefined, "leech", ratio);
          },
        });
      }
      const url = URL.createObjectURL(file);
      blobCacheRef.current.set(cacheKey, url);
      if (fileId) blobCacheRef.current.set(fileId, url);
      attachUrlToMessages(cacheKey, url);
      setFileTransfers((prev) => ({
        ...prev,
        [cacheKey]: { status: "ready", progress: 1, label: "Ready" },
      }));
      if (message.infoHash) announceSwarm(message.infoHash, fileId || undefined, "seed", 1);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      setFileTransfers((prev) => ({
        ...prev,
        [cacheKey]: { status: "error", progress: 0, error },
      }));
      if (!opts?.silent) setError(error);
    } finally {
      fetchingRef.current.delete(cacheKey);
    }
  }

  function abortFolderWatchUpload() {
    folderAbortRef.current?.abort();
    folderAbortRef.current = null;
    setFolderCurrentKey(null);
  }

  async function shareFile(
    file: File,
    parentId?: string,
    channelId?: string,
    signal?: AbortSignal
  ) {
    const targetId = channelId || active?.id;
    if (!targetId || !person) return;
    const cancelled = () => Boolean(signal?.aborted);
    const setStatus = parentId ? setThreadUploadProgress : setUploadProgress;
    const setBusy = parentId ? setThreadUploading : setUploading;
    const setProgress = (label: string, ratio?: number) => setStatus({ label, ratio });
    setBusy(true);
    setProgress(`Preparing ${file.name}…`, 0);

    try {
      if (cancelled()) throw new Error("Upload cancelled");
      if (cancelled()) throw new Error("Upload cancelled");
      setProgress("Uploading file…", 0);

      const res = await uploadBlob(
        "/api/files/encrypted",
        file,
        {
          "Content-Type": "application/octet-stream",
          "X-Uploader-Id": person.id,
        },
        (sent, total) => {
          const size = total || file.size;
          const ratio = size > 0 ? Math.min(1, sent / size) : 0;
          setProgress(`Uploading ${formatBytes(sent)} / ${formatBytes(size)} (${Math.round(ratio * 100)}%)`, ratio);
        },
        signal
      );

      if (!res.ok) {
        throw new Error(`Upload failed (${res.status})`);
      }

      const fileId = String(res.json.fileId || "");
      if (!fileId) throw new Error("Upload failed (no file id)");
      if (cancelled()) throw new Error("Upload cancelled");
      const localUrl = URL.createObjectURL(file);
      blobCacheRef.current.set(fileId, localUrl);

      let infoHash: string | undefined;
      setProgress("Seeding magnet…", 1);
      try {
        const seeded = await seedFileBytes(file, fileId);
        if (seeded) {
          infoHash = seeded.infoHash;
          blobCacheRef.current.set(`hash:${infoHash}`, localUrl);
          await uploadTorrentFile(fileId, seeded.torrentFile, seeded.infoHash, person.id);
        }
      } catch (err) {
        console.warn("P2P seed failed, HTTP webseed still works", err);
      }

      if (cancelled()) throw new Error("Upload cancelled");

      const payload = serializeFilePayload({
        t: "magnet",
        v: 2,
        kind: "file",
        fileId,
        infoHash,
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
      });
      if (cancelled()) throw new Error("Upload cancelled");

      if (parentId) {
        if (threadTypingTimer.current) window.clearTimeout(threadTypingTimer.current);
        setThreadTyping(null);
      } else {
        if (typingTimer.current) window.clearTimeout(typingTimer.current);
        setTyping(null);
      }

      setProgress("Broadcasting to lounge…", 1);
      wsRef.current?.send(
        JSON.stringify({
          type: "message.send",
          channelId: targetId,
          parentId: parentId || undefined,
          body: payload,
          attachment: { id: fileId, infoHash: infoHash || null },
        })
      );

      if (infoHash) announceSwarm(infoHash, fileId, "seed", 1);
    } catch (err) {
      if (isUploadCancelled(err)) throw err;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }
  shareFileRef.current = shareFile;

  useEffect(() => {
    if (!person || !folderWatch) {
      if (!folderWatch) {
        setFolderQueue([]);
        setFolderWatchStatus(null);
      }
      return;
    }
    if (!supportsFolderWatch()) {
      setFolderWatchStatus("Folder watch needs Chrome or Edge");
      return;
    }

    const channelId = folderWatch.channelId;
    const folderName = folderWatch.folderName;
    const enabled = folderWatch.enabled;
    let cancelled = false;
    let timer = 0;

    async function loop() {
      if (cancelled) return;
      let delay = 2500;
      try {
        if (!dirHandleRef.current) {
          dirHandleRef.current = await restoreWatchFolder();
        }
        const dir = dirHandleRef.current;
        if (!dir) {
          setFolderWatchStatus("Allow folder access in Settings to keep watching");
          setFolderQueue([]);
        } else {
          const queue = await scanFolderQueue(dir);
          if (cancelled) return;
          setFolderQueue(queue);
          const next = nextQueuedVideo(queue);
          const waiting = queue.filter((item) => item.status === "queued").length;
          const copying = queue.filter((item) => item.status === "copying").length;
          if (!enabled) {
            setFolderWatchStatus(`Paused · ${waiting} waiting in ${folderName}`);
          } else if (uploadingRef.current) {
            // shareFile owns the status line
          } else if (next?.file && !isBlacklisted(next.name)) {
            const ctrl = new AbortController();
            folderAbortRef.current = ctrl;
            setFolderCurrentKey(next.key);
            setFolderWatchStatus(`Seeding ${next.name}…`);
            try {
              await shareFileRef.current(next.file, undefined, channelId, ctrl.signal);
              if (!ctrl.signal.aborted) {
                markVideoSeen(next.key);
                if (!cancelled) setFolderWatchStatus(`Seeded ${next.name}`);
                delay = 400;
              }
            } catch (err) {
              if (isUploadCancelled(err)) {
                if (!cancelled) {
                  setFolderWatchStatus(enabled ? `Skipped ${next.name}` : `Paused · ${waiting} waiting`);
                }
              } else {
                markVideoSeen(next.key);
                if (!cancelled) setFolderWatchStatus(`Failed ${next.name} — skipped`);
              }
            } finally {
              if (folderAbortRef.current === ctrl) folderAbortRef.current = null;
              setFolderCurrentKey(null);
            }
          } else if (copying > 0) {
            setFolderWatchStatus(`Waiting for ${copying} cop${copying === 1 ? "y" : "ies"} to finish`);
          } else {
            setFolderWatchStatus(`Watching ${folderName}`);
          }
        }
      } catch (err) {
        setFolderWatchStatus(err instanceof Error ? err.message : String(err));
      }
      if (!cancelled) timer = window.setTimeout(loop, delay);
    }

    setFolderWatchStatus(enabled ? `Watching ${folderName}` : `Paused · ${folderName}`);
    loop();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [person, folderWatch]);

  async function shareMagnetUri(raw: string, parentId?: string) {
    if (!active || !person) return;
    const parsed = parseMagnetURI(raw);
    if (!parsed) {
      setError("That does not look like a magnet link.");
      return;
    }
    const setStatus = parentId ? setThreadUploadProgress : setUploadProgress;
    const setBusy = parentId ? setThreadUploading : setUploading;
    setBusy(true);
    setStatus({ label: "Sharing magnet with the lounge…" });
    try {
      const magnet = loungeMagnet(parsed.magnet);
      const payload = serializeFilePayload({
        t: "magnet",
        v: 2,
        kind: "uri",
        infoHash: parsed.infoHash,
        magnet,
        name: parsed.name || "Shared magnet",
        mime: "application/x-bittorrent",
        size: 0,
      });
      if (parentId) {
        if (threadTypingTimer.current) window.clearTimeout(threadTypingTimer.current);
        setThreadTyping(null);
      } else {
        if (typingTimer.current) window.clearTimeout(typingTimer.current);
        setTyping(null);
      }
      wsRef.current?.send(
        JSON.stringify({
          type: "message.send",
          channelId: active.id,
          parentId: parentId || undefined,
          body: payload,
          attachment: { infoHash: parsed.infoHash },
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  async function shareMagnetFile(file: File, parentId?: string) {
    if (/\.magnet$/i.test(file.name) || file.size < 8192) {
      const text = await file.text();
      if (parseMagnetURI(text)) {
        await shareMagnetUri(text, parentId);
        return;
      }
    }
    if (!active || !person) return;
    const setStatus = parentId ? setThreadUploadProgress : setUploadProgress;
    const setBusy = parentId ? setThreadUploading : setUploading;
    setBusy(true);
    setStatus({ label: `Reading ${file.name}…` });
    try {
      const inspected = await inspectTorrentInput(file);
      if (!inspected) throw new Error("Could not read that torrent");
      try {
        await uploadMagnetTorrent(inspected.infoHash, inspected.torrentFile);
      } catch (err) {
        console.warn("Could not store torrent metadata", err);
      }
      const magnet = loungeMagnet(`magnet:?xt=urn:btih:${inspected.infoHash}`);
      const payload = serializeFilePayload({
        t: "magnet",
        v: 2,
        kind: "uri",
        infoHash: inspected.infoHash,
        magnet,
        name: inspected.name || file.name.replace(/\.torrent$/i, ""),
        mime: "application/x-bittorrent",
        size: 0,
      });
      wsRef.current?.send(
        JSON.stringify({
          type: "message.send",
          channelId: active.id,
          parentId: parentId || undefined,
          body: payload,
          attachment: { infoHash: inspected.infoHash },
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  async function handleSendFile(file: File) {
    if (await isMagnetLikeFile(file)) {
      await shareMagnetFile(file);
      return;
    }
    await shareFile(file);
  }

  function handleTyping() {
    if (!wsRef.current || !active) return;
    wsRef.current.send(
      JSON.stringify({ type: "typing", channelId: active.id })
    );
  }

  const decryptedThreadParent = useMemo(() => {
    if (!activeThreadParent) return null;
    const match = decryptedMessages.find((m) => m.id === activeThreadParent.id);
    if (match) return match;
    return activeThreadParent;
  }, [activeThreadParent, decryptedMessages]);

  const libraryItems = useMemo(
    () => uniqueLibraryItems([...library, ...discovered]),
    [library, discovered]
  );

  useEffect(() => {
    const extras = [...decryptedMessages, ...threadDecryptedReplies].filter(
      (m) => m.attachmentId || m.infoHash
    );
    if (!extras.length) return;
    setDiscovered((prev) => uniqueLibraryItems([...extras, ...prev]));
  }, [decryptedMessages, threadDecryptedReplies]);

  useEffect(() => {
    let cancelled = false;
    for (const msg of libraryItems) {
      const key = libraryKey(msg);
      if (!key || posterByKey[key] || !msg.decryptedAttachmentUrl) continue;
      const src = msg.decryptedAttachmentUrl;
      const mime = msg.attachmentType || "";
      generatePoster(src, mime).then((url) => {
        if (cancelled || !url) return;
        setPosterByKey((prev) => (prev[key] ? prev : { ...prev, [key]: url }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [libraryItems, posterByKey]);

  async function handleOpenThread(message: Message) {
    setActiveThreadParent(message);
    setThreadLoading(true);
    try {
      const res = await api<{ parent: Message; replies: Message[] }>(
        `/api/messages/${message.id}/thread`
      );
      const hydrated = hydrateMessage(res.parent, blobCacheRef.current);
      setActiveThreadParent((prev) => ({
        ...hydrated,
        decryptedAttachmentUrl:
          prev?.decryptedAttachmentUrl || hydrated.decryptedAttachmentUrl,
      }));
      setThreadRawReplies(res.replies);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setThreadLoading(false);
    }
  }

  function handleCloseThread() {
    setActiveThreadParent(null);
    setThreadRawReplies([]);
    setThreadDecryptedReplies([]);
    setThreadTyping(null);
  }

  async function handleSendReply(body: string, parentId: string) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !active) {
      setError("Not connected. Refresh and try again.");
      return;
    }

    if (parseMagnetURI(body)) {
      await shareMagnetUri(body, parentId);
      return;
    }

    if (threadTypingTimer.current) window.clearTimeout(threadTypingTimer.current);
    setThreadTyping(null);
    wsRef.current.send(
      JSON.stringify({
        type: "message.send",
        channelId: active.id,
        parentId,
        body,
      })
    );
  }

  async function handleSendReplyFile(file: File, parentId: string) {
    if (await isMagnetLikeFile(file)) {
      await shareMagnetFile(file, parentId);
      return;
    }
    await shareFile(file, parentId);
  }

  function handleThreadTyping(parentId: string) {
    if (!wsRef.current || !active) return;
    wsRef.current.send(
      JSON.stringify({ type: "typing", channelId: active.id, parentId })
    );
  }

  async function handleSignOut() {
    const savedToken = loadSavedToken();
    if (savedToken) {
      try {
        await api("/api/auth/logout", {
          method: "POST",
          body: JSON.stringify({ token: savedToken }),
        });
      } catch {
        // Ignore network failure on logout
      }
    }
    clearAuth();
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "swarm.clear" }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
    destroyTorrentClient();
    blobCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
    blobCacheRef.current.clear();
    setSwarmByHash({});
    setFileTransfers({});
    setPerson(null);
    setOnline([]);
    setRawMessages([]);
    setDecryptedMessages([]);
    setUnreadCounts({});
    setActiveThreadParent(null);
    setThreadRawReplies([]);
    setThreadDecryptedReplies([]);
    setSidebarOpen(false);
    setLibraryRaw([]);
    setLibrary([]);
    setDiscovered([]);
    setPosterByKey({});
    setMainView("chat");
  }

  async function handleSelectDM(otherPerson: Person) {
    if (!person) return;
    try {
      const res = await api<{ channel: Channel }>("/api/dm", {
        method: "POST",
        body: JSON.stringify({ user1Id: person.id, user2Id: otherPerson.id }),
      });
      setChannels((prev) => {
        if (prev.some((c) => c.id === res.channel.id)) return prev;
        return [...prev, res.channel];
      });
      setActiveId(res.channel.id);
      setMainView("chat");
      markChannelAsRead(res.channel.id);
      setActiveThreadParent(null);
      setThreadRawReplies([]);
      setSidebarOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleToggleReaction(messageId: string, emoji: string) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(
      JSON.stringify({
        type: "reaction.toggle",
        messageId,
        emoji,
      })
    );
  }

  async function handleToggleNotifications() {
    if (!notificationsEnabled) {
      if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
        const perm = await requestNotificationPermission();
        if (perm === "granted") {
          setNotificationsEnabled(true);
          saveNotificationSetting(true);
        } else {
          setNotificationsEnabled(false);
          saveNotificationSetting(false);
        }
        return;
      }
      setNotificationsEnabled(true);
      saveNotificationSetting(true);
    } else {
      setNotificationsEnabled(false);
      saveNotificationSetting(false);
    }
  }

  async function handlePickWatchFolder() {
    try {
      const picked = await pickWatchFolder(folderWatch?.folderName);
      if (!picked) return;
      abortFolderWatchUpload();
      const next: FolderWatchSettings = {
        enabled: true,
        channelId: folderWatch?.channelId || active?.id || "ch_general",
        folderName: picked.name,
      };
      dirHandleRef.current = picked.handle;
      saveFolderWatchSettings(next);
      setFolderWatch(next);
      setFolderQueue([]);
      setFolderWatchStatus(`Watching ${picked.name}`);
      setMainView("seeds");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleStopWatchFolder() {
    abortFolderWatchUpload();
    dirHandleRef.current = null;
    await stopWatchingFolder();
    setFolderWatch(null);
    setFolderQueue([]);
    setFolderCurrentKey(null);
    setFolderWatchStatus(null);
  }

  function handleFolderWatchChannel(channelId: string) {
    if (!folderWatch) return;
    const next = { ...folderWatch, channelId };
    saveFolderWatchSettings(next);
    setFolderWatch(next);
  }

  function handleToggleFolderWatch(enabled: boolean) {
    if (!folderWatch) return;
    if (!enabled) abortFolderWatchUpload();
    const next = { ...folderWatch, enabled };
    saveFolderWatchSettings(next);
    setFolderWatch(next);
  }

  function handleSkipFolderVideo(item: FolderQueueItem) {
    blacklistVideo(item.name);
    setFolderQueue((prev) =>
      prev.map((row) => (row.key === item.key ? { ...row, status: "skipped", file: undefined } : row))
    );
    if (folderCurrentKey === item.key) abortFolderWatchUpload();
  }

  if (!boot) {
    return (
      <div className="welcome">
        <div className="welcome-card">
          <h1>Natter</h1>
          <p>{error ? "Could not reach the lounge." : "Loading your lounge…"}</p>
          {error && (
            <p className="welcome-error" style={{ color: "#ff8aa0", marginTop: 8 }}>
              {error}
            </p>
          )}
          {error && (
            <button
              className="primary-btn"
              type="button"
              style={{ marginTop: 16 }}
              onClick={() => {
                setError(null);
                api<Bootstrap>("/api/bootstrap")
                  .then((data) => {
                    setBoot(data);
                    setChannels(data.channels);
                    setPeople(data.people);
                    if (data.unreadCounts) setUnreadCounts(data.unreadCounts);
                    if (data.channels.length) {
                      setActiveId((prev) =>
                        data.channels.some((c) => c.id === prev) ? prev : data.channels[0].id
                      );
                    }
                  })
                  .catch((err) => setError(err instanceof Error ? err.message : String(err)));
              }}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (restoring) {
    return <div className="app-loading">Signing you in...</div>;
  }

  if (!person) {
    return (
      <Welcome
        workspaceName={boot.workspace.name}
        onLogin={handleLogin}
        error={error}
      />
    );
  }

  return (
    <div className={`app-shell ${sidebarOpen ? "sidebar-open" : ""}`}>
      {sidebarOpen && (
        <div
          className="mobile-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        workspaceName={boot.workspace.name}
        channels={channels}
        people={people}
        online={online}
        activeId={mainView === "seeds" ? "view_seeds" : active?.id || ""}
        seedsActive={mainView === "seeds"}
        libraryCount={libraryItems.length}
        me={person}
        connected={connected}
        unreadCounts={unreadCounts}
        mentionCounts={mentionCounts}
        onOpenSeeds={() => {
          setMainView("seeds");
          setActiveThreadParent(null);
          setThreadRawReplies([]);
          setSidebarOpen(false);
        }}
        onSelectChannel={(id) => {
          setMainView("chat");
          setActiveId(id);
          markChannelAsRead(id);
          setActiveThreadParent(null);
          setThreadRawReplies([]);
          setSidebarOpen(false);
        }}
        onSelectDM={handleSelectDM}
        onNewChannel={() => setShowNewChannel(true)}
        onSettings={() => setShowSettings(true)}
        onSignOut={handleSignOut}
        onClose={() => {
          setSidebarOpen(false);
        }}
      />

      {mainView === "seeds" ? (
        <SeedsPage
          items={libraryItems}
          channels={channels}
          shareChannel={active}
          swarmByHash={swarmByHash}
          transfers={fileTransfers}
          posters={posterByKey}
          uploading={uploading}
          uploadProgress={uploadProgress}
          error={error}
          onClearError={() => setError(null)}
          onGet={handleFetchFile}
          onSendFile={handleSendFile}
          onShareMagnet={shareMagnetUri}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          folderWatchStatus={folderWatchStatus}
          folderWatch={folderWatch}
          folderQueue={folderQueue}
          folderCurrentKey={folderCurrentKey}
          onPickWatchFolder={handlePickWatchFolder}
          onPauseFolderWatch={() => handleToggleFolderWatch(false)}
          onResumeFolderWatch={() => handleToggleFolderWatch(true)}
          onStopFolderWatch={handleStopWatchFolder}
          onSkipFolderVideo={handleSkipFolderVideo}
          onOpenSettings={() => setShowSettings(true)}
          currentPersonId={person.id}
          onDelete={handleDeleteMessage}
        />
      ) : (
      <MessagePane
        key={active?.id || "default"}
        channel={active}
        messages={decryptedMessages}
        typing={typing}
        loading={loadingMessages}
        error={error}
        uploading={uploading}
        uploadProgress={uploadProgress}
        onClearError={() => setError(null)}
        onSend={handleSend}
        onSendFile={handleSendFile}
        onTyping={handleTyping}
        onToggleSidebar={() => {
          setSidebarOpen((v) => !v);
        }}
        onOpenSettings={() => setShowSettings(true)}
        onOpenInvite={() => setShowInvite(true)}
        onOpenSeeds={() => {
          setMainView("seeds");
          setActiveThreadParent(null);
          setThreadRawReplies([]);
        }}
        libraryCount={libraryItems.length}
        onOpenThread={handleOpenThread}
        activeThreadId={activeThreadParent?.id || null}
        currentPerson={person}
        people={people}
        onToggleReaction={handleToggleReaction}
        notificationsEnabled={notificationsEnabled}
        onToggleNotifications={handleToggleNotifications}
        swarmByHash={swarmByHash}
        fileTransfers={fileTransfers}
        onFetchFile={handleFetchFile}
        dmPartner={
          active?.kind === "dm"
            ? people.find((p) =>
                p.id === (active.dmUser1Id === person.id ? active.dmUser2Id : active.dmUser1Id)
              )
            : undefined
        }
        folderWatchBanner={
          folderWatch
            ? {
                status: folderWatchStatus,
                currentName: folderQueue.find((item) => item.key === folderCurrentKey)?.name || null,
                waiting: folderQueue.filter((item) => item.status === "queued" || item.status === "copying").length,
                enabled: folderWatch.enabled,
                onSkipCurrent: () => {
                  const current = folderQueue.find((item) => item.key === folderCurrentKey);
                  if (current) handleSkipFolderVideo(current);
                },
                onPause: () => handleToggleFolderWatch(false),
                onResume: () => handleToggleFolderWatch(true),
              }
            : null
        }
        onEditMessage={handleEditMessage}
        onDeleteMessage={handleDeleteMessage}
      />
      )}

      {decryptedThreadParent && mainView === "chat" && (
        <ThreadPane
          key={decryptedThreadParent.id}
          channel={active}
          parentMessage={decryptedThreadParent}
          replies={threadDecryptedReplies}
          typing={threadTyping}
          loading={threadLoading}
          error={error}
          uploading={threadUploading}
          uploadProgress={threadUploadProgress}
          onClose={handleCloseThread}
          onSendReply={handleSendReply}
          onSendReplyFile={handleSendReplyFile}
          onTyping={handleThreadTyping}
          currentPerson={person}
          people={people}
          onToggleReaction={handleToggleReaction}
          swarmByHash={swarmByHash}
          fileTransfers={fileTransfers}
          onFetchFile={handleFetchFile}
          onEditMessage={handleEditMessage}
          onDeleteMessage={handleDeleteMessage}
        />
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          channels={channels.filter((c) => c.kind === "lounge")}
          folderWatch={folderWatch}
          folderWatchStatus={folderWatchStatus}
          folderWatchSupported={supportsFolderWatch()}
          folderQueue={folderQueue}
          folderCurrentKey={folderCurrentKey}
          folderUploading={uploading}
          folderUploadProgress={uploadProgress}
          onPickFolder={handlePickWatchFolder}
          onStopFolder={handleStopWatchFolder}
          onToggleFolderWatch={handleToggleFolderWatch}
          onFolderWatchChannel={handleFolderWatchChannel}
          onSkipFolderVideo={handleSkipFolderVideo}
        />
      )}

      {showNewChannel && (
        <NewChannelModal
          onClose={() => setShowNewChannel(false)}
          onCreated={(channel) => {
            setChannels((prev) =>
              prev.some((c) => c.id === channel.id)
                ? prev
                : [...prev, channel].sort((a, b) => a.name.localeCompare(b.name))
            );
            setActiveId(channel.id);
            setShowNewChannel(false);
          }}
        />
      )}

      {showInvite && (
        <InviteModal onClose={() => setShowInvite(false)} />
      )}
    </div>
  );
}
