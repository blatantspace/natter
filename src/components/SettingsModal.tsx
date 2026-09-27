import { useState } from "react";
import {
  Channel,
  loadNotificationSetting,
  loadSoundSetting,
  playNotificationChime,
  requestNotificationPermission,
  saveNotificationSetting,
  saveSoundSetting,
  UploadProgress,
} from "../lib";
import { FolderWatchSettings, FolderQueueItem } from "../folderWatch";
import { FolderWatchPanel } from "./FolderWatchPanel";

export function SettingsModal({
  onClose,
  channels = [],
  folderWatch,
  folderWatchStatus,
  folderWatchSupported = false,
  folderQueue = [],
  folderCurrentKey,
  folderUploading = false,
  folderUploadProgress = null,
  onPickFolder,
  onStopFolder,
  onToggleFolderWatch,
  onFolderWatchChannel,
  onSkipFolderVideo,
}: {
  onClose: () => void;
  channels?: Channel[];
  folderWatch?: FolderWatchSettings | null;
  folderWatchStatus?: string | null;
  folderWatchSupported?: boolean;
  folderQueue?: FolderQueueItem[];
  folderCurrentKey?: string | null;
  folderUploading?: boolean;
  folderUploadProgress?: UploadProgress | null;
  onPickFolder?: () => void;
  onStopFolder?: () => void;
  onToggleFolderWatch?: (enabled: boolean) => void;
  onFolderWatchChannel?: (channelId: string) => void;
  onSkipFolderVideo?: (item: FolderQueueItem) => void;
}) {
  const [notificationsEnabled, setNotificationsEnabled] = useState(() =>
    loadNotificationSetting()
  );
  const [soundEnabled, setSoundEnabled] = useState(() => loadSoundSetting());
  const [permissionState, setPermissionState] = useState<NotificationPermission>(() =>
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );

  async function handleToggleNotifications(enabled: boolean) {
    if (enabled && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const perm = await requestNotificationPermission();
      setPermissionState(perm);
      if (perm === "granted") {
        setNotificationsEnabled(true);
        saveNotificationSetting(true);
      } else {
        setNotificationsEnabled(false);
        saveNotificationSetting(false);
      }
      return;
    }
    setNotificationsEnabled(enabled);
    saveNotificationSetting(enabled);
  }

  function handleToggleSound(enabled: boolean) {
    setSoundEnabled(enabled);
    saveSoundSetting(enabled);
    if (enabled) {
      playNotificationChime();
    }
  }

  async function handleRequestPermission() {
    const perm = await requestNotificationPermission();
    setPermissionState(perm);
    if (perm === "granted") {
      setNotificationsEnabled(true);
      saveNotificationSetting(true);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 520 }}
      >
        <h2>Preferences & Settings</h2>
        <p>
          Configure desktop push notifications and sound alerts.
        </p>

        {/* Notifications & Sounds Section */}
        <div className="settings-section" style={{ borderTop: "none", paddingTop: 0 }}>
          <h3 className="settings-section-title">Desktop notifications & alerts</h3>

          <div className="settings-row">
            <div>
              <div className="settings-label">Desktop Notifications</div>
              <div className="settings-hint">
                Get native desktop popups when messages or mentions arrive while tab is in background.
              </div>
            </div>
            <div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={notificationsEnabled}
                  onChange={(e) => handleToggleNotifications(e.target.checked)}
                />
                <span className="slider"></span>
              </label>
            </div>
          </div>

          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
            <span className="settings-hint">
              Browser permission:{" "}
              <strong style={{ color: permissionState === "granted" ? "var(--ok)" : permissionState === "denied" ? "var(--danger)" : "var(--text-muted)" }}>
                {permissionState === "granted" ? "✓ Granted" : permissionState === "denied" ? "✕ Blocked in browser" : "Not requested yet"}
              </strong>
            </span>
            {permissionState !== "granted" && (
              <button
                type="button"
                className="ghost-btn"
                style={{ padding: "2px 8px", minHeight: 28, fontSize: 12 }}
                onClick={handleRequestPermission}
              >
                Request browser permission
              </button>
            )}
          </div>

          <div className="settings-row" style={{ marginTop: 14 }}>
            <div>
              <div className="settings-label">Notification Chime</div>
              <div className="settings-hint">
                Play subtle two-tone chime when a new message arrives.
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                className="ghost-btn"
                style={{ padding: "2px 8px", minHeight: 28, fontSize: 12 }}
                onClick={() => playNotificationChime()}
                title="Test sound"
              >
                🔊 Test chime
              </button>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(e) => handleToggleSound(e.target.checked)}
                />
                <span className="slider"></span>
              </label>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h3 className="settings-section-title">Auto-seed videos</h3>
          <p className="settings-hint" style={{ margin: "0 0 12px", textAlign: "left" }}>
            Pick a folder. Videos already in it start seeding, and new ones that land there follow.
            Skip any file you don't want. Natter has to stay open. Chrome or Edge only.
          </p>
          {!folderWatchSupported ? (
            <div className="settings-hint">This browser cannot watch a local folder.</div>
          ) : (
            <>
              <FolderWatchPanel
                folderName={folderWatch?.folderName}
                status={folderWatchStatus}
                enabled={folderWatch?.enabled}
                items={folderQueue}
                currentKey={folderCurrentKey}
                uploading={folderUploading}
                uploadProgress={folderUploadProgress}
                onPickFolder={onPickFolder}
                onPause={() => onToggleFolderWatch?.(false)}
                onResume={() => onToggleFolderWatch?.(true)}
                onStop={onStopFolder}
                onSkip={onSkipFolderVideo}
              />
              {folderWatch && (
                <>
                  <div className="settings-row" style={{ marginTop: 14 }}>
                    <div>
                      <div className="settings-label">Watching</div>
                      <div className="settings-hint">Pause without forgetting the folder.</div>
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={folderWatch.enabled}
                        onChange={(e) => onToggleFolderWatch?.(e.target.checked)}
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                  <div className="settings-row" style={{ marginTop: 14, alignItems: "flex-start" }}>
                    <div>
                      <div className="settings-label">Seed into</div>
                      <div className="settings-hint">Channel that receives auto-seeded videos.</div>
                    </div>
                    <select
                      className="settings-select"
                      value={folderWatch.channelId}
                      onChange={(e) => onFolderWatchChannel?.(e.target.value)}
                    >
                      {channels.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          #{channel.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="modal-actions" style={{ marginTop: 24 }}>
          <button className="primary-btn" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
