import path from "node:path";
import crypto from "hypercore-crypto";
import b4a from "b4a";
import { dataDir, readJson, writeJson } from "./config";
import type { GroupInfo } from "../shared/types";

export interface StoredGroup {
  id: string;
  name: string;
  owner: string;
  epochs: string[];
  removed: string[];
  createdAt: number;
  joined?: boolean;
  secret?: string;
}

export interface PendingJoin {
  token: string;
  name: string;
  from: string;
  startedAt: number;
}

interface GroupsFile {
  groups: StoredGroup[];
  active: string | null;
  pending?: PendingJoin | null;
}

export interface EpochKeys {
  secret: Buffer;
  topic: Buffer;
  encryptionKey: Buffer;
}

export interface GroupKeys extends EpochKeys {
  epoch: number;
  epochs: EpochKeys[];
}

export const INVITE_TTL = 7 * 24 * 60 * 60 * 1000;

const file = () => path.join(dataDir(), "groups.json");

const derive = (secret: Buffer, label: string) => crypto.hash([secret, b4a.from(`queueue:${label}`)]);

export const inviteTopic = (token: Buffer) => derive(token, "invite");

function epochKeys(secretHex: string): EpochKeys {
  const secret = b4a.from(secretHex, "hex");
  return { secret, topic: derive(secret, "topic"), encryptionKey: derive(secret, "enc") };
}

export function groupKeys(g: StoredGroup): GroupKeys {
  const epochs = g.epochs.map(epochKeys);
  return { ...epochs[epochs.length - 1], epoch: epochs.length - 1, epochs };
}

export function toInfo(g: StoredGroup, me?: string): GroupInfo {
  return { id: g.id, name: g.name, createdAt: g.createdAt, joined: !!g.joined, owner: g.owner, isOwner: !!me && g.owner === me };
}

function idFor(secretHex: string): string {
  return b4a.toString(derive(b4a.from(secretHex, "hex"), "id"), "hex").slice(0, 16);
}

function migrate(g: StoredGroup, me: string): StoredGroup {
  if (g.epochs?.length) return g;
  return { ...g, epochs: [g.secret!], removed: [], owner: g.joined ? "" : me, secret: undefined };
}

export function loadGroups(me = ""): GroupsFile {
  const f = readJson<GroupsFile>(file(), { groups: [], active: null, pending: null });
  f.groups = f.groups.map((g) => migrate(g, me));
  return f;
}

function save(f: GroupsFile) {
  writeJson(file(), f);
}

export function activeGroup(me = ""): StoredGroup | null {
  const f = loadGroups(me);
  return f.groups.find((g) => g.id === f.active) ?? f.groups[0] ?? null;
}

export function createGroup(name: string, owner: string): StoredGroup {
  const secret = b4a.toString(crypto.randomBytes(32), "hex");
  const g: StoredGroup = { id: idFor(secret), name: name.trim() || "Our queueue", owner, epochs: [secret], removed: [], createdAt: Date.now() };
  const f = loadGroups(owner);
  f.groups.push(g);
  f.active = g.id;
  save(f);
  return g;
}

export function inviteLink(token: string, groupName: string, from: string): string {
  return `queueue://invite/${token}?name=${encodeURIComponent(groupName)}&from=${encodeURIComponent(from)}`;
}

export function parseInvite(text: string): PendingJoin {
  const link = text.match(/queueue:\/\/invite\/([0-9a-f]{64})\S*/i);
  if (!link) {
    if (/queueue:\/\/join\//i.test(text)) throw new Error("That's an old-style invite. Ask for a fresh link.");
    throw new Error("That doesn't look like a queueue invite link.");
  }
  let name = "Friends";
  let from = "a friend";
  try {
    const url = new URL(link[0].replace(/^queueue:\/\//i, "https://queueue.invalid/"));
    name = url.searchParams.get("name") || name;
    from = url.searchParams.get("from") || from;
  } catch {
    // keep defaults
  }
  return { token: link[1].toLowerCase(), name: name.slice(0, 48), from: from.slice(0, 40), startedAt: Date.now() };
}

export function setPending(p: PendingJoin | null) {
  const f = loadGroups();
  f.pending = p;
  save(f);
}

export function addJoinedGroup(g: Omit<StoredGroup, "joined" | "createdAt">): StoredGroup {
  const f = loadGroups();
  const existing = f.groups.find((x) => x.id === g.id);
  const stored: StoredGroup = { ...existing, ...g, createdAt: existing?.createdAt ?? Date.now(), joined: true };
  f.groups = [...f.groups.filter((x) => x.id !== g.id), stored];
  f.active = g.id;
  f.pending = null;
  save(f);
  return stored;
}

export function addEpoch(id: string, secret: string, removed: string[]): StoredGroup | null {
  const f = loadGroups();
  const g = f.groups.find((x) => x.id === id);
  if (!g) return null;
  if (!g.epochs.includes(secret)) g.epochs.push(secret);
  g.removed = [...new Set([...g.removed, ...removed])];
  save(f);
  return g;
}

export function setActive(id: string): StoredGroup {
  const f = loadGroups();
  const g = f.groups.find((x) => x.id === id);
  if (!g) throw new Error("Unknown queueue");
  f.active = id;
  save(f);
  return g;
}

export function removeGroup(id: string): void {
  const f = loadGroups();
  f.groups = f.groups.filter((g) => g.id !== id);
  if (f.active === id) f.active = f.groups[0]?.id ?? null;
  save(f);
}
