import { useEffect, useState } from "react";
import type { AppState } from "../../shared/types";
import { api } from "../api";
import { IconQueue } from "./Icons";

export function Onboarding({ state, joinLink, onDone }: { state: AppState; joinLink: string | null; onDone: () => void }) {
  const [name, setName] = useState(state.identity?.name ?? "");
  const [mode, setMode] = useState<"create" | "join">(joinLink ? "join" : "create");
  const [groupName, setGroupName] = useState("");
  const [invite, setInvite] = useState(joinLink ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsName = !state.identity;
  const [fromClipboard, setFromClipboard] = useState(false);

  useEffect(() => {
    if (needsName || joinLink) return;
    void api.inviteFromClipboard().then((link) => {
      if (!link) return;
      setInvite(link);
      setMode("join");
      setFromClipboard(true);
    });
  }, [needsName, joinLink]);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      if (needsName) {
        await api.setIdentity(name);
        return;
      }
      if (mode === "create") await api.createGroup(groupName);
      else await api.joinGroup(invite);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canGo = needsName ? name.trim().length > 0 : mode === "create" ? true : invite.trim().length > 0;

  return (
    <div className="center-stage">
      <div className="drag-strip">queueue</div>
      <form
        className="mac-window onboard"
        onSubmit={(e) => {
          e.preventDefault();
          if (canGo && !busy) void go();
        }}
      >
        <div className="mac-titlebar">
          <span />
          <span className="title">{needsName ? "Welcome" : "Your queueue"}</span>
          <span />
        </div>
        <div className="body">
          <div className="wordmark">
            <span className="group-glyph">
              <IconQueue size={18} />
            </span>
            queueue
          </div>
          {needsName ? (
            <>
              <h1>Share the good stuff with your friends.</h1>
              <p>
                Drop in movies, albums, books and photo folders. Your friends see them in your shared queueue, chat about them,
                and pull a real copy straight from your Mac. No server in the middle.
              </p>
              <label className="field">
                <span>What should friends call you?</span>
                <input className="input" autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Your first name" />
              </label>
            </>
          ) : (
            <>
              <h1>Hi {state.identity?.name}. Start one or hop in.</h1>
              <div className="choice-grid">
                <button type="button" className={`choice${mode === "create" ? " active" : ""}`} onClick={() => setMode("create")}>
                  <strong>Start a queueue</strong>
                  <span>Get an invite link to send your friends.</span>
                </button>
                <button type="button" className={`choice${mode === "join" ? " active" : ""}`} onClick={() => setMode("join")}>
                  <strong>Join with a link</strong>
                  <span>Paste the invite a friend sent you.</span>
                </button>
              </div>
              {mode === "create" ? (
                <label className="field">
                  <span>Name it</span>
                  <input className="input" autoFocus value={groupName} maxLength={48} onChange={(e) => setGroupName(e.target.value)} placeholder="Movie night crew" />
                </label>
              ) : (
                <label className="field">
                  <span>Invite link</span>
                  <input
                    className="input mono"
                    autoFocus
                    value={invite}
                    onChange={(e) => {
                      setInvite(e.target.value);
                      setFromClipboard(false);
                    }}
                    placeholder="Paste the whole message, queueue finds the link"
                  />
                  {fromClipboard ? <div className="faint" style={{ fontSize: 12 }}>Found an invite you copied. Just hit Join.</div> : null}
                </label>
              )}
            </>
          )}
          {error ? <div className="error-text">{error}</div> : null}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            {state.group && !needsName ? (
              <button className="btn" type="button" onClick={onDone}>
                Cancel
              </button>
            ) : null}
            <button className="btn primary" type="submit" disabled={!canGo || busy}>
              {busy ? "One sec…" : needsName ? "Continue" : mode === "create" ? "Start it" : "Join"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
