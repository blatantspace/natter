import { formatBytes, Message, Person } from "../lib";
import {
  FileTransfer,
  hasFileShare,
  isInlineMedia,
  isUriMagnet,
  SwarmPeer,
} from "../filePayload";
import { IconFile, fileKindFromMime } from "./Icons";

export function FileCard({
  message,
  swarmPeers = [],
  transfer,
  onGet,
  compact = false,
}: {
  message: Message;
  swarmPeers?: SwarmPeer[];
  people?: Person[];
  transfer?: FileTransfer;
  onGet: (message: Message) => void;
  compact?: boolean;
}) {
  if (!hasFileShare(message)) return null;

  const mime = message.attachmentType || "";
  const name = message.attachmentName || "Shared magnet";
  const media = isInlineMedia(mime);
  const ready = Boolean(message.decryptedAttachmentUrl);
  const downloading = transfer?.status === "downloading";
  const progress = transfer?.progress || 0;
  const seeds = swarmPeers.filter((p) => p.role === "seed");
  const leeches = swarmPeers.filter((p) => p.role === "leech");
  const uri = isUriMagnet(message);

  return (
    <div>
      {media && ready && (
        <div className="media-preview-container" style={compact ? { maxWidth: "100%" } : undefined}>
          {mime.startsWith("image/") && (
            <img src={message.decryptedAttachmentUrl} alt={name} />
          )}
          {mime.startsWith("video/") && (
            <video src={message.decryptedAttachmentUrl} controls />
          )}
          {mime.startsWith("audio/") && (
            <audio src={message.decryptedAttachmentUrl} controls style={{ width: "100%", padding: 8 }} />
          )}
        </div>
      )}

      <div className="file-card" style={compact ? { maxWidth: "100%" } : undefined}>
        <div className="file-icon">
          <IconFile kind={fileKindFromMime(mime)} size={18} />
        </div>
        <div className="file-info">
          <div className="file-name" title={name}>
            {name}
          </div>
          <div className="file-meta">
            {message.attachmentSize ? <span>{formatBytes(message.attachmentSize)}</span> : <span>magnet</span>}
            <span>•</span>
            {uri ? <span className="swarm-tag">magnet</span> : null}
            {message.infoHash && !uri ? (
              <>
                <span>•</span>
                <span className="swarm-tag">swarm</span>
              </>
            ) : null}
          </div>
          {(seeds.length > 0 || leeches.length > 0) && (
            <div className="swarm-row" title={swarmTitle(seeds, leeches)}>
              <div className="swarm-faces">
                {seeds.slice(0, 5).map((p) => (
                  <span
                    key={p.personId}
                    className="swarm-face"
                    style={{ background: p.color }}
                    title={`${p.displayName} seeding`}
                  >
                    {initial(p.displayName)}
                  </span>
                ))}
              </div>
              <span className="swarm-line">
                {seeds.length > 0
                  ? `${seeds.map((p) => p.displayName).join(", ")} seeding`
                  : null}
                {seeds.length > 0 && leeches.length > 0 ? " · " : null}
                {leeches.length > 0
                  ? `${leeches.map((p) => p.displayName).join(", ")} downloading`
                  : null}
              </span>
            </div>
          )}
          {downloading && (
            <div className="file-progress" aria-label={transfer?.label || "Downloading"}>
              <div className="file-progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          {transfer?.status === "error" && (
            <div className="file-error">{transfer.error || "Download failed"}</div>
          )}
        </div>
        {ready ? (
          <a
            href={message.decryptedAttachmentUrl}
            download={name}
            className="primary-btn"
            style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
          >
            Save
          </a>
        ) : (
          <button
            type="button"
            className="primary-btn"
            onClick={() => onGet(message)}
            disabled={downloading}
          >
            {downloading ? `${Math.round(progress * 100)}%` : "Get"}
          </button>
        )}
      </div>
    </div>
  );
}

function initial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

function swarmTitle(seeds: SwarmPeer[], leeches: SwarmPeer[]) {
  const seedNames = seeds.map((p) => p.displayName).join(", ");
  const leechNames = leeches.map((p) => p.displayName).join(", ");
  if (seedNames && leechNames) return `Seeding: ${seedNames}. Downloading: ${leechNames}`;
  if (seedNames) return `Seeding: ${seedNames}`;
  return `Downloading: ${leechNames}`;
}
