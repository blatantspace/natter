import { EventEmitter } from "node:events";
import Hyperswarm from "hyperswarm";
import Protomux from "protomux";
import crypto from "hypercore-crypto";
import b4a from "b4a";
import c from "compact-encoding";
import type { KeyPair } from "./config";
import { inviteTopic, type PendingJoin, type StoredGroup } from "./groups";
import { safetyCode } from "./seal";
import type { PendingJoinView } from "../shared/types";

export const INVITE_PROTOCOL = "queueue/invite/v1";

export type Welcome = Omit<StoredGroup, "joined" | "createdAt">;

export class InviteJoiner extends EventEmitter {
  private swarm: any = null;
  private discovery: any = null;
  private retry: NodeJS.Timeout | null = null;
  private done = false;
  view: PendingJoinView;

  constructor(
    private pending: PendingJoin,
    private keyPair: KeyPair,
    private myName: string,
  ) {
    super();
    this.view = { name: pending.name, from: pending.from, status: "finding" };
  }

  async start() {
    const token = b4a.from(this.pending.token, "hex");
    this.swarm = new Hyperswarm({ keyPair: this.keyPair });
    this.swarm.on("connection", (conn: any) => this.onConnection(conn, token));
    this.discovery = this.swarm.join(inviteTopic(token), { client: true, server: false });
    const again = () => {
      if (this.done) return;
      void this.discovery.refresh({ client: true, server: false }).catch(() => {});
      this.retry = setTimeout(again, 10000);
    };
    this.retry = setTimeout(again, 10000);
  }

  private onConnection(conn: any, token: Buffer) {
    conn.on("error", () => {});
    if (this.done) return conn.destroy();
    const mux = Protomux.from(conn);
    const channel = mux.createChannel({ protocol: INVITE_PROTOCOL });
    if (!channel) return;
    const msg = channel.addMessage({
      encoding: c.json,
      onmessage: (m: any) => this.onMessage(m, conn),
    });
    channel.open();
    msg.send({ t: "hello", proof: b4a.toString(crypto.hash([token, conn.publicKey]), "hex"), name: this.myName });
    this.view = { ...this.view, status: "waiting", code: safetyCode(token, conn.publicKey, conn.remotePublicKey) };
    this.emit("update");
  }

  private onMessage(m: any, conn: any) {
    if (this.done || !m || typeof m.t !== "string") return;
    if (m.t === "welcome" && m.group && Array.isArray(m.group.epochs) && typeof m.group.id === "string") {
      this.done = true;
      this.emit("welcome", m.group as Welcome);
      return;
    }
    if (m.t === "denied") {
      this.done = true;
      if (this.retry) clearTimeout(this.retry);
      void this.discovery?.destroy().catch(() => {});
      this.view = { ...this.view, status: m.reason === "expired" ? "expired" : m.reason === "used" ? "used" : "denied" };
      this.emit("update");
      conn.destroy();
    }
  }

  async stop() {
    this.done = true;
    if (this.retry) clearTimeout(this.retry);
    await this.swarm?.destroy().catch(() => {});
  }
}
