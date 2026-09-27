import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import Corestore from "corestore";
import Hyperdrive from "hyperdrive";
import Hyperswarm from "hyperswarm";
import Hypercore from "hypercore";
import crypto from "hypercore-crypto";
import b4a from "b4a";
import c from "compact-encoding";
import { readJson, writeJson, type KeyPair } from "./config";
import { groupKeys, type GroupKeys, type StoredGroup } from "./groups";
import type { LocalFile } from "./ingest";
import type { Comment, Identity, Member, Post, PostMeta, PostView, ReactionView, Settings, Transfer } from "../shared/types";

interface Profile {
  name: string;
  color: string;
  identity?: string;
}

interface MemberState {
  key: string;
  drive: any;
  profile: Profile | null;
  posts: Map<string, Post>;
  comments: Map<string, Comment[]>;
  reactions: Map<string, Map<string, { emoji: string; on: boolean; at: number }>>;
  holds: Map<string, { at: number; complete: boolean }>;
  online: number;
  scanning: boolean;
  rescan: boolean;
}

interface Peer {
  conn: any;
  msg: any;
  memberKey: string | null;
}

interface LocalState {
  members: string[];
  reads: Record<string, number>;
  paths: Record<string, string>;
}

const HEX64 = /^[0-9a-f]{64}$/;
const log = (...args: unknown[]) => {
  if (process.env.QUEUEUE_DEBUG) console.log("[queueue]", ...args);
};
const hex = (b: Buffer) => b4a.toString(b, "hex");
const randomId = () => hex(crypto.randomBytes(8));
const safeName = (s: string) => s.replace(/[/\\:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "queueue";

export class Engine extends EventEmitter {
  readonly keys: GroupKeys;
  private store: any;
  private swarm: any;
  me!: MemberState;
  private members = new Map<string, MemberState>();
  private peers = new Set<Peer>();
  private local: LocalState;
  private localFile: string;
  transfers = new Map<string, Transfer>();
  private queue: string[] = [];
  private queueRunning = false;
  private emitTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private discovery: any;
  private closed = false;

  constructor(
    private dir: string,
    readonly group: StoredGroup,
    private identity: Identity,
    private keyPair: KeyPair,
    private settings: () => Settings,
  ) {
    super();
    this.keys = groupKeys(group);
    this.localFile = path.join(dir, "local.json");
    this.local = { members: [], reads: {}, paths: {}, ...readJson<Partial<LocalState>>(this.localFile, {}) };
  }

  private saveLocal() {
    writeJson(this.localFile, this.local);
  }

  async start() {
    this.store = new Corestore(path.join(this.dir, "store"));
    await this.store.ready();

    const drive = new Hyperdrive(this.store.namespace("me"), { encryptionKey: this.keys.encryptionKey });
    await drive.ready();
    this.me = this.track(hex(drive.key), drive);
    await this.writeProfile();

    for (const key of this.local.members) if (key !== this.me.key) void this.addMember(key);

    this.swarm = new Hyperswarm({ keyPair: this.keyPair });
    this.swarm.on("connection", (conn: any) => this.onConnection(conn));
    this.discovery = this.swarm.join(this.keys.topic, { server: true, client: true });
    log("joined topic", hex(this.keys.topic).slice(0, 8), "as", this.identity.name);
    void this.discovery
      .flushed()
      .then(() => log("announced on DHT"))
      .catch((err: Error) => log("announce failed", err.message));
    this.scheduleRefresh(0);
    this.changed();
  }

  private scheduleRefresh(step: number) {
    if (this.closed) return;
    const lonely = this.peers.size === 0;
    const delay = lonely ? [4, 8, 15, 30, 60][Math.min(step, 4)] * 1000 : 5 * 60 * 1000;
    this.refreshTimer = setTimeout(async () => {
      if (this.closed) return;
      if (this.peers.size === 0 || !lonely) {
        try {
          await this.discovery.refresh({ client: true, server: true });
          log("refreshed discovery, connections:", this.swarm.connections.size);
        } catch (err) {
          log("refresh failed", (err as Error).message);
        }
      }
      this.scheduleRefresh(this.peers.size === 0 ? step + 1 : 0);
    }, delay);
  }

  refreshNow() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.scheduleRefresh(0);
  }

  async stop() {
    this.closed = true;
    if (this.emitTimer) clearTimeout(this.emitTimer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    try {
      await this.swarm?.destroy();
    } catch {
      // closing anyway
    }
    for (const m of this.members.values()) await m.drive.close().catch(() => {});
    await this.store?.close().catch(() => {});
  }

  async writeProfile() {
    const current = this.me.profile;
    const next: Profile = { name: this.identity.name, color: this.identity.color, identity: this.identity.publicKey };
    if (current && current.name === next.name && current.color === next.color) return;
    await this.me.drive.putEntry("/profile", { metadata: next });
    this.me.profile = next;
  }

  setIdentity(identity: Identity) {
    this.identity = identity;
    void this.writeProfile().then(() => this.changed());
    this.broadcastHello();
  }

  private track(key: string, drive: any): MemberState {
    const m: MemberState = {
      key,
      drive,
      profile: null,
      posts: new Map(),
      comments: new Map(),
      reactions: new Map(),
      holds: new Map(),
      online: 0,
      scanning: false,
      rescan: false,
    };
    this.members.set(key, m);
    drive.core.on("append", () => void this.scan(m));
    void this.scan(m);
    return m;
  }

  private async addMember(key: string) {
    if (this.closed || this.members.has(key) || !HEX64.test(key)) return;
    const drive = new Hyperdrive(this.store, b4a.from(key, "hex"), { encryptionKey: this.keys.encryptionKey });
    const m = this.track(key, drive);
    if (!this.local.members.includes(key)) {
      this.local.members.push(key);
      this.saveLocal();
    }
    await drive.ready();
    drive.core.download({ start: 0, end: -1 });
    drive.getBlobs().catch(() => {});
    void drive.update({ wait: true }).then(() => this.scan(m)).catch(() => {});
    this.changed();
  }

  private onConnection(conn: any) {
    log("connection", hex(conn.remotePublicKey).slice(0, 8), conn.isInitiator ? "out" : "in");
    conn.on("error", (err: Error) => log("conn error", err.message));
    const stream = this.store.replicate(conn);
    const mux = Hypercore.getProtocolMuxer(stream);
    const peer: Peer = { conn, msg: null, memberKey: null };
    const channel = mux.createChannel({
      protocol: "queueue/hello/v1",
      id: this.keys.topic,
      onopen: () => this.sendHello(peer),
      onclose: () => this.dropPeer(peer),
    });
    if (!channel) return;
    peer.msg = channel.addMessage({ encoding: c.json, onmessage: (m: any) => this.onHello(peer, m) });
    channel.open();
    conn.on("close", () => this.dropPeer(peer));
  }

  private sendHello(peer: Peer) {
    if (!peer.msg) return;
    const proof = crypto.hash([this.keys.secret, peer.conn.publicKey]);
    peer.msg.send({
      v: 1,
      proof: hex(proof),
      drive: this.me.key,
      name: this.identity.name,
      members: [...this.members.keys()],
    });
  }

  private broadcastHello() {
    for (const p of this.peers) this.sendHello(p);
  }

  private onHello(peer: Peer, m: any) {
    const expected = crypto.hash([this.keys.secret, peer.conn.remotePublicKey]);
    if (typeof m?.proof !== "string" || !HEX64.test(m.proof) || !b4a.equals(b4a.from(m.proof, "hex"), expected)) {
      log("hello rejected");
      peer.conn.destroy();
      return;
    }
    if (typeof m.drive !== "string" || !HEX64.test(m.drive)) return;
    const fresh = [m.drive, ...(Array.isArray(m.members) ? m.members : [])].filter(
      (k: unknown): k is string => typeof k === "string" && HEX64.test(k) && !this.members.has(k),
    );
    if (!this.peers.has(peer)) {
      log("hello from", m.name, m.drive.slice(0, 8));
      this.peers.add(peer);
      peer.memberKey = m.drive;
    }
    for (const k of fresh) void this.addMember(k);
    const member = this.members.get(m.drive);
    if (member && member !== this.me) member.online = [...this.peers].filter((p) => p.memberKey === member.key).length;
    if (fresh.length) setTimeout(() => this.broadcastHello(), 50);
    this.changed();
  }

  private dropPeer(peer: Peer) {
    if (!this.peers.delete(peer)) return;
    const member = peer.memberKey ? this.members.get(peer.memberKey) : null;
    if (member) member.online = [...this.peers].filter((p) => p.memberKey === member.key).length;
    this.changed();
  }

  private async scan(m: MemberState) {
    if (m.scanning) {
      m.rescan = true;
      return;
    }
    m.scanning = true;
    try {
      do {
        m.rescan = false;
        const d = m.drive;
        const profile = await d.entry("/profile", { wait: true, timeout: 15000 }).catch(() => null);
        if (profile?.value?.metadata) m.profile = profile.value.metadata;

        const posts = new Map<string, Post>();
        for await (const e of d.list("/posts", { recursive: false })) {
          const p = e.value?.metadata as Post | undefined;
          if (p?.id) posts.set(p.id, { ...p, author: m.key });
        }
        m.posts = posts;

        const comments = new Map<string, Comment[]>();
        for await (const e of d.list("/comments")) {
          const cm = e.value?.metadata as Comment | undefined;
          if (!cm?.postId || typeof cm.text !== "string") continue;
          const list = comments.get(cm.postId) ?? [];
          list.push({ ...cm, author: m.key });
          comments.set(cm.postId, list);
        }
        m.comments = comments;

        const reactions = new Map<string, Map<string, { emoji: string; on: boolean; at: number }>>();
        for await (const e of d.list("/reactions")) {
          const r = e.value?.metadata;
          const postId = e.key.split("/")[2];
          if (!r?.emoji || !postId) continue;
          const byEmoji = reactions.get(postId) ?? new Map();
          byEmoji.set(r.emoji, r);
          reactions.set(postId, byEmoji);
        }
        m.reactions = reactions;

        const holds = new Map<string, { at: number; complete: boolean }>();
        for await (const e of d.list("/holds", { recursive: false })) {
          const h = e.value?.metadata;
          const postId = e.key.split("/")[2];
          if (h && postId) holds.set(postId, h);
        }
        m.holds = holds;
        this.changed();
      } while (m.rescan && !this.closed);
    } catch (err) {
      if (!this.closed) console.warn("[scan]", m.key.slice(0, 8), (err as Error).message);
    } finally {
      m.scanning = false;
    }
  }

  changed() {
    if (this.emitTimer || this.closed) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit("state");
      this.autoDownload();
      if (this.queue.length) void this.runQueue();
    }, 120);
  }

  memberList(): Member[] {
    return [...this.members.values()]
      .filter((m) => m === this.me || m.profile)
      .map((m) => ({
        key: m.key,
        name: m.profile?.name ?? "Someone",
        color: m.profile?.color ?? "#7a7468",
        online: m === this.me || m.online > 0,
        you: m === this.me,
      }))
      .sort((a, b) => Number(b.you) - Number(a.you) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  }

  peerCount() {
    return this.peers.size;
  }

  private allPosts(): Post[] {
    const out: Post[] = [];
    for (const m of this.members.values()) out.push(...m.posts.values());
    return out;
  }

  findPost(postId: string): Post | undefined {
    for (const m of this.members.values()) {
      const p = m.posts.get(postId);
      if (p) return p;
    }
    return undefined;
  }

  commentsFor(postId: string): Comment[] {
    const out: Comment[] = [];
    for (const m of this.members.values()) out.push(...(m.comments.get(postId) ?? []));
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  postViews(): PostView[] {
    return this.allPosts()
      .map((p) => {
        const holders = [p.author];
        const reactions = new Map<string, string[]>();
        for (const m of this.members.values()) {
          if (m.key !== p.author && m.holds.get(p.id)?.complete) holders.push(m.key);
          for (const r of m.reactions.get(p.id)?.values() ?? []) {
            if (!r.on) continue;
            reactions.set(r.emoji, [...(reactions.get(r.emoji) ?? []), m.key]);
          }
        }
        const comments = this.commentsFor(p.id);
        const fromOthers = comments.filter((cm) => cm.author !== this.me.key).length;
        const seen = this.local.reads[p.id];
        const unread = p.author === this.me.key ? Math.max(0, fromOthers - (seen ?? 0)) : seen === undefined ? Math.max(1, fromOthers) : Math.max(0, fromOthers - seen);
        const localPath = this.local.paths[p.id];
        const view: PostView = {
          ...p,
          holders,
          commentCount: comments.length,
          lastActivity: Math.max(p.createdAt, comments.at(-1)?.createdAt ?? 0),
          unread,
          reactions: [...reactions.entries()].map(([emoji, authors]): ReactionView => ({ emoji, authors })),
          localPath: localPath && fs.existsSync(localPath) ? localPath : undefined,
        };
        return view;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async readFile(memberKey: string, filePath: string): Promise<Buffer | null> {
    const m = this.members.get(memberKey);
    if (!m) return null;
    try {
      return await m.drive.get(filePath, { wait: true, timeout: 30000 });
    } catch {
      return null;
    }
  }

  async publish(opts: {
    files: LocalFile[];
    meta: PostMeta;
    note?: string;
    artwork?: { data: Buffer; ext: string; aspect?: number } | null;
    localPath?: string;
    onProgress: (bytes: number, total: number) => void;
  }): Promise<string> {
    const id = randomId();
    const root = `/files/${id}`;
    const total = opts.files.reduce((n, f) => n + f.size, 0);
    let bytes = 0;
    let lastTick = 0;
    for (const f of opts.files) {
      const tap = new Transform({
        transform(chunk, _enc, cb) {
          bytes += chunk.length;
          const now = Date.now();
          if (now - lastTick > 150) {
            lastTick = now;
            opts.onProgress(bytes, total);
          }
          cb(null, chunk);
        },
      });
      await pipeline(fs.createReadStream(f.abs), tap, this.me.drive.createWriteStream(`${root}/${f.path}`));
    }
    const meta: PostMeta = { ...opts.meta };
    if (opts.artwork) {
      const artPath = `/art/${id}.${opts.artwork.ext}`;
      await this.me.drive.put(artPath, opts.artwork.data);
      meta.artwork = artPath;
      if (opts.artwork.aspect) meta.artworkAspect = opts.artwork.aspect;
    }
    const post: Post = {
      id,
      author: this.me.key,
      createdAt: Date.now(),
      note: opts.note?.trim() || undefined,
      meta,
      files: opts.files.map(({ path: p, size, kind, mime, tags }) => ({ path: p, size, kind, mime, ...(tags && Object.keys(tags).length ? { tags } : {}) })),
      totalSize: total,
      root,
    };
    await this.me.drive.putEntry(`/posts/${id}`, { metadata: post });
    await this.me.drive.putEntry(`/holds/${id}`, { metadata: { at: Date.now(), complete: true } });
    if (opts.localPath) this.local.paths[id] = opts.localPath;
    this.local.reads[id] = 0;
    this.saveLocal();
    opts.onProgress(total, total);
    return id;
  }

  async deletePost(postId: string) {
    const post = this.me.posts.get(postId);
    if (!post) throw new Error("You can only remove things you shared.");
    for await (const e of this.me.drive.list(post.root)) await this.me.drive.del(e.key);
    if (post.meta.artwork) await this.me.drive.del(post.meta.artwork);
    await this.me.drive.del(`/posts/${postId}`);
    await this.me.drive.del(`/holds/${postId}`);
  }

  async comment(postId: string, text: string) {
    const body = text.trim().slice(0, 4000);
    if (!body) return;
    const id = `${Date.now().toString(36)}-${randomId()}`;
    const cm: Comment = { id, postId, author: this.me.key, createdAt: Date.now(), text: body };
    await this.me.drive.putEntry(`/comments/${postId}/${id}`, { metadata: cm });
    this.markRead(postId);
  }

  async react(postId: string, emoji: string) {
    const current = this.me.reactions.get(postId)?.get(emoji)?.on ?? false;
    await this.me.drive.putEntry(`/reactions/${postId}/${hex(b4a.from(emoji))}`, {
      metadata: { emoji, on: !current, at: Date.now() },
    });
  }

  markRead(postId: string) {
    this.local.reads[postId] = this.commentsFor(postId).filter((cm) => cm.author !== this.me.key).length;
    this.saveLocal();
    this.changed();
  }

  enqueueDownload(postId: string) {
    const t = this.transfers.get(postId);
    if (t && (t.state === "queued" || t.state === "downloading")) return;
    const post = this.findPost(postId);
    if (!post) throw new Error("That share isn't available yet.");
    this.transfers.set(postId, { postId, bytes: 0, total: post.totalSize, state: "queued" });
    this.queue.push(postId);
    this.changed();
    void this.runQueue();
  }

  private sourceOnline(post: Post): boolean {
    for (const m of this.members.values()) {
      if (m === this.me || m.online === 0) continue;
      if (m.key === post.author || m.holds.get(post.id)?.complete) return true;
    }
    return false;
  }

  private async runQueue() {
    if (this.queueRunning) return;
    this.queueRunning = true;
    try {
      while (!this.closed) {
        const idx = this.queue.findIndex((id) => {
          const p = this.findPost(id);
          return p && this.sourceOnline(p);
        });
        if (idx === -1) break;
        const [postId] = this.queue.splice(idx, 1);
        await this.downloadNow(postId);
      }
      for (const id of this.queue) {
        const t = this.transfers.get(id);
        if (t && t.state === "queued") t.error = "Waiting for someone with a copy to come online";
      }
    } finally {
      this.queueRunning = false;
    }
  }

  private uniqueDir(base: string, name: string): string {
    let dir = path.join(base, name);
    for (let i = 2; fs.existsSync(dir); i++) dir = path.join(base, `${name} (${i})`);
    return dir;
  }

  private async downloadNow(postId: string) {
    const post = this.findPost(postId);
    const author = post && this.members.get(post.author);
    if (!post || !author) return;
    const t: Transfer = { postId, bytes: 0, total: post.totalSize, state: "downloading" };
    this.transfers.set(postId, t);
    this.changed();
    const destRoot = this.uniqueDir(this.settings().downloadDir, safeName(post.meta.title));
    try {
      await author.drive.getBlobs();
      for (const f of post.files) {
        const target = path.resolve(destRoot, f.path);
        if (!target.startsWith(destRoot + path.sep)) throw new Error(`Refusing unsafe path ${f.path}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const tap = new Transform({
          transform: (chunk, _enc, cb) => {
            t.bytes += chunk.length;
            this.changed();
            cb(null, chunk);
          },
        });
        await pipeline(author.drive.createReadStream(`${post.root}/${f.path}`), tap, fs.createWriteStream(target));
      }
      await this.me.drive.putEntry(`/holds/${postId}`, { metadata: { at: Date.now(), complete: true } });
      this.local.paths[postId] = destRoot;
      this.saveLocal();
      t.state = "done";
      t.path = destRoot;
      t.bytes = t.total;
    } catch (err) {
      t.state = "error";
      t.error = (err as Error).message;
    }
    this.changed();
  }

  private autoDownload() {
    const s = this.settings();
    if (!s.autoDownload) return;
    const max = s.autoDownloadMaxMB * 1024 * 1024;
    for (const p of this.allPosts()) {
      if (p.author === this.me.key || this.local.paths[p.id] || this.transfers.has(p.id)) continue;
      if (p.totalSize > max) continue;
      this.enqueueDownload(p.id);
    }
  }

  localPath(postId: string): string | undefined {
    const p = this.local.paths[postId];
    return p && fs.existsSync(p) ? p : undefined;
  }
}
