import { ChangeEvent, DragEvent, FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Channel,
  formatDay,
  formatRelativeTime,
  formatTime,
  initials,
  Message,
  Person,
  renderBody,
  UploadProgress,
  sameDay,
  shouldCompact,
} from "../lib";
import {
  EmojiPickerMenu,
  MessageReactions,
  QUICK_EMOJIS,
} from "./EmojiReactions";
import { FileCard } from "./FileCard";
import { UploadPill } from "./UploadPill";
import { displayMessageText, FileTransfer, hasFileShare, libraryKey, SwarmPeer } from "../filePayload";
import { MessageEditForm, OwnMessageTools } from "./MessageTools";
import {
  IconMenu,
  IconPaperclip,
  IconReactAdd,
  IconReply,
  IconThread,
} from "./Icons";

export function MessagePane({
  channel,
  messages,
  typing,
  loading,
  error,
  uploading,
  uploadProgress,
  onClearError,
  onSend,
  onSendFile,
  onTyping,
  sidebarOpen,
  onToggleSidebar,
  onOpenSettings,
  onOpenInvite,
  onOpenSeeds,
  libraryCount = 0,
  dmPartner,
  onOpenThread,
  activeThreadId,
  currentPerson,
  people = [],
  onToggleReaction,
  notificationsEnabled,
  onToggleNotifications,
  swarmByHash = {},
  fileTransfers = {},
  onFetchFile,
  folderWatchBanner,
  onEditMessage,
  onDeleteMessage,
}: {
  channel?: Channel;
  messages: Message[];
  typing: string | null;
  loading: boolean;
  error: string | null;
  uploading: boolean;
  uploadProgress: UploadProgress | null;
  onClearError: () => void;
  onSend: (body: string) => void;
  onSendFile: (file: File) => Promise<void>;
  onTyping: () => void;
  sidebarOpen?: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  onOpenInvite: () => void;
  onOpenSeeds?: () => void;
  libraryCount?: number;
  dmPartner?: { displayName: string; color: string };
  onOpenThread: (message: Message) => void;
  activeThreadId?: string | null;
  currentPerson?: Person | null;
  people?: Person[];
  onToggleReaction: (messageId: string, emoji: string) => void;
  notificationsEnabled?: boolean;
  onToggleNotifications?: () => void;
  swarmByHash?: Record<string, SwarmPeer[]>;
  fileTransfers?: Record<string, FileTransfer>;
  onFetchFile?: (message: Message) => void;
  folderWatchBanner?: {
    status: string | null;
    currentName: string | null;
    waiting: number;
    enabled: boolean;
    onSkipCurrent: () => void;
    onPause: () => void;
    onResume: () => void;
  } | null;
  onEditMessage?: (message: Message, body: string) => void;
  onDeleteMessage?: (message: Message) => void;
}) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pickerMessageId, setPickerMessageId] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const endRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto scroll to bottom: Default to bottom on page load / channel switch,
  // and smoothly stay pinned when at bottom as new messages arrive.
  const scrollToBottom = useCallback((smooth = false) => {
    const list = listRef.current;
    if (!list) return;
    if (smooth) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    } else {
      list.scrollTop = list.scrollHeight;
    }
  }, []);

  const currentChannelIdRef = useRef<string | null>(null);
  const shouldSnapToBottomRef = useRef<boolean>(true);
  const wasNearBottomRef = useRef<boolean>(true);

  // Reset initial load flag when channel switches
  useEffect(() => {
    if (channel?.id !== currentChannelIdRef.current) {
      currentChannelIdRef.current = channel?.id || null;
      shouldSnapToBottomRef.current = true;
      wasNearBottomRef.current = true;
    }
  }, [channel?.id]);

  const handleScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    wasNearBottomRef.current = distanceFromBottom < 150;
  };

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    if (shouldSnapToBottomRef.current) {
      scrollToBottom(false);

      const raf = requestAnimationFrame(() => {
        scrollToBottom(false);
      });
      const t1 = setTimeout(() => {
        scrollToBottom(false);
      }, 50);
      const t2 = setTimeout(() => {
        scrollToBottom(false);
      }, 150);
      const t3 = setTimeout(() => {
        scrollToBottom(false);
      }, 350);

      if (messages.length > 0 || !loading) {
        shouldSnapToBottomRef.current = false;
      }

      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }

    // Always keep snapped to bottom if user was near bottom or if new message arrived
    if (wasNearBottomRef.current) {
      scrollToBottom(false);
      requestAnimationFrame(() => {
        scrollToBottom(false);
      });
      const t = setTimeout(() => {
        scrollToBottom(false);
      }, 80);
      return () => clearTimeout(t);
    }
  }, [messages, typing, loading, channel?.id, scrollToBottom]);

  // @mention filtering
  const filteredMentionPeople = (mentionQuery !== null
    ? people.filter(
        (p) =>
          p.id !== "u_natter" &&
          p.displayName.toLowerCase().startsWith(mentionQuery.toLowerCase())
      )
    : []
  ).slice(0, 6);

  function handleDraftChange(text: string) {
    setDraft(text);
    onTyping();

    // Check if cursor is directly after an @mention prefix
    const cursorPos = textareaRef.current?.selectionStart ?? text.length;
    const textBeforeCursor = text.slice(0, cursorPos);
    const match = textBeforeCursor.match(/@([a-zA-Z0-9_.-]*)$/);

    if (match) {
      setMentionQuery(match[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }

  function insertMention(personToMention: Person) {
    const textarea = textareaRef.current;
    const cursorPos = textarea?.selectionStart ?? draft.length;
    const textBeforeCursor = draft.slice(0, cursorPos);
    const textAfterCursor = draft.slice(cursorPos);

    const match = textBeforeCursor.match(/@([a-zA-Z0-9_.-]*)$/);
    if (!match) return;

    const start = match.index!;
    const nameWithoutSpaces = personToMention.displayName.replace(/\s+/g, "_");
    const replacement = `@${nameWithoutSpaces} `;
    const newDraft = draft.slice(0, start) + replacement + textAfterCursor;

    setDraft(newDraft);
    setMentionQuery(null);

    requestAnimationFrame(() => {
      if (textarea) {
        textarea.focus();
        const newPos = start + replacement.length;
        textarea.setSelectionRange(newPos, newPos);
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && filteredMentionPeople.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % filteredMentionPeople.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((prev) =>
          prev === 0 ? filteredMentionPeople.length - 1 : prev - 1
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredMentionPeople[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setMentionQuery(null);
    wasNearBottomRef.current = true;
    onSend(body);
    setDraft("");
    requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    setIsDragging(false);
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      await onSendFile(file);
    }
  }

  async function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      await onSendFile(file);
      e.target.value = "";
    }
  }

  if (!channel) {
    return (
      <main className="main">
        <div className="empty-channel">
          <h2>No channels yet</h2>
          <p>Create one from the sidebar and start chatting.</p>
        </div>
      </main>
    );
  }

  return (
    <main
      className="main"
      style={{ position: "relative" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="drop-overlay">
          <div>Drop a file, .torrent, or .magnet to share with the lounge</div>
        </div>
      )}

      <header className="channel-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <button
            className="icon-btn"
            type="button"
            onClick={onToggleSidebar}
            aria-label="Toggle sidebar"
            title="Toggle sidebar"
            id="mobile-menu-btn"
          >
            <IconMenu size={16} />
          </button>
          <div style={{ minWidth: 0 }}>
            <h1>
              {channel.kind === "dm" && dmPartner ? (
                <>
                  <div
                    className="avatar sm"
                    style={{
                      background: dmPartner.color,
                      width: 22,
                      height: 22,
                      fontSize: 11,
                        display: "inline-grid",
                    }}
                  >
                    {initials(dmPartner.displayName)}
                  </div>
                  <span>{dmPartner.displayName}</span>
                </>
              ) : (
                <>
                  <span className="channel-hash">#</span>
                  <span>{channel.name}</span>
                </>
              )}
            </h1>
            <div className="channel-topic">{channel.topic}</div>
          </div>
        </div>
        <div className="header-actions">
          {channel.kind === "dm" && (
            <span className="status-pill ok">Direct Message</span>
          )}
          <button
            className={`icon-btn notif-toggle-btn ${notificationsEnabled ? "is-on" : "is-off"}`}
            type="button"
            onClick={onToggleNotifications}
            aria-label={
              notificationsEnabled
                ? "Mute desktop alerts"
                : "Unmute desktop alerts"
            }
            title={
              notificationsEnabled
                ? "Alerts on — click to mute"
                : "Alerts muted — click to unmute"
            }
          >
            <span className="pixel-speaker" aria-hidden="true">
              <svg width="16" height="14" viewBox="0 0 16 14" shapeRendering="crispEdges">
                <rect x="1" y="4" width="3" height="6" fill="currentColor" />
                <path d="M4 4 L8 1 L8 13 L4 10 Z" fill="currentColor" />
                {notificationsEnabled ? (
                  <>
                    <rect x="10" y="3" width="1" height="1" fill="currentColor" />
                    <rect x="11" y="4" width="1" height="1" fill="currentColor" />
                    <rect x="12" y="5" width="1" height="4" fill="currentColor" />
                    <rect x="11" y="9" width="1" height="1" fill="currentColor" />
                    <rect x="10" y="10" width="1" height="1" fill="currentColor" />
                    <rect x="13" y="2" width="1" height="1" fill="currentColor" />
                    <rect x="14" y="3" width="1" height="1" fill="currentColor" />
                    <rect x="15" y="4" width="1" height="6" fill="currentColor" />
                    <rect x="14" y="10" width="1" height="1" fill="currentColor" />
                    <rect x="13" y="11" width="1" height="1" fill="currentColor" />
                  </>
                ) : (
                  <>
                    <rect x="10" y="3" width="1" height="1" fill="currentColor" />
                    <rect x="11" y="4" width="1" height="1" fill="currentColor" />
                    <rect x="12" y="5" width="1" height="1" fill="currentColor" />
                    <rect x="13" y="6" width="1" height="1" fill="currentColor" />
                    <rect x="12" y="7" width="1" height="1" fill="currentColor" />
                    <rect x="11" y="8" width="1" height="1" fill="currentColor" />
                    <rect x="10" y="9" width="1" height="1" fill="currentColor" />
                    <rect x="13" y="3" width="1" height="1" fill="currentColor" />
                    <rect x="12" y="4" width="1" height="1" fill="currentColor" />
                    <rect x="11" y="5" width="1" height="1" fill="currentColor" />
                    <rect x="10" y="6" width="1" height="1" fill="currentColor" />
                    <rect x="11" y="7" width="1" height="1" fill="currentColor" />
                    <rect x="12" y="8" width="1" height="1" fill="currentColor" />
                    <rect x="13" y="9" width="1" height="1" fill="currentColor" />
                  </>
                )}
              </svg>
            </span>
          </button>
          <button
            className="ghost-btn"
            type="button"
            onClick={onOpenInvite}
            title="Copy a link so a friend can join this room"
          >
            Invite…
          </button>
          <button
            className="ghost-btn"
            type="button"
            onClick={onOpenSeeds}
            title="Open the Seeds library"
          >
            Seeds{libraryCount ? ` (${libraryCount})` : ""}
          </button>
          <button className="ghost-btn" type="button" onClick={onOpenSettings}>
            Settings
          </button>
        </div>
      </header>

      <div className="messages" ref={listRef} onScroll={handleScroll}>
        {error && (
          <div className="error-banner" style={{ margin: "12px 20px" }}>
            {error}{" "}
            <button className="icon-btn" type="button" onClick={onClearError}>
              dismiss
            </button>
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="empty-channel">
            <h2>#{channel.name}</h2>
            <p>
              {channel.topic ||
                "This is the very beginning of the channel. Say something."}
            </p>
          </div>
        )}

        {messages.map((message, index) => {
          const prev = messages[index - 1];
          const showDay = !prev || !sameDay(prev.createdAt, message.createdAt);
          const compact = shouldCompact(prev, message);

          return (
            <div key={message.id}>
              {showDay && (
                <div className="message-day-divider">
                  <span className="message-day-pill">{formatDay(message.createdAt)}</span>
                </div>
              )}
              <div className={`message-row ${compact ? "compact" : ""} ${activeThreadId === message.id ? "active-thread" : ""}`}>
                {/* Floating message hover toolbar */}
                <div className="message-actions-bar">
                  <div className="quick-reactions-bar">
                    {QUICK_EMOJIS.slice(0, 5).map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="quick-reaction-btn"
                        onClick={() => onToggleReaction(message.id, emoji)}
                        title={`React ${emoji}`}
                      >
                        {emoji}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="quick-reaction-btn add-more-emoji"
                      onClick={() =>
                        setPickerMessageId(pickerMessageId === message.id ? null : message.id)
                      }
                      title="Add reaction"
                    >
                      <IconReactAdd size={14} />
                    </button>
                  </div>
                  <div className="actions-divider" />
                  <button
                    type="button"
                    className="action-pill-btn"
                    onClick={() => onOpenThread(message)}
                    title="Reply in thread"
                  >
                    <IconReply size={14} /> <span className="action-label">Reply in thread</span>
                  </button>
                  <OwnMessageTools
                    message={message}
                    personId={currentPerson?.id}
                    onEdit={(msg) => setEditingId(msg.id)}
                    onDelete={onDeleteMessage}
                  />
                </div>

                {compact ? (
                  <div />
                ) : (
                  <div
                    className="avatar lg"
                    style={{ background: message.authorColor }}
                  >
                    {initials(message.authorName)}
                  </div>
                )}
                <div>
                  {!compact && (
                    <div className="message-meta">
                      <span className="message-author">{message.authorName}</span>
                      <span className="message-time">
                        {formatTime(message.createdAt)}
                        {message.editedAt ? " (edited)" : ""}
                      </span>
                    </div>
                  )}
                  {message.deletedAt ? (
                    <div className="message-deleted">This message was deleted</div>
                  ) : editingId === message.id ? (
                    <MessageEditForm
                      initial={displayMessageText(message)}
                      onSave={(body) => {
                        onEditMessage?.(message, body);
                        setEditingId(null);
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <>
                  {displayMessageText(message) && (
                    <div
                      className="message-body"
                      dangerouslySetInnerHTML={{
                        __html: renderBody(displayMessageText(message), currentPerson?.displayName),
                      }}
                    />
                  )}

                  {hasFileShare(message) && (
                    <FileCard
                      message={message}
                      swarmPeers={message.infoHash ? swarmByHash[message.infoHash] || [] : []}
                      people={people}
                      transfer={fileTransfers[libraryKey(message) || ""]}
                      onGet={(msg) => onFetchFile?.(msg)}
                    />
                  )}
                    </>
                  )}

                  {/* Emoji Reactions Row */}
                  <MessageReactions
                    reactions={message.reactions}
                    currentPerson={currentPerson}
                    onToggleReaction={(emoji) => onToggleReaction(message.id, emoji)}
                    onOpenPicker={() => setPickerMessageId(message.id)}
                  />

                  {/* Emoji Picker Popover */}
                  {pickerMessageId === message.id && (
                    <EmojiPickerMenu
                      onSelectEmoji={(emoji) => {
                        onToggleReaction(message.id, emoji);
                        setPickerMessageId(null);
                      }}
                      onClose={() => setPickerMessageId(null)}
                    />
                  )}

                  {/* Slack-like Thread Reply Pill */}
                  {message.replyCount && message.replyCount > 0 ? (
                    <button
                      type="button"
                      className="thread-reply-pill"
                      onClick={() => onOpenThread(message)}
                    >
                      <span className="thread-reply-icon"><IconThread size={13} /></span>
                      <span className="thread-reply-count">
                        {message.replyCount === 1 ? "1 reply" : `${message.replyCount} replies`}
                      </span>
                      {message.lastReplyAt && (
                        <span className="thread-reply-time">
                          Last reply {formatRelativeTime(message.lastReplyAt)}
                        </span>
                      )}
                      <span className="thread-reply-cta">View thread →</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="typing">{typing || ""}</div>

      <form className="composer-wrap" onSubmit={submit} style={{ position: "relative" }}>
        {/* Mention Autocomplete Dropdown */}
        {mentionQuery !== null && filteredMentionPeople.length > 0 && (
          <div className="mention-autocomplete">
            {filteredMentionPeople.map((p, idx) => (
              <button
                key={p.id}
                type="button"
                className={`mention-item ${idx === mentionIndex ? "selected" : ""}`}
                onClick={() => insertMention(p)}
              >
                <div
                  className="avatar sm"
                  style={{
                    background: p.color,
                    width: 20,
                    height: 20,
                    fontSize: 10,
                  }}
                >
                  {initials(p.displayName)}
                </div>
                <span className="mention-item-name">@{p.displayName}</span>
                <span className="mention-item-hint">Tab or Enter</span>
              </button>
            ))}
          </div>
        )}

        {folderWatchBanner && (folderWatchBanner.waiting > 0 || folderWatchBanner.currentName) && (
          <div className="folder-watch-chat-bar">
            <span>
              {folderWatchBanner.status ||
                (folderWatchBanner.currentName
                  ? `Seeding ${folderWatchBanner.currentName}`
                  : `${folderWatchBanner.waiting} videos waiting`)}
            </span>
            <div className="seeds-watch-actions">
              {folderWatchBanner.currentName && (
                <button className="ghost-btn" type="button" onClick={folderWatchBanner.onSkipCurrent}>
                  Skip
                </button>
              )}
              {folderWatchBanner.enabled ? (
                <button className="ghost-btn" type="button" onClick={folderWatchBanner.onPause}>
                  Pause
                </button>
              ) : (
                <button className="ghost-btn" type="button" onClick={folderWatchBanner.onResume}>
                  Resume
                </button>
              )}
              {onOpenSeeds && (
                <button className="ghost-btn" type="button" onClick={onOpenSeeds}>
                  Queue
                </button>
              )}
            </div>
          </div>
        )}
        {uploading && (
          <UploadPill progress={uploadProgress} fallback="Uploading file…" />
        )}
        <div className="composer">
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            onChange={handleFileInputChange}
          />
          <textarea
            ref={textareaRef}
            value={draft}
            placeholder={
              channel.kind === "dm" && dmPartner
                ? `Direct message with ${dmPartner.displayName} (drop files or paste a magnet)`
                : `Message #${channel.name} (drop files or paste a magnet)`
            }
            rows={1}
            onChange={(e) => handleDraftChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="composer-footer">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                className="icon-btn"
                onClick={() => fileInputRef.current?.click()}
                title="Attach file"
              >
                <IconPaperclip size={16} />
              </button>
              <span className="hint">Enter to send · Drag & drop files</span>
            </div>
            <button className="primary-btn" type="submit" disabled={!draft.trim() && !uploading}>
              Send
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}
