import { UploadProgress } from "../lib";
import { IconLock } from "./Icons";

export function UploadPill({
  progress,
  fallback,
}: {
  progress: UploadProgress | null;
  fallback: string;
}) {
  const label = progress?.label || fallback;
  const ratio = progress?.ratio;
  const showBar = typeof ratio === "number";
  const pct = showBar ? Math.max(0, Math.min(100, Math.round(ratio * 100))) : 0;

  return (
    <div className="upload-pill">
      <span className="ui-icon"><IconLock size={14} /></span>
      <div className="upload-pill-body">
        <span>{label}</span>
        {showBar && (
          <div className="upload-pill-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
            <div className="upload-pill-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
