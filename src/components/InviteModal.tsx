import { useState } from "react";

export function InviteModal({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const inviteUrl = window.location.origin;

  async function copyLink() {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Invite</h2>
        <p>Send this link to a friend. They pick a name and they are in.</p>

        <div className="field">
          <label>Invite link</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              readOnly
              value={inviteUrl}
              style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 13 }}
            />
            <button className="primary-btn" type="button" onClick={copyLink}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div className="modal-actions" style={{ marginTop: 20 }}>
          <button className="ghost-btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
