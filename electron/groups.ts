import path from "node:path";
import crypto from "hypercore-crypto";
import b4a from "b4a";
import { dataDir, readJson, writeJson } from "./config";
import type { GroupInfo } from "../shared/types";

export interface StoredGroup {
  id: string;
  name: string;
  secret: string;
  createdAt: number;
  joined?: boolean;
}

interface GroupsFile {
  groups: StoredGroup[];
  active: string | null;
}

export interface GroupKeys {
  secret: Buffer;
  topic: Buffer;
  encryptionKey: Buffer;
}

const file = () => path.join(dataDir(), "groups.json");

const derive = (secret: Buffer, label: string) => crypto.hash([secret, b4a.from(`queueue:${label}`)]);

export function groupKeys(g: StoredGroup): GroupKeys {
  const secret = b4a.from(g.secret, "hex");
  return { secret, topic: derive(secret, "topic"), encryptionKey: derive(secret, "enc") };
}

export function inviteLink(g: StoredGroup): string {
  return `queueue://join/${g.secret}?name=${encodeURIComponent(g.name)}`;
}

export function toInfo(g: StoredGroup): GroupInfo {
  return { id: g.id, name: g.name, invite: inviteLink(g), createdAt: g.createdAt, joined: !!g.joined };
}

function idFor(secretHex: string): string {
  return b4a.toString(derive(b4a.from(secretHex, "hex"), "id"), "hex").slice(0, 16);
}

export function loadGroups(): GroupsFile {
  return readJson<GroupsFile>(file(), { groups: [], active: null });
}

function save(f: GroupsFile) {
  writeJson(file(), f);
}

export function activeGroup(): StoredGroup | null {
  const f = loadGroups();
  return f.groups.find((g) => g.id === f.active) ?? f.groups[0] ?? null;
}

export function createGroup(name: string): StoredGroup {
  const secret = b4a.toString(crypto.randomBytes(32), "hex");
  const g: StoredGroup = { id: idFor(secret), name: name.trim() || "Our queueue", secret, createdAt: Date.now() };
  const f = loadGroups();
  f.groups.push(g);
  f.active = g.id;
  save(f);
  return g;
}

export function parseInvite(invite: string): { secret: string; name: string } {
  const text = invite.trim();
  const m = text.match(/([0-9a-f]{64})/i);
  if (!m) throw new Error("That doesn't look like a queueue invite link.");
  let name = "Friends";
  const link = text.match(/queueue:\/\/join\/[0-9a-f]{64}\S*/i)?.[0];
  if (link) {
    try {
      name = new URL(link.replace(/^queueue:\/\//i, "https://queueue.invalid/")).searchParams.get("name") || name;
    } catch {
      // keep the default name
    }
  }
  return { secret: m[1].toLowerCase(), name };
}

export function joinGroup(invite: string): StoredGroup {
  const { secret, name } = parseInvite(invite);
  const f = loadGroups();
  const id = idFor(secret);
  let g = f.groups.find((x) => x.id === id);
  if (!g) {
    g = { id, name, secret, createdAt: Date.now(), joined: true };
    f.groups.push(g);
  }
  f.active = id;
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
