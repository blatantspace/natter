import { useState } from "react";
import type { AppState } from "../../shared/types";
import { api } from "../api";
import { Avatar, Modal } from "./Bits";
import { IconCopy, IconFolder } from "./Icons";

const daysLeft = (expires: number) => {
  const hours = Math.max(0, Math.round((expires - Date.now()) / 3_600_000));
  return hours >= 48 ? `${Math.round(hours / 24)} days left` : hours >= 1 ? `${hours}h left` : "expires soon";
};

export function InviteModal({ state, onClose, onError }: { state: AppState; onClose: () => void; onError: (msg: string) => void }) {
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const isOwner = !!state.group?.isOwner;

  const copy = (link: string) => {
    void api.copy(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  async function makeInvite() {
    setBusy(true);
    try {
      const inv = await api.createInvite();
      setFresh(inv.link);
      copy(inv.link);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(identity: string, name: string) {
    if (!confirm(`Remove ${name} from ${state.group?.name}?\n\nThey keep anything they already downloaded, but they won't see anything new. Everyone else moves to a fresh key automatically.`)) return;
    try {
      await api.removeMember(identity);
    } catch (e) {
      onError((e as Error).message);
    }
  }

  const others = state.invites.filter((i) => i.link !== fresh);

  return (
    <Modal title="Invite" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <h2>Bring someone into {state.group?.name}</h2>
      <p>
        Each link works <strong>once</strong>, for one person, for 7 days. When they open it you get a request with a
        safety code. Check it matches theirs before letting them in.
      </p>
      {fresh ? (
        <div className="invite-box">
          <input className="input" readOnly value={fresh} onFocus={(e) => e.target.select()} />
          <button className="btn" onClick={() => copy(fresh)}>
            <IconCopy size={14} />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : (
        <button className="btn primary" disabled={busy} onClick={() => void makeInvite()}>
          <IconCopy size={14} />
          {busy ? "One sec…" : "Make a link and copy it"}
        </button>
      )}

      {others.length ? (
        <div className="field">
          <span>Unused links · {others.length}</span>
          <div className="holders">
            {others.map((i) => (
              <div className="holder" key={i.id}>
                <span className="mono faint" style={{ fontSize: 12 }}>
                  …{i.link.split("/").pop()?.slice(0, 6)}
                </span>
                <span className="tag">{daysLeft(i.expires)}</span>
                <button className="btn small" style={{ marginLeft: "auto" }} onClick={() => void api.cancelInvite(i.id)}>
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="field">
        <span>In here now · {state.members.length}</span>
        <div className="holders">
          {state.members.map((m) => (
            <div className="holder" key={m.identity}>
              <Avatar member={m} size={22} showOnline />
              <span style={{ flex: 1, display: "flex", gap: 8, alignItems: "center" }}>
                {m.you ? `${m.name} (you)` : m.name}
                {m.owner ? <span className="tag">owner</span> : null}
                {m.online ? null : <span className="tag">offline</span>}
              </span>
              {isOwner && !m.you ? (
                <button className="btn small" onClick={() => void remove(m.identity, m.name)}>
                  Remove
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export function JoinRequestModal({ state, onError }: { state: AppState; onError: (msg: string) => void }) {
  const r = state.joinRequests[0];
  if (!r) return null;
  const answer = (approve: boolean) => void api.answerJoin(r.id, approve).catch((e: Error) => onError(e.message));
  return (
    <Modal
      title="Someone wants in"
      onClose={() => answer(false)}
      footer={
        <>
          <button className="btn" onClick={() => answer(false)}>
            Not them
          </button>
          <button className="btn primary" onClick={() => answer(true)}>
            Codes match, let them in
          </button>
        </>
      }
    >
      <h2>
        {r.name} wants to join {state.group?.name}
      </h2>
      <p>Ask {r.name} what code their screen shows. Only let them in if it's exactly this:</p>
      <div className="safety-code">{r.code}</div>
      <p className="faint" style={{ fontSize: 12 }}>
        If the codes don't match, someone else has the link. Say no and send {r.name} a new one.
      </p>
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
          <input type="checkbox" checked={s.autoplayClips} onChange={(e) => setS({ ...s, autoplayClips: e.target.checked })} />
          Play short clips right on their tiles, muted (grabs a copy of clips under 3 minutes)
        </label>
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
