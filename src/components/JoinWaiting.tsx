import type { PendingJoinView } from "../../shared/types";
import { api } from "../api";
import { IconQueue } from "./Icons";

export function JoinWaiting({ view }: { view: PendingJoinView }) {
  const done = view.status === "denied" || view.status === "expired" || view.status === "used";
  const body: Record<PendingJoinView["status"], { title: string; text: string }> = {
    finding: {
      title: `Looking for ${view.from}…`,
      text: `${view.from} needs queueue open on their Mac. Leave this running and it'll connect on its own.`,
    },
    waiting: {
      title: "Almost in",
      text: `Tell ${view.from} this code. They'll let you in once it matches what they see.`,
    },
    denied: { title: "Not this time", text: `${view.from} didn't let this one in. If that's a mistake, ask for a new link.` },
    expired: { title: "This invite has expired", text: `Invites last 7 days, or ${view.from} cancelled it. Ask for a fresh one.` },
    used: { title: "This invite was already used", text: `Each link works once. Ask ${view.from} for a new one.` },
  };
  const { title, text } = body[view.status];
  return (
    <div className="center-stage">
      <div className="drag-strip">queueue</div>
      <div className="mac-window onboard">
        <div className="mac-titlebar">
          <span />
          <span className="title">Joining {view.name}</span>
          <span />
        </div>
        <div className="body">
          <div className="wordmark">
            <span className="group-glyph">
              <IconQueue size={18} />
            </span>
            queueue
          </div>
          {view.status === "finding" ? <span className="spinner" /> : null}
          <h1>{title}</h1>
          <p>{text}</p>
          {view.status === "waiting" && view.code ? <div className="safety-code">{view.code}</div> : null}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className={`btn${done ? " primary" : ""}`} onClick={() => void api.cancelJoin()}>
              {done ? "Use a different link" : "Cancel"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
