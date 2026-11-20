import { DragEvent, FormEvent, useMemo, useState } from "react";
import { Channel, formatBytes, Message, UploadProgress } from "../lib";
import {
  FileTransfer,
  isUriMagnet,
  libraryKey,
  SwarmPeer,
} from "../filePayload";
import { FolderWatchPanel } from "./FolderWatchPanel";
import { IconMenu, IconFile, fileKindFromMime } from "./Icons";
import { FolderQueueItem } from "../folderWatch";

type Filter = "all" | "video" | "image" | "audio" | "other";

export function SeedsPage({
  items,
  channels,
  shareChannel,
  swarmByHash,
  transfers,
  posters,
  uploading,
  uploadProgress,
  error,
  onClearError,
  onGet,
  onSendFile,
  onShareMagnet,
  onToggleSidebar,
  folderWatchStatus,
  folderWatch,
  folderQueue = [],
  folderCurrentKey,
  onPickWatchFolder,
  onPauseFolderWatch,
  onResumeFolderWatch,
  onStopFolderWatch,
  onSkipFolderVideo,
  onOpenSettings,
  currentPersonId,
  onDelete,
}: {
  items: Message[];
  channels: Channel[];
  shareChannel?: Channel;
  swarmByHash: Record<string, SwarmPeer[]>;
  transfers: Record<string, FileTransfer>;
  posters: Record<string, string>;
  uploading: boolean;
  uploadProgress: UploadProgress | null;
  error: string | null;
  onClearError: () => void;
  onGet: (message: Message) => void;
  onSendFile: (file: File) => Promise<void>;
  onShareMagnet: (magnet: string) => Promise<void>;
  onToggleSidebar: () => void;
  folderWatchStatus?: string | null;
  folderWatch?: { enabled: boolean; folderName: string } | null;
  folderQueue?: FolderQueueItem[];
  folderCurrentKey?: string | null;
  onPickWatchFolder?: () => void;
  onPauseFolderWatch?: () => void;
  onResumeFolderWatch?: () => void;
  onStopFolderWatch?: () => void;
  onSkipFolderVideo?: (item: FolderQueueItem) => void;
  onOpenSettings?: () => void;
  currentPersonId?: string;
  onDelete?: (message: Message) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [channelId, setChannelId] = useState<string>("all");
  const [magnetDraft, setMagnetDraft] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const filtered = useMemo(() => {
    return items.filter((msg) => {
      if (channelId !== "all" && msg.channelId !== channelId) return false;
      const kind = mediaKind(msg);
      if (filter === "all") return true;
      return kind === filter;
    });
  }, [items, filter, channelId]);

  const channelOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const msg of items) {
      if (!seen.has(msg.channelId)) {
        seen.set(msg.channelId, msg.channelName || channels.find((c) => c.id === msg.channelId)?.name || msg.channelId);
      }
    }
    return [...seen.entries()];
  }, [items, channels]);

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
    const file = e.dataTransfer.files?.[0];
    if (file) await onSendFile(file);
  }

  async function submitMagnet(e: FormEvent) {
    e.preventDefault();
    const value = magnetDraft.trim();
    if (!value) return;
    await onShareMagnet(value);
    setMagnetDraft("");
  }

  return (
    <main
      className="main seeds-page"
      style={{ position: "relative" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="drop-overlay">
          <div>Drop a file, .torrent, or .magnet — it joins the lounge swarm</div>
        </div>
      )}

      <header className="channel-header seeds-header">
        <div className="seeds-header-left">
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
          <div className="seeds-header-copy">
            <h1>Seeds</h1>
            <div className="channel-topic">
              {shareChannel
                ? shareChannel.kind === "dm"
                  ? "New shares go to this DM. More seeds, faster Gets."
                  : `New shares go to #${shareChannel.name}. More seeds, faster Gets.`
                : "Library of magnets and shared files in the lounge."}
            </div>
          </div>
        </div>
        <form className="seeds-magnet-form" onSubmit={submitMagnet}>
          <input
            value={magnetDraft}
            onChange={(e) => setMagnetDraft(e.target.value)}
            placeholder="Paste magnet:?…"
            aria-label="Paste a magnet link"
          />
          <button className="primary-btn" type="submit" disabled={!magnetDraft.trim() || uploading}>
            Share
          </button>
        </form>
      </header>

      <FolderWatchPanel
        folderName={folderWatch?.folderName}
        status={folderWatchStatus}
        enabled={folderWatch?.enabled}
        items={folderQueue}
        currentKey={folderCurrentKey}
        uploading={uploading}
        uploadProgress={uploadProgress}
        onPickFolder={onPickWatchFolder}
        onPause={onPauseFolderWatch}
        onResume={onResumeFolderWatch}
        onStop={onStopFolderWatch}
        onSkip={onSkipFolderVideo}
        onOpenSettings={onOpenSettings}
      />

      <div className="seeds-toolbar">
        <div className="seeds-chips" role="tablist" aria-label="Filter seeds">
          {(["all", "video", "image", "audio", "other"] as Filter[]).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={`seeds-chip ${filter === id ? "active" : ""}`}
              onClick={() => setFilter(id)}
            >
              {chipLabel(id)}
            </button>
          ))}
        </div>
        {channelOptions.length > 1 && (
          <div className="seeds-chips seeds-channel-chips">
            <button
              type="button"
              className={`seeds-chip ${channelId === "all" ? "active" : ""}`}
              onClick={() => setChannelId("all")}
            >
              All channels
            </button>
            {channelOptions.map(([id, name]) => (
              <button
                key={id}
                type="button"
                className={`seeds-chip ${channelId === id ? "active" : ""}`}
                onClick={() => setChannelId(id)}
              >
                #{name}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="error-banner" style={{ margin: "0 16px 8px" }}>
          {error}{" "}
          <button className="icon-btn" type="button" onClick={onClearError}>
            dismiss
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="seeds-empty">
          <h2>Nothing in the library yet</h2>
          <p>
            Drop a file, a <code>.torrent</code>, or paste a magnet. Everyone who hits Get becomes another seed.
          </p>
        </div>
      ) : (
        <div className="seeds-grid">
          {filtered.map((msg) => {
            const key = libraryKey(msg) || msg.id;
            const name = msg.attachmentName || "Shared magnet";
            const peers = msg.infoHash ? swarmByHash[msg.infoHash] || [] : [];
            const seeds = peers.filter((p) => p.role === "seed");
            const leeches = peers.filter((p) => p.role === "leech");
            const transfer = transfers[key];
            const ready = Boolean(msg.decryptedAttachmentUrl);
            const downloading = transfer?.status === "downloading";
            const poster = posters[key];
            const channelName =
              msg.channelName || channels.find((c) => c.id === msg.channelId)?.name || "";
            return (
              <article key={key} className="seed-tile">
                <div className="seed-poster">
                  {poster ? (
                    <img src={poster} alt="" />
                  ) : (
                    <div className={`seed-placeholder kind-${mediaKind(msg)}`}>
                      <span className="ui-icon">
                        <IconFile kind={fileKindFromMime(msg.attachmentType)} size={22} />
                      </span>
                    </div>
                  )}
                  <div className="seed-poster-overlay">
                    {ready ? (
                      <a
                        href={msg.decryptedAttachmentUrl}
                        download={name}
                        className="primary-btn"
                      >
                        Save
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={() => onGet(msg)}
                        disabled={downloading}
                      >
                        {downloading ? `${Math.round((transfer?.progress || 0) * 100)}%` : "Get"}
                      </button>
                    )}
                    {currentPersonId && msg.authorId === currentPersonId && onDelete && (
                      <button
                        type="button"
                        className="ghost-btn seed-delete-btn"
                        onClick={() => onDelete(msg)}
                      >
                        Delete
                      </button>
                    )}
                    <div className="seed-overlay-meta">
                      {msg.attachmentSize ? formatBytes(msg.attachmentSize) : isUriMagnet(msg) ? "magnet" : ""}
                      {seeds.length ? ` · ${seeds.length} seed${seeds.length === 1 ? "" : "s"}` : ""}
                    </div>
                  </div>
                  {(downloading || seeds.length > 0) && (
                    <div className="seed-poster-bar">
                      <div
                        className="seed-poster-bar-fill"
                        style={{ width: `${Math.round((transfer?.progress || (ready ? 1 : 0)) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
                <div className="seed-tile-copy">
                  <div className="seed-title" title={name}>
                    {name}
                  </div>
                  <div className="seed-sub">
                    {channelName ? `#${channelName}` : ""}
                    {seeds.length > 0 ? (
                      <span className="seed-faces" title={seeds.map((p) => p.displayName).join(", ")}>
                        {seeds.slice(0, 4).map((p) => (
                          <span key={p.personId} className="swarm-face" style={{ background: p.color }}>
                            {p.displayName.trim().slice(0, 1).toUpperCase()}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    {leeches.length > 0 ? (
                      <span className="seed-leech">{leeches.length} getting</span>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}

function mediaKind(msg: Message): Filter {
  const mime = msg.attachmentType || "";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  return "other";
}

function chipLabel(id: Filter) {
  if (id === "all") return "All";
  if (id === "video") return "Videos";
  if (id === "image") return "Images";
  if (id === "audio") return "Audio";
  return "Other";
}
