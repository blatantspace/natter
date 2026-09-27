import { Server as TrackerServer } from "bittorrent-tracker";
import { WebSocketServer } from "ws";

export function attachTracker() {
  const tracker = new TrackerServer({
    udp: false,
    http: false,
    ws: false,
    stats: false,
  });

  tracker.on("error", (err) => {
    console.warn("tracker error", err?.message || err);
  });
  tracker.on("warning", (err) => {
    console.warn("tracker warning", err?.message || err);
  });

  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    clientTracking: false,
  });

  wss.on("connection", (ws, req) => {
    ws.upgradeReq = req;
    tracker.onWebSocketConnection(ws, { trustProxy: false });
  });

  return { tracker, wss };
}
