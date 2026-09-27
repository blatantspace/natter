import { useState } from "react";
import { generateRandomRoomKey, saveRoomKey } from "../crypto";

export function InviteModal({
  currentKey,
  onClose,
  onKeyChange,
}: {
  currentKey: string;
  onClose: () => void;
  onKeyChange: (newKey: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [manualKey, setManualKey] = useState(currentKey);

  const inviteUrl = `${window.location.origin}/#key=${currentKey}`;

  async function copyLink() {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function handleRotateKey() {
    const newKey = generateRandomRoomKey();
    setManualKey(newKey);
    onKeyChange(newKey);
  }

  function handleSaveManual() {
    if (!manualKey.trim()) return;
    onKeyChange(manualKey.trim());
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Invite</h2>
        <p>
          Send this link to a friend. The room key rides in the link, so they land already able to read the room. Messages stay encrypted on each device — the server only sees ciphertext.
        </p>

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
          <span className="hint" style={{ marginTop: 4 }}>
            Anyone with the link can join and decrypt this room.
          </span>
        </div>

        <div className="field" style={{ marginTop: 16 }}>
          <label>Room key</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={manualKey}
              onChange={(e) => setManualKey(e.target.value)}
              style={{ flex: 1, fontFamily: "monospace", fontSize: 13 }}
            />
            <button className="ghost-btn" type="button" onClick={handleSaveManual}>
              Save Key
            </button>
            <button className="ghost-btn" type="button" onClick={handleRotateKey} title="Generate fresh key">
              Rotate
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
