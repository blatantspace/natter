import { FormEvent, useState } from "react";
import { api, Channel } from "../lib";

export function NewChannelModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (channel: Channel) => void;
}) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ channel: Channel }>("/api/channels", {
        method: "POST",
        body: JSON.stringify({ name, topic }),
      });
      onCreated(data.channel);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2>Create a channel</h2>
        <p>Channels are rooms in your lounge. Keep names short and obvious.</p>
        {error && <div className="error-banner">{error}</div>}
        <div className="field">
          <label htmlFor="channelName">Name</label>
          <input
            id="channelName"
            autoFocus
            placeholder="coffee"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="topic">Topic</label>
          <input
            id="topic"
            placeholder="What is this channel for?"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>
        <div className="modal-actions">
          <button className="ghost-btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" type="submit" disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
