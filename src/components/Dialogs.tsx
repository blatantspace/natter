import { useState } from "react";
import type { AppState } from "../../shared/types";
import { api } from "../api";
import { Avatar, Modal } from "./Bits";
import { IconCopy, IconFolder } from "./Icons";

export function InviteModal({ state, onClose }: { state: AppState; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const invite = state.group?.invite ?? "";
  return (
    <Modal title="Invite" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <h2>Bring friends into {state.group?.name}</h2>
      <p>
        Send this link however you like. When a friend opens it in queueue, they're in. Anyone with the link can see and
        download what's shared here, so keep it to people you trust.
      </p>
      <div className="invite-box">
        <input className="input" readOnly value={invite} onFocus={(e) => e.target.select()} />
        <button
          className="btn"
          onClick={() => {
            void api.copy(invite);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          <IconCopy size={14} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="field">
        <span>In here now · {state.members.length}</span>
        <div className="holders">
          {state.members.map((m) => (
            <div className="holder" key={m.key}>
              <Avatar member={m} size={22} showOnline />
              <span>{m.you ? `${m.name} (you)` : m.name}</span>
              <span className="tag">{m.online ? "online" : "offline"}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export function SettingsModal({ state, onClose }: { state: AppState; onClose: () => void }) {
  const [name, setName] = useState(state.identity?.name ?? "");
  const [s, setS] = useState(state.settings);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    try {
      if (name.trim() && name.trim() !== state.identity?.name) await api.setIdentity(name);
      await api.updateSettings(s);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <label className="field">
        <span>Your name</span>
        <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="field">
        <span>Always on</span>
        <label className="toggle">
          <input type="checkbox" checked={s.autoDownload} onChange={(e) => setS({ ...s, autoDownload: e.target.checked })} />
          Automatically get a copy of everything friends share
        </label>
        <div className="row" style={{ opacity: s.autoDownload ? 1 : 0.5 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Skip anything bigger than
          </span>
          <input
            className="input"
            style={{ width: 90 }}
            inputMode="numeric"
            disabled={!s.autoDownload}
            value={Math.round(s.autoDownloadMaxMB / 1024) || ""}
            onChange={(e) => setS({ ...s, autoDownloadMaxMB: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) * 1024 })}
          />
          <span className="muted" style={{ fontSize: 13 }}>
            GB
          </span>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={s.openAtLogin} onChange={(e) => setS({ ...s, openAtLogin: e.target.checked })} />
          Start queueue when I log in
        </label>
        <p className="faint" style={{ fontSize: 12, margin: 0 }}>
          Closing the window keeps queueue running. Every copy you hold also helps friends download faster.
        </p>
      </div>

      <div className="field">
        <span>Downloads go to</span>
        <div className="row">
          <input className="input mono" style={{ fontSize: 12 }} readOnly value={s.downloadDir} />
          <button
            className="btn"
            onClick={async () => {
              const dir = await api.pickDownloadDir();
              if (dir) setS({ ...s, downloadDir: dir });
            }}
          >
            <IconFolder size={14} />
            Change
          </button>
        </div>
      </div>

      <label className="field">
        <span>TMDB API key (optional)</span>
        <input className="input mono" style={{ fontSize: 12 }} value={s.tmdbKey} placeholder="Better movie and TV posters" onChange={(e) => setS({ ...s, tmdbKey: e.target.value.trim() })} />
        <p className="faint" style={{ fontSize: 12, margin: 0 }}>
          Free from themoviedb.org. Without it queueue uses TVmaze and Wikipedia.
        </p>
      </label>
      {error ? <div className="error-text">{error}</div> : null}
    </Modal>
  );
}
