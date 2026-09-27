import { IconReactAdd } from "./Icons";
import { useEffect, useRef } from "react";
import { Person, ReactionGroup } from "../lib";

export const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "🚀", "👀", "🍁", "🔥"];

export const ALL_EMOJIS = [
  "👍", "👎", "❤️", "😂", "🎉", "🚀", "👀", "🍁",
  "🔥", "👏", "💯", "🙌", "💡", "🥳", "🎯", "🤝",
  "☕️", "✨", "🤩", "🙏", "💩", "🤖", "🍿", "⚡️",
  "❤️‍🔥", "💪", "✅", "🫡", "🍻", "🍕", "😎", "🤔"
];

export function formatReactionTooltip(group: ReactionGroup, currentPersonId?: string): string {
  const isMe = currentPersonId && group.personIds.includes(currentPersonId);
  const otherNames = group.personNames.filter((_, i) => group.personIds[i] !== currentPersonId);

  if (isMe) {
    if (otherNames.length === 0) return "You reacted with " + group.emoji;
    if (otherNames.length === 1) return `You and ${otherNames[0]} reacted with ${group.emoji}`;
    if (otherNames.length === 2) return `You, ${otherNames[0]} and ${otherNames[1]} reacted with ${group.emoji}`;
    return `You, ${otherNames.slice(0, 2).join(", ")} and ${otherNames.length - 2} others reacted with ${group.emoji}`;
  }

  if (group.personNames.length === 1) return `${group.personNames[0]} reacted with ${group.emoji}`;
  if (group.personNames.length === 2) return `${group.personNames[0]} and ${group.personNames[1]} reacted with ${group.emoji}`;
  return `${group.personNames.slice(0, 2).join(", ")} and ${group.personNames.length - 2} others reacted with ${group.emoji}`;
}

export function EmojiPickerMenu({
  onSelectEmoji,
  onClose,
}: {
  onSelectEmoji: (emoji: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div className="emoji-picker-popover" ref={ref} onClick={(e) => e.stopPropagation()}>
      <div className="emoji-picker-header">Add Reaction</div>
      <div className="emoji-picker-grid">
        {ALL_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="emoji-picker-btn"
            onClick={() => {
              onSelectEmoji(emoji);
              onClose();
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MessageReactions({
  reactions,
  currentPerson,
  onToggleReaction,
  onOpenPicker,
}: {
  reactions?: ReactionGroup[];
  currentPerson?: Person | null;
  onToggleReaction: (emoji: string) => void;
  onOpenPicker: () => void;
}) {
  if (!reactions || reactions.length === 0) return null;

  return (
    <div className="message-reactions-row">
      {reactions.map((group) => {
        const hasReacted = Boolean(
          currentPerson && group.personIds.includes(currentPerson.id)
        );
        const tooltip = formatReactionTooltip(group, currentPerson?.id);

        return (
          <button
            key={group.emoji}
            type="button"
            className={`reaction-badge ${hasReacted ? "active" : ""}`}
            onClick={() => onToggleReaction(group.emoji)}
            title={tooltip}
          >
            <span className="reaction-emoji">{group.emoji}</span>
            <span className="reaction-count">{group.count}</span>
          </button>
        );
      })}

      <button
        type="button"
        className="reaction-add-btn"
        onClick={onOpenPicker}
        title="Add reaction"
        aria-label="Add reaction"
      >
        <IconReactAdd size={14} />
      </button>
    </div>
  );
}
