import { FormEvent, useState } from "react";
import { Message } from "../lib";
import { hasFileShare } from "../filePayload";

export function canEditMessage(message: Message, personId?: string) {
  return Boolean(personId && message.authorId === personId && !message.deletedAt && !hasFileShare(message));
}

export function canDeleteMessage(message: Message, personId?: string) {
  return Boolean(personId && message.authorId === personId && !message.deletedAt);
}

export function OwnMessageTools({
  message,
  personId,
  onEdit,
  onDelete,
}: {
  message: Message;
  personId?: string;
  onEdit?: (message: Message) => void;
  onDelete?: (message: Message) => void;
}) {
  if (!canDeleteMessage(message, personId)) return null;
  return (
    <>
      <div className="actions-divider" />
      {canEditMessage(message, personId) && onEdit && (
        <button type="button" className="action-pill-btn" onClick={() => onEdit(message)} title="Edit">
          Edit
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          className="action-pill-btn danger"
          onClick={() => onDelete(message)}
          title={hasFileShare(message) ? "Delete file" : "Delete"}
        >
          Delete
        </button>
      )}
    </>
  );
}

export function MessageEditForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);

  function submit(e: FormEvent) {
    e.preventDefault();
    const next = draft.trim();
    if (!next) return;
    onSave(next);
  }

  return (
    <form className="message-edit-form" onSubmit={submit}>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
        }}
      />
      <div className="message-edit-actions">
        <button className="ghost-btn" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-btn" type="submit" disabled={!draft.trim()}>
          Save
        </button>
      </div>
    </form>
  );
}
