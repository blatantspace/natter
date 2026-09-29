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
import { INVITE_TTL, groupKeys, inviteLink, inviteTopic, type GroupKeys, type StoredGroup } from "./groups";
import type { LocalFile } from "./ingest";
import { CHUNK, HASH_BYTES, chunkCount, chunkDataEncoding, hashChunk, hashFiles, readChunk, type ChunkData, type ChunkRequest } from "./files";
import { INVITE_PROTOCOL, type Welcome } from "./joiner";
import { openSealed, safetyCode, sealTo, signJson, verifyJson } from "./seal";
import type { Comment, Identity, InviteView, JoinRequest, Member, Post, PostMeta, PostView, ReactionView, Settings, Transfer } from "../shared/types";

interface Profile {
  name: string;
  color: string;
  identity?: string;
}

interface EpochRecord {
  epoch: number;
  removed: string[];
  seals: Record<string, string>;
  by: string;
  at: number;
}

interface StoredInvite {
  id: string;
  token: string;
  createdAt: number;
  expires: number;
  usedBy?: string;
}

interface OpenRequest {
  view: JoinRequest;
  invite: StoredInvite;
  msg: any;
  conn: any;
}

interface MemberState {
  key: string;
  epoch: number;
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

interface Pending {
  resolve: (data: Buffer) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface Peer {
  conn: any;
  msg: any;
  sync: any;
  epoch: number;
  memberKey: string | null;
  files: { request: any; data: any; fail: any } | null;
  pending: Map<number, Pending>;
}

interface LocalState {
  members: string[];
  memberEpochs: Record<string, number>;
  invites: StoredInvite[];
  reads: Record<string, number>;
  paths: Record<string, string>;
  files: Record<string, string[]>;
  partial: Record<string, string>;
}

class Paused extends Error {}

const WINDOW = 4;
const CHUNK_TIMEOUT = 30000;

const HEX64 = /^[0-9a-f]{64}$/;
const log = (...args: unknown[]) => {
  if (process.env.QUEUEUE_DEBUG) console.log("[queueue]", ...args);
};
const hex = (b: Buffer) => b4a.toString(b, "hex");
const randomId = () => hex(crypto.randomBytes(8));
const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
const safeName = (s: string) => s.replace(/[/\\:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "queueue";

export class Engine extends EventEmitter {
  readonly keys: GroupKeys;
  private store: any;
  private swarm: any;
  me!: MemberState;
  private mine = new Set<MemberState>();
  private members = new Map<string, MemberState>();
  private peers = new Set<Peer>();
  private stalePeers = new Set<Peer>();
  private oldDiscoveries: any[] = [];
  private inviteDiscoveries = new Map<string, any>();
  private requests = new Map<string, OpenRequest>();
  private switching = false;
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
    this.local = {
      members: [],
      memberEpochs: {},
      invites: [],
      reads: {},
      paths: {},
      files: {},
      partial: {},
      ...readJson<Partial<LocalState>>(this.localFile, {}),
    };
    for (const k of this.local.members) this.local.memberEpochs[k] ??= 0;
    this.local.members = [];
  }

  private saveLocal() {
    writeJson(this.localFile, this.local);
  }

  async start() {
    this.store = new Corestore(path.join(this.dir, "store"));
    await this.store.ready();

    for (let e = 0; e <= this.keys.epoch; e++) {
      const drive = new Hyperdrive(this.store.namespace(e === 0 ? "me" : `me-e${e}`), { encryptionKey: this.keys.epochs[e].encryptionKey });
      await drive.ready();
      const m = this.track(hex(drive.key), drive, e);
      this.mine.add(m);
      if (e === this.keys.epoch) this.me = m;
    }
    await this.writeProfile();

    for (const [key, epoch] of Object.entries(this.local.memberEpochs)) {
      if (!this.members.has(key) && epoch <= this.keys.epoch) void this.addMember(key, epoch);
    }

    const removed = new Set(this.group.removed);
    this.swarm = new Hyperswarm({ keyPair: this.keyPair, firewall: (pk: Buffer) => removed.has(hex(pk)) });
    this.swarm.on("connection", (conn: any) => this.onConnection(conn));
    this.discovery = this.swarm.join(this.keys.topic, { server: true, client: true });
    for (let e = 0; e < this.keys.epoch; e++) this.oldDiscoveries.push(this.swarm.join(this.keys.epochs[e].topic, { server: true, client: false }));
    log("joined topic", hex(this.keys.topic).slice(0, 8), "epoch", this.keys.epoch, "as", this.identity.name);
    void this.discovery
      .flushed()
      .then(() => log("announced on DHT"))
      .catch((err: Error) => log("announce failed", err.message));
    this.pruneInvites();
    for (const inv of this.openInvites()) this.listenForInvite(inv);
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
  }

  private track(key: string, drive: any, epoch: number): MemberState {
    const m: MemberState = {
      key,
      epoch,
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

  private async addMember(key: string, epoch: number) {
    if (this.closed || this.members.has(key) || !HEX64.test(key) || !this.keys.epochs[epoch]) return;
    const drive = new Hyperdrive(this.store, b4a.from(key, "hex"), { encryptionKey: this.keys.epochs[epoch].encryptionKey });
    const m = this.track(key, drive, epoch);
    if (this.local.memberEpochs[key] !== epoch) {
      this.local.memberEpochs[key] = epoch;
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
    const peer: Peer = { conn, msg: null, sync: null, epoch: -1, memberKey: null, files: null, pending: new Map() };
    const groupId = this.keys.epochs[0].topic;
    const channel = mux.createChannel({
      protocol: "queueue/hello/v2",
      id: groupId,
      onopen: () => this.sendHello(peer),
      onclose: () => this.dropPeer(peer),
    });
    if (!channel) return;
    peer.msg = channel.addMessage({ encoding: c.json, onmessage: (m: any) => this.onHello(peer, m) });
    peer.sync = channel.addMessage({ encoding: c.json, onmessage: (m: any) => this.onSync(peer, m) });
    channel.open();

    const invite = mux.createChannel({ protocol: INVITE_PROTOCOL });
    if (invite) {
      const msg = invite.addMessage({ encoding: c.json, onmessage: (m: any) => this.onInviteMessage(conn, msg, m) });
      invite.open();
    }

    const files = mux.createChannel({ protocol: "queueue/files/v1", id: groupId });
    if (files) {
      peer.files = {
        request: files.addMessage({ encoding: c.json, onmessage: (m: ChunkRequest) => void this.serveChunk(peer, m) }),
        data: files.addMessage({ encoding: chunkDataEncoding, onmessage: (m: ChunkData) => this.settle(peer, m.rid, m.data) }),
        fail: files.addMessage({ encoding: c.json, onmessage: (m: { rid: number; error: string }) => this.settle(peer, m.rid, null, m.error) }),
      };
      files.open();
    }
    conn.on("close", () => this.dropPeer(peer));
  }

  private async serveChunk(peer: Peer, m: ChunkRequest) {
    const reply = peer.files!;
    try {
      if (!this.peers.has(peer)) throw new Error("Say hello first");
      const post = this.findPost(m.post);
      const abs = this.local.files[m.post]?.[m.file];
      const f = post?.files[m.file];
      if (!post || !abs || !f || !Number.isInteger(m.index)) throw new Error("I don't have that");
      reply.data.send({ rid: m.rid, data: await readChunk(abs, f.size, m.index) });
    } catch (err) {
      reply.fail.send({ rid: m.rid, error: (err as Error).message });
    }
  }

  private settle(peer: Peer, rid: number, data: Buffer | null, error?: string) {
    const p = peer.pending.get(rid);
    if (!p) return;
    peer.pending.delete(rid);
    clearTimeout(p.timer);
    if (data) p.resolve(data);
    else p.reject(new Error(error || "Chunk failed"));
  }

  private rid = 0;
  private requestChunk(peer: Peer, post: string, file: number, index: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (!peer.files || !this.peers.has(peer)) return reject(new Error("Peer gone"));
      const rid = ++this.rid;
      const timer = setTimeout(() => this.settle(peer, rid, null, "Timed out"), CHUNK_TIMEOUT);
      peer.pending.set(rid, { resolve, reject, timer });
      peer.files.request.send({ rid, post, file, index });
    });
  }

  private sendHello(peer: Peer) {
    if (!peer.msg) return;
    const proofs = this.keys.epochs.map((e) => hex(crypto.hash([e.secret, peer.conn.publicKey])));
    peer.msg.send({ v: 2, proofs, name: this.identity.name });
  }

  private sendSync(peer: Peer) {
    if (!peer.sync || peer.epoch < 0) return;
    const drives: Record<number, string> = {};
    const members: Record<number, string[]> = {};
    for (const m of this.members.values()) {
      if (m.epoch > peer.epoch) continue;
      (members[m.epoch] ??= []).push(m.key);
      if (this.mine.has(m)) drives[m.epoch] = m.key;
    }
    peer.sync.send({ drives, members });
  }

  private broadcastSync() {
    for (const p of [...this.peers, ...this.stalePeers]) this.sendSync(p);
  }

  private onHello(peer: Peer, m: any) {
    if (peer.epoch >= 0) return;
    const proofs: unknown[] = Array.isArray(m?.proofs) ? m.proofs : [];
    let common = -1;
    for (let e = Math.min(proofs.length, this.keys.epochs.length) - 1; e >= 0; e--) {
      const p = proofs[e];
      if (typeof p !== "string" || !HEX64.test(p)) continue;
      if (b4a.equals(b4a.from(p, "hex"), crypto.hash([this.keys.epochs[e].secret, peer.conn.remotePublicKey]))) {
        common = e;
        break;
      }
    }
    if (common < 0 || this.group.removed.includes(hex(peer.conn.remotePublicKey))) {
      log("hello rejected");
      peer.conn.destroy();
      return;
    }
    peer.epoch = common;
    if (common === this.keys.epoch) this.peers.add(peer);
    else this.stalePeers.add(peer);
    log("hello from", m.name, "epoch", common, common === this.keys.epoch ? "" : "(behind)");
    this.sendSync(peer);
    this.changed();
  }

  private onSync(peer: Peer, m: any) {
    if (peer.epoch < 0 || !m) return;
    let fresh = false;
    for (let e = 0; e <= peer.epoch; e++) {
      const keys: unknown[] = [m.drives?.[e], ...(Array.isArray(m.members?.[e]) ? m.members[e] : [])];
      for (const k of keys) {
        if (typeof k !== "string" || !HEX64.test(k) || this.members.has(k)) continue;
        void this.addMember(k, e);
        fresh = true;
      }
    }
    const drive = m.drives?.[peer.epoch];
    if (typeof drive === "string" && HEX64.test(drive) && peer.epoch === this.keys.epoch) {
      peer.memberKey = drive;
      const member = this.members.get(drive);
      if (member && !this.mine.has(member)) member.online = [...this.peers].filter((p) => p.memberKey === member.key).length;
    }
    if (fresh) setTimeout(() => this.broadcastSync(), 50);
    this.changed();
  }

  private dropPeer(peer: Peer) {
    for (const rid of [...peer.pending.keys()]) this.settle(peer, rid, null, "Peer gone");
    this.stalePeers.delete(peer);
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

        for await (const e of d.list("/epochs", { recursive: false })) this.considerEpoch(e.value?.metadata);
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

  private isMine(key: string) {
    const m = this.members.get(key);
    return !!m && this.mine.has(m);
  }

  private identityOf(m: MemberState): string {
    return this.mine.has(m) ? this.identity.publicKey : (m.profile?.identity ?? m.key);
  }

  private people(): Map<string, MemberState[]> {
    const out = new Map<string, MemberState[]>();
    for (const m of this.members.values()) {
      const id = this.identityOf(m);
      out.set(id, [...(out.get(id) ?? []), m]);
    }
    for (const drives of out.values()) drives.sort((a, b) => b.epoch - a.epoch);
    return out;
  }

  memberList(): Member[] {
    const out: Member[] = [];
    for (const [identity, drives] of this.people()) {
      const you = identity === this.identity.publicKey;
      const profile = drives.find((d) => d.profile)?.profile;
      if (!you && (!profile || this.group.removed.includes(identity))) continue;
      out.push({
        key: drives[0].key,
        keys: drives.map((d) => d.key),
        identity,
        name: you ? this.identity.name : (profile?.name ?? "Someone"),
        color: you ? this.identity.color : (profile?.color ?? "#7a7468"),
        online: you || drives.some((d) => d.online > 0),
        you,
        owner: identity === this.group.owner,
      });
    }
    return out.sort((a, b) => Number(b.you) - Number(a.you) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
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

  private holdsCopy(identity: string, post: Post, people = this.people()): boolean {
    const drives = people.get(identity) ?? [];
    return drives.some((d) => d.key === post.author || d.holds.get(post.id)?.complete);
  }

  private myReaction(postId: string, emoji: string): boolean {
    let latest: { on: boolean; at: number } | null = null;
    for (const m of this.mine) {
      const r = m.reactions.get(postId)?.get(emoji);
      if (r && (!latest || r.at > latest.at)) latest = r;
    }
    return latest?.on ?? false;
  }

  postViews(): PostView[] {
    const people = this.people();
    return this.allPosts()
      .map((p) => {
        const author = this.members.get(p.author);
        const authorIdentity = author ? this.identityOf(author) : p.author;
        const holders: string[] = [];
        const reactions = new Map<string, string[]>();
        for (const [identity, drives] of people) {
          const key = drives[0].key;
          if (this.holdsCopy(identity, p, people)) {
            if (identity === authorIdentity) holders.unshift(key);
            else holders.push(key);
          }
          const latest = new Map<string, { on: boolean; at: number }>();
          for (const d of drives) {
            for (const r of d.reactions.get(p.id)?.values() ?? []) {
              const prev = latest.get(r.emoji);
              if (!prev || r.at > prev.at) latest.set(r.emoji, r);
            }
          }
          for (const [emoji, r] of latest) if (r.on) reactions.set(emoji, [...(reactions.get(emoji) ?? []), key]);
        }
        const comments = this.commentsFor(p.id);
        const fromOthers = comments.filter((cm) => !this.isMine(cm.author)).length;
        const seen = this.local.reads[p.id];
        const unread = this.isMine(p.author) ? Math.max(0, fromOthers - (seen ?? 0)) : seen === undefined ? Math.max(1, fromOthers) : Math.max(0, fromOthers - seen);
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
    const hashes = await hashFiles(opts.files, (n) => {
      bytes += n;
      const now = Date.now();
      if (now - lastTick > 150) {
        lastTick = now;
        opts.onProgress(bytes, total);
      }
    });
    const hashesPath = `/hashes/${id}`;
    await this.me.drive.put(hashesPath, hashes);
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
      hashes: hashesPath,
    };
    this.local.files[id] = opts.files.map((f) => f.abs);
    await this.me.drive.putEntry(`/posts/${id}`, { metadata: post });
    await this.me.drive.putEntry(`/holds/${id}`, { metadata: { at: Date.now(), complete: true } });
    if (opts.localPath) this.local.paths[id] = opts.localPath;
    this.local.reads[id] = 0;
    this.saveLocal();
    opts.onProgress(total, total);
    return id;
  }

  async deletePost(postId: string) {
    const owner = [...this.mine].find((m) => m.posts.has(postId));
    const post = owner?.posts.get(postId);
    if (!owner || !post) throw new Error("You can only remove things you shared.");
    const d = owner.drive;
    for await (const e of d.list(post.root)) await d.del(e.key);
    if (post.meta.artwork) await d.del(post.meta.artwork);
    if (post.hashes) await d.del(post.hashes);
    delete this.local.files[postId];
    delete this.local.paths[postId];
    this.saveLocal();
    await d.del(`/posts/${postId}`);
    for (const m of this.mine) await m.drive.del(`/holds/${postId}`).catch(() => {});
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
    const current = this.myReaction(postId, emoji);
    await this.me.drive.putEntry(`/reactions/${postId}/${hex(b4a.from(emoji))}`, {
      metadata: { emoji, on: !current, at: Date.now() },
    });
  }

  markRead(postId: string) {
    this.local.reads[postId] = this.commentsFor(postId).filter((cm) => !this.isMine(cm.author)).length;
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
    if (post.hashes) return this.sourcesFor(post).length > 0;
    for (const m of this.members.values()) {
      if (this.mine.has(m) || m.online === 0) continue;
      if (this.holdsCopy(this.identityOf(m), post)) return true;
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

  private sourcesFor(post: Post): Peer[] {
    return [...this.peers].filter(
      (p) => {
        const m = p.files && p.memberKey ? this.members.get(p.memberKey) : undefined;
        return !!m && !this.mine.has(m) && this.holdsCopy(this.identityOf(m), post);
      },
    );
  }

  private async downloadNow(postId: string) {
    const post = this.findPost(postId);
    const author = post && this.members.get(post.author);
    if (!post || !author) return;
    const t: Transfer = { postId, bytes: 0, total: post.totalSize, state: "downloading" };
    this.transfers.set(postId, t);
    this.changed();
    const base = this.settings().downloadDir;
    const resuming = this.local.partial[postId];
    const destRoot = resuming && fs.existsSync(resuming) ? resuming : this.uniqueDir(base, safeName(post.meta.title));
    try {
      fs.mkdirSync(base, { recursive: true });
      const { bavail, bsize } = fs.statfsSync(base);
      const free = bavail * bsize;
      const needed = (post.hashes ? post.totalSize : post.totalSize * 2) + 512 * 1024 * 1024;
      if (free < needed) {
        throw new Error(`Not enough space. This needs about ${gb(needed)} free and your Mac has ${gb(free)}.`);
      }
      this.local.partial[postId] = destRoot;
      this.saveLocal();
      const targets = post.files.map((f) => {
        const target = path.resolve(destRoot, f.path);
        if (!target.startsWith(destRoot + path.sep)) throw new Error(`Refusing unsafe path ${f.path}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        return target;
      });
      if (post.hashes) await this.fetchChunks(post, author, targets, t);
      else await this.fetchLegacy(post, author, targets, t);
      await this.me.drive.putEntry(`/holds/${postId}`, { metadata: { at: Date.now(), complete: true } });
      this.local.paths[postId] = destRoot;
      this.local.files[postId] = targets;
      delete this.local.partial[postId];
      this.saveLocal();
      t.state = "done";
      t.path = destRoot;
      t.bytes = t.total;
      t.error = undefined;
    } catch (err) {
      if (err instanceof Paused) {
        t.state = "queued";
        t.error = err.message;
        if (!this.queue.includes(postId)) this.queue.push(postId);
      } else {
        t.state = "error";
        t.error = (err as Error).message;
      }
    }
    this.changed();
  }

  private async fetchLegacy(post: Post, author: MemberState, targets: string[], t: Transfer) {
    await author.drive.getBlobs();
    for (let i = 0; i < post.files.length; i++) {
      const tap = new Transform({
        transform: (chunk, _enc, cb) => {
          t.bytes += chunk.length;
          this.changed();
          cb(null, chunk);
        },
      });
      await pipeline(author.drive.createReadStream(`${post.root}/${post.files[i].path}`), tap, fs.createWriteStream(targets[i]));
    }
  }

  private async fetchChunks(post: Post, author: MemberState, targets: string[], t: Transfer) {
    const hashes: Buffer | null = await author.drive.get(post.hashes!, { wait: true, timeout: 30000 }).catch(() => null);
    const expected = post.files.reduce((n, f) => n + chunkCount(f.size), 0) * HASH_BYTES;
    if (!hashes || hashes.length !== expected) throw new Paused("Getting ready. Waiting for the file fingerprints.");
    const hashAt = (g: number) => hashes.subarray(g * HASH_BYTES, (g + 1) * HASH_BYTES);

    const jobs: { file: number; index: number; global: number }[] = [];
    const handles: fs.promises.FileHandle[] = [];
    try {
      let g = 0;
      for (let i = 0; i < post.files.length; i++) {
        const f = post.files[i];
        const part = `${targets[i]}.part`;
        if (fs.existsSync(targets[i]) && !fs.existsSync(part)) fs.renameSync(targets[i], part);
        const existed = fs.existsSync(part);
        const fh = await fs.promises.open(part, existed ? "r+" : "w+");
        handles.push(fh);
        if ((await fh.stat()).size !== f.size) await fh.truncate(f.size);
        for (let j = 0; j < chunkCount(f.size); j++, g++) {
          if (existed) {
            const len = Math.min(CHUNK, f.size - j * CHUNK);
            const buf = Buffer.alloc(len);
            await fh.read(buf, 0, len, j * CHUNK);
            if (b4a.equals(hashChunk(buf), hashAt(g))) {
              t.bytes += len;
              continue;
            }
          }
          jobs.push({ file: i, index: j, global: g });
        }
      }
      this.changed();

      const bad = new Set<Peer>();
      const strikes = new Map<Peer, number>();
      const worker = async (peer: Peer) => {
        while (jobs.length && !this.closed && !bad.has(peer)) {
          const job = jobs.shift()!;
          const f = post.files[job.file];
          const len = Math.min(CHUNK, f.size - job.index * CHUNK);
          try {
            const data = await this.requestChunk(peer, post.id, job.file, job.index);
            if (data.length !== len || !b4a.equals(hashChunk(data), hashAt(job.global))) {
              log("bad chunk from", peer.memberKey?.slice(0, 8));
              jobs.push(job);
              bad.add(peer);
              continue;
            }
            await handles[job.file].write(data, 0, len, job.index * CHUNK);
            t.bytes += len;
            this.changed();
          } catch {
            jobs.unshift(job);
            const s = (strikes.get(peer) ?? 0) + 1;
            strikes.set(peer, s);
            if (s >= 3 || !this.peers.has(peer)) bad.add(peer);
          }
        }
      };
      while (jobs.length && !this.closed) {
        const all = this.sourcesFor(post);
        if (!all.length) throw new Paused("Paused. It picks up where it left off when someone with a copy is back.");
        const usable = all.filter((p) => !bad.has(p));
        if (!usable.length) throw new Error("Nobody online has a clean copy of this right now.");
        await Promise.all(usable.flatMap((p) => Array.from({ length: WINDOW }, () => worker(p))));
      }
      if (jobs.length) throw new Paused("Paused.");
    } finally {
      for (const fh of handles) await fh.close().catch(() => {});
    }
    for (const target of targets) fs.renameSync(`${target}.part`, target);
  }

  private autoDownload() {
    const s = this.settings();
    if (!s.autoDownload) return;
    const max = s.autoDownloadMaxMB * 1024 * 1024;
    for (const p of this.allPosts()) {
      if (this.isMine(p.author) || this.local.paths[p.id] || this.transfers.has(p.id)) continue;
      if (p.totalSize > max) continue;
      this.enqueueDownload(p.id);
    }
  }

  localPath(postId: string): string | undefined {
    const p = this.local.paths[postId];
    return p && fs.existsSync(p) ? p : undefined;
  }

  /** True when a path is already shared by me or sits inside something I downloaded. */
  knows(): (abs: string) => boolean {
    const files = new Set(Object.values(this.local.files).flat());
    const roots = Object.entries(this.local.paths)
      .filter(([id]) => !this.local.files[id])
      .map(([, p]) => p);
    const shared = Object.entries(this.local.paths)
      .filter(([id]) => this.local.files[id])
      .map(([, p]) => p);
    const inside = (abs: string, root: string) => abs === root || abs.startsWith(root + path.sep);
    return (abs) => files.has(abs) || shared.includes(abs) || roots.some((r) => inside(abs, r));
  }

  private pruneInvites() {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const kept = this.local.invites.filter((i) => i.expires > cutoff);
    if (kept.length !== this.local.invites.length) {
      this.local.invites = kept;
      this.saveLocal();
    }
  }

  private openInvites(): StoredInvite[] {
    const now = Date.now();
    return this.local.invites.filter((i) => !i.usedBy && i.expires > now);
  }

  inviteViews(): InviteView[] {
    return this.openInvites().map((i) => ({
      id: i.id,
      link: inviteLink(i.token, this.group.name, this.identity.name),
      createdAt: i.createdAt,
      expires: i.expires,
    }));
  }

  joinRequests(): JoinRequest[] {
    return [...this.requests.values()].map((r) => r.view);
  }

  createInvite(): InviteView {
    const now = Date.now();
    const inv: StoredInvite = { id: randomId(), token: hex(crypto.randomBytes(32)), createdAt: now, expires: now + INVITE_TTL };
    this.local.invites.push(inv);
    this.saveLocal();
    this.listenForInvite(inv);
    this.changed();
    return this.inviteViews().find((v) => v.id === inv.id)!;
  }

  cancelInvite(id: string) {
    this.local.invites = this.local.invites.filter((i) => i.id !== id);
    this.saveLocal();
    this.stopListening(id);
    for (const [k, r] of this.requests) {
      if (r.invite.id !== id) continue;
      r.msg.send({ t: "denied", reason: "expired" });
      this.requests.delete(k);
    }
    this.changed();
  }

  private listenForInvite(inv: StoredInvite) {
    if (this.inviteDiscoveries.has(inv.id)) return;
    const topic = inviteTopic(b4a.from(inv.token, "hex"));
    this.inviteDiscoveries.set(inv.id, topic);
    this.swarm.join(topic, { server: true, client: false });
  }

  private stopListening(id: string) {
    const topic = this.inviteDiscoveries.get(id);
    if (!topic) return;
    this.inviteDiscoveries.delete(id);
    void this.swarm.leave(topic).catch(() => {});
  }

  private onInviteMessage(conn: any, msg: any, m: any) {
    if (m?.t !== "hello" || typeof m.proof !== "string" || !HEX64.test(m.proof)) return;
    if ([...this.requests.values()].some((r) => r.conn === conn)) return;
    const remote: Buffer = conn.remotePublicKey;
    const proof = b4a.from(m.proof, "hex");
    const inv = this.local.invites.find((i) => b4a.equals(crypto.hash([b4a.from(i.token, "hex"), remote]), proof));
    if (!inv) return;
    if (inv.usedBy) return msg.send({ t: "denied", reason: "used" });
    if (inv.expires < Date.now()) return msg.send({ t: "denied", reason: "expired" });
    if (this.group.removed.includes(hex(remote))) return msg.send({ t: "denied", reason: "denied" });
    const view: JoinRequest = {
      id: randomId(),
      name: String(m.name ?? "").trim().slice(0, 40) || "Someone",
      code: safetyCode(b4a.from(inv.token, "hex"), conn.publicKey, remote),
      at: Date.now(),
    };
    this.requests.set(view.id, { view, invite: inv, msg, conn });
    conn.on("close", () => {
      if (this.requests.delete(view.id)) this.changed();
    });
    log("join request from", view.name);
    this.emit("join-request", view);
    this.changed();
  }

  answerJoin(requestId: string, approve: boolean) {
    const r = this.requests.get(requestId);
    if (!r) throw new Error("They're not waiting anymore. Ask them to try the link again.");
    this.requests.delete(requestId);
    if (!approve) {
      r.msg.send({ t: "denied", reason: "denied" });
      this.cancelInvite(r.invite.id);
    } else {
      r.invite.usedBy = hex(r.conn.remotePublicKey);
      this.saveLocal();
      this.stopListening(r.invite.id);
      const welcome: Welcome = { id: this.group.id, name: this.group.name, owner: this.group.owner, epochs: this.group.epochs, removed: this.group.removed };
      r.msg.send({ t: "welcome", group: welcome });
      for (const [k, other] of this.requests) {
        if (other.invite.id !== r.invite.id) continue;
        other.msg.send({ t: "denied", reason: "used" });
        this.requests.delete(k);
      }
    }
    this.changed();
  }

  async removeMember(identity: string) {
    if (!this.group.owner || this.group.owner !== this.identity.publicKey) throw new Error("Only the person who started this queueue can remove people.");
    if (identity === this.identity.publicKey) throw new Error("You can't remove yourself. Leave the queueue instead.");
    const removed = [...new Set([...this.group.removed, identity])];
    const recipients = new Set<string>();
    for (const m of this.members.values()) {
      const id = m.profile?.identity;
      if (!this.mine.has(m) && id && HEX64.test(id) && !removed.includes(id)) recipients.add(id);
    }
    const secret = crypto.randomBytes(32);
    const seals: Record<string, string> = {};
    for (const id of recipients) seals[id] = hex(sealTo(secret, b4a.from(id, "hex")));
    const record: EpochRecord = { epoch: this.keys.epoch + 1, removed, seals, by: this.identity.publicKey, at: Date.now() };
    this.switching = true;
    await this.me.drive.putEntry(`/epochs/${record.epoch}`, { metadata: { ...record, sig: signJson(record, this.keyPair) } });
    log("rotated to epoch", record.epoch, "sealed for", recipients.size);
    this.emit("epoch", { secret: hex(secret), removed });
  }

  private considerEpoch(meta: any) {
    if (!meta || this.switching || !this.group.owner) return;
    const record: EpochRecord = { epoch: meta.epoch, removed: meta.removed, seals: meta.seals, by: meta.by, at: meta.at };
    if (record.epoch !== this.keys.epoch + 1 || record.by !== this.group.owner) return;
    if (!Array.isArray(record.removed) || !record.seals || typeof meta.sig !== "string" || !verifyJson(record, meta.sig, record.by)) return;
    if (record.removed.includes(this.identity.publicKey)) {
      this.switching = true;
      log("removed from group");
      this.emit("removed");
      return;
    }
    const sealed = record.seals[this.identity.publicKey];
    const secret = typeof sealed === "string" ? openSealed(b4a.from(sealed, "hex"), this.keyPair) : null;
    if (!secret || secret.length !== 32) return;
    this.switching = true;
    log("moving to epoch", record.epoch);
    this.emit("epoch", { secret: hex(secret), removed: record.removed });
  }
}
