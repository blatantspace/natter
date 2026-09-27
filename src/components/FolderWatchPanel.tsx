import { formatBytes, UploadProgress } from "../lib";
import { FolderQueueItem } from "../folderWatch";
import { UploadPill } from "./UploadPill";

const VISIBLE_LIMIT = 12;

export function FolderWatchPanel({
  folderName,
  status,
  enabled,
  items,
  currentKey,
  uploading,
  uploadProgress,
  onPickFolder,
  onPause,
  onResume,
  onStop,
  onSkip,
  onOpenSettings,
}: {
  folderName?: string | null;
  status?: string | null;
  enabled?: boolean;
  items: FolderQueueItem[];
  currentKey?: string | null;
  uploading?: boolean;
  uploadProgress?: UploadProgress | null;
  onPickFolder?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  onSkip?: (item: FolderQueueItem) => void;
  onOpenSettings?: () => void;
}) {
  const active = items.filter((item) => item.status !== "skipped");
  const skipped = items.filter((item) => item.status === "skipped");
  const visible = active.slice(0, VISIBLE_LIMIT);
  const hidden = Math.max(0, active.length - visible.length);

  return (
    <div className="folder-watch-panel">
      <div className="seeds-watch-bar">
        <span className="seeds-watch-copy">
          {status ||
            (folderName
              ? `Watching ${folderName}`
              : "Pick a folder and videos in it start seeding. Skip any you don't want.")}
        </span>
        <div className="seeds-watch-actions">
          {folderName && enabled && (
            <button className="ghost-btn" type="button" onClick={onPause}>
              Pause
            </button>
          )}
          {folderName && !enabled && (
            <button className="ghost-btn" type="button" onClick={onResume}>
              Resume
            </button>
          )}
          <button className="ghost-btn" type="button" onClick={onPickFolder}>
            {folderName ? "Change folder" : "Watch folder"}
          </button>
          {folderName && (
            <button className="ghost-btn" type="button" onClick={onStop}>
              Stop
            </button>
          )}
          {onOpenSettings && (
            <button className="ghost-btn" type="button" onClick={onOpenSettings}>
              Settings
            </button>
          )}
        </div>
      </div>

      {uploading && (
        <div className="folder-watch-upload">
          <UploadPill progress={uploadProgress || null} fallback="Seeding from folder…" />
        </div>
      )}

      {folderName && active.length > 0 && (
        <ul className="folder-watch-queue">
          {visible.map((item) => {
            const current = item.key === currentKey;
            const label = current
              ? "Seeding"
              : item.status === "copying"
                ? "Copying"
                : enabled
                  ? "Waiting"
                  : "Paused";
            return (
              <li key={item.key} className={`folder-watch-row ${current ? "is-current" : ""}`}>
                <span className="folder-watch-name" title={item.name}>
                  {item.name}
                </span>
                <span className="folder-watch-meta">{formatBytes(item.size)}</span>
                <span className="folder-watch-state">{label}</span>
                <button
                  className="ghost-btn folder-watch-skip"
                  type="button"
                  onClick={() => onSkip?.(item)}
                  title="Don't seed this file"
                >
                  Skip
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {(hidden > 0 || skipped.length > 0) && (
        <div className="folder-watch-foot">
          {hidden > 0 && <span>{hidden} more in the folder</span>}
          {skipped.length > 0 && <span>{skipped.length} skipped</span>}
        </div>
      )}
    </div>
  );
}
