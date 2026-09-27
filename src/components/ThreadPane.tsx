import { ChangeEvent, DragEvent, FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Channel,
  formatDay,
  formatTime,
  initials,
  Message,
  Person,
  renderBody,
  sameDay,
  shouldCompact,
  UploadProgress,
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
import { IconDrop, IconPaperclip, IconReactAdd } from "./Icons";

export function ThreadPane({
  channel,
  parentMessage,
  replies,
  typing,
  loading,
  error,
  uploading,
  uploadProgress,
  onClose,
  onSendReply,
  onSendReplyFile,
  onTyping,
  currentPerson,
  people = [],
  onToggleReaction,
  swarmByHash = {},
  fileTransfers = {},
  onFetchFile,
  onEditMessage,
  onDeleteMessage,
}: {
  channel?: Channel;
  parentMessage: Message;
  replies: Message[];
  typing: string | null;
  loading: boolean;
  error: string | null;
  uploading: boolean;
  uploadProgress: UploadProgress | null;
  onClose: () => void;
  onSendReply: (body: string, parentId: string) => void;
  onSendReplyFile: (file: File, parentId: string) => Promise<void>;
  onTyping: (parentId: string) => void;
  currentPerson?: Person | null;
  people?: Person[];
  onToggleReaction: (messageId: string, emoji: string) => void;
  swarmByHash?: Record<string, SwarmPeer[]>;
  fileTransfers?: Record<string, FileTransfer>;
  onFetchFile?: (message: Message) => void;
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

  // Auto scroll to bottom: Default to bottom on thread load,
  // and smoothly stay pinned when at bottom as new replies arrive.
  const scrollToBottom = useCallback((smooth = false) => {
    const list = listRef.current;
    if (!list) return;
    if (smooth) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    } else {
      list.scrollTop = list.scrollHeight;
    }
  }, []);

  const currentParentIdRef = useRef<string | null>(null);
  const shouldSnapToBottomRef = useRef<boolean>(true);
  const wasNearBottomRef = useRef<boolean>(true);

  useEffect(() => {
    if (parentMessage.id !== currentParentIdRef.current) {
      currentParentIdRef.current = parentMessage.id;
      shouldSnapToBottomRef.current = true;
      wasNearBottomRef.current = true;
    }
  }, [parentMessage.id]);

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

      if (replies.length > 0 || !loading) {
        shouldSnapToBottomRef.current = false;
      }

      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }

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
  }, [replies, typing, loading, parentMessage.id, scrollToBottom]);

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
    onTyping(parentMessage.id);

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
    onSendReply(body, parentMessage.id);
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
      await onSendReplyFile(file, parentMessage.id);
    }
  }

  async function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      await onSendReplyFile(file, parentMessage.id);
      e.target.value = "";
    }
  }

  return (
    <aside
      className="thread-pane"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-hint"><IconDrop size={16} /> Drop file here to encrypt & reply in thread</div>
        </div>
      )}

      <header className="thread-header">
        <div style={{ minWidth: 0 }}>
          <h2 className="thread-title">Thread</h2>
          <div className="thread-subtitle">
            {channel?.kind === "dm" ? "Direct Message" : `#${channel?.name || "general"}`}
          </div>
        </div>
        <button
          className="icon-btn"
          type="button"
          onClick={onClose}
          title="Close thread"
          aria-label="Close thread"
        >
          ✕
        </button>
      </header>

      <div className="thread-content" ref={listRef} onScroll={handleScroll}>
        {/* Parent / Root Message */}
        <div className="thread-parent-message">
          <div className="message-row" style={{ padding: "12px 16px 8px", position: "relative" }}>
            <div className="message-actions-bar">
              <div className="quick-reactions-bar">
                {QUICK_EMOJIS.slice(0, 5).map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="quick-reaction-btn"
                    onClick={() => onToggleReaction(parentMessage.id, emoji)}
                    title={`React ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
                <button
                  type="button"
                  className="quick-reaction-btn add-more-emoji"
                  onClick={() =>
                    setPickerMessageId(pickerMessageId === parentMessage.id ? null : parentMessage.id)
                  }
                  title="Add reaction"
                >
                  <IconReactAdd size={14} />
                </button>
              </div>
              <OwnMessageTools
                message={parentMessage}
                personId={currentPerson?.id}
                onEdit={(msg) => setEditingId(msg.id)}
                onDelete={onDeleteMessage}
              />
            </div>

            <div
              className="avatar lg"
              style={{ background: parentMessage.authorColor }}
            >
              {initials(parentMessage.authorName)}
            </div>
            <div>
              <div className="message-meta">
                <span className="message-author">{parentMessage.authorName}</span>
                <span className="message-time">
                  {formatTime(parentMessage.createdAt)}
                  {parentMessage.editedAt ? " (edited)" : ""}
                </span>
              </div>
              {parentMessage.deletedAt ? (
                <div className="message-deleted">This message was deleted</div>
              ) : editingId === parentMessage.id ? (
                <MessageEditForm
                  initial={displayMessageText(parentMessage)}
                  onSave={(body) => {
                    onEditMessage?.(parentMessage, body);
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
              {displayMessageText(parentMessage) && (
                <div
                  className="message-body"
                  dangerouslySetInnerHTML={{
                    __html: renderBody(displayMessageText(parentMessage), currentPerson?.displayName),
                  }}
                />
              )}

              {hasFileShare(parentMessage) && (
                <FileCard
                  message={parentMessage}
                  swarmPeers={parentMessage.infoHash ? swarmByHash[parentMessage.infoHash] || [] : []}
                  people={people}
                  transfer={fileTransfers[libraryKey(parentMessage) || ""]}
                  onGet={(msg) => onFetchFile?.(msg)}
                  compact
                />
              )}
                </>
              )}

              {/* Parent Message Reactions */}
              <MessageReactions
                reactions={parentMessage.reactions}
                currentPerson={currentPerson}
                onToggleReaction={(emoji) => onToggleReaction(parentMessage.id, emoji)}
                onOpenPicker={() => setPickerMessageId(parentMessage.id)}
              />

              {pickerMessageId === parentMessage.id && (
                <EmojiPickerMenu
                  onSelectEmoji={(emoji) => {
                    onToggleReaction(parentMessage.id, emoji);
                    setPickerMessageId(null);
                  }}
                  onClose={() => setPickerMessageId(null)}
                />
              )}
            </div>
          </div>
        </div>

        {/* Reply Count Divider */}
        <div className="thread-divider">
          <span>
            {replies.length === 0
              ? "0 replies"
              : replies.length === 1
              ? "1 reply"
              : `${replies.length} replies`}
          </span>
        </div>

        {/* Thread Replies */}
        {loading && replies.length === 0 && (
          <div style={{ padding: "24px 16px", color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>
            Loading thread…
          </div>
        )}

        {replies.map((reply, index) => {
          const prev = replies[index - 1];
          const showDay = !prev || !sameDay(prev.createdAt, reply.createdAt);
          const compact = shouldCompact(prev, reply);

          return (
            <div key={reply.id}>
              {showDay && (
                <div className="message-day-divider" style={{ margin: "20px 16px 12px" }}>
                  <span className="message-day-pill">{formatDay(reply.createdAt)}</span>
                </div>
              )}
              <div className={`message-row ${compact ? "compact" : ""}`} style={{ padding: compact ? "3px 16px" : "8px 16px", position: "relative" }}>
                <div className="message-actions-bar">
                  <div className="quick-reactions-bar">
                    {QUICK_EMOJIS.slice(0, 5).map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="quick-reaction-btn"
                        onClick={() => onToggleReaction(reply.id, emoji)}
                        title={`React ${emoji}`}
                      >
                        {emoji}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="quick-reaction-btn add-more-emoji"
                      onClick={() =>
                        setPickerMessageId(pickerMessageId === reply.id ? null : reply.id)
                      }
                      title="Add reaction"
                    >
                      <IconReactAdd size={14} />
                    </button>
                  </div>
                  <OwnMessageTools
                    message={reply}
                    personId={currentPerson?.id}
                    onEdit={(msg) => setEditingId(msg.id)}
                    onDelete={onDeleteMessage}
                  />
                </div>

                {compact ? (
                  <div />
                ) : (
                  <div
                    className="avatar sm"
                    style={{ background: reply.authorColor }}
                  >
                    {initials(reply.authorName)}
                  </div>
                )}
                <div>
                  {!compact && (
                    <div className="message-meta">
                      <span className="message-author">{reply.authorName}</span>
                      <span className="message-time">
                        {formatTime(reply.createdAt)}
                        {reply.editedAt ? " (edited)" : ""}
                      </span>
                    </div>
                  )}
                  {reply.deletedAt ? (
                    <div className="message-deleted">This message was deleted</div>
                  ) : editingId === reply.id ? (
                    <MessageEditForm
                      initial={displayMessageText(reply)}
                      onSave={(body) => {
                        onEditMessage?.(reply, body);
                        setEditingId(null);
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <>
                  {displayMessageText(reply) && (
                    <div
                      className="message-body"
                      dangerouslySetInnerHTML={{
                        __html: renderBody(displayMessageText(reply), currentPerson?.displayName),
                      }}
                    />
                  )}

                  {hasFileShare(reply) && (
                    <FileCard
                      message={reply}
                      swarmPeers={reply.infoHash ? swarmByHash[reply.infoHash] || [] : []}
                      people={people}
                      transfer={fileTransfers[libraryKey(reply) || ""]}
                      onGet={(msg) => onFetchFile?.(msg)}
                      compact
                    />
                  )}
                    </>
                  )}

                  {/* Reply Reactions */}
                  <MessageReactions
                    reactions={reply.reactions}
                    currentPerson={currentPerson}
                    onToggleReaction={(emoji) => onToggleReaction(reply.id, emoji)}
                    onOpenPicker={() => setPickerMessageId(reply.id)}
                  />

                  {pickerMessageId === reply.id && (
                    <EmojiPickerMenu
                      onSelectEmoji={(emoji) => {
                        onToggleReaction(reply.id, emoji);
                        setPickerMessageId(null);
                      }}
                      onClose={() => setPickerMessageId(null)}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="typing" style={{ padding: "0 16px 4px" }}>
        {typing || ""}
      </div>

      <form className="composer-wrap" onSubmit={submit} style={{ padding: "0 16px 16px", position: "relative" }}>
        {/* Mention Autocomplete Dropdown */}
        {mentionQuery !== null && filteredMentionPeople.length > 0 && (
          <div className="mention-autocomplete" style={{ left: 16, right: 16 }}>
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

        {uploading && (
          <UploadPill progress={uploadProgress} fallback="Encrypting and uploading file…" />
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
            placeholder="Reply in thread (type @ to mention, drop files to encrypt)…"
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
                title="Attach & Encrypt File"
                style={{ fontSize: 18 }}
              >
                <IconPaperclip size={16} />
              </button>
              <span className="hint">Enter to reply</span>
            </div>
            <button className="primary-btn" type="submit" disabled={!draft.trim() && !uploading}>
              Reply
            </button>
          </div>
        </div>
      </form>
    </aside>
  );
}
