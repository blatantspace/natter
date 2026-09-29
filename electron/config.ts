import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { app } from "electron";
import crypto from "hypercore-crypto";
import b4a from "b4a";
import type { Identity, Settings } from "../shared/types";

const COLORS = ["#c45c5c", "#3d7a76", "#5a6ea8", "#c48a3a", "#7a5a8a", "#4a8a5a", "#a85a4a", "#5a7a9a", "#8a6a4a", "#6a7a50"];

export function dataDir(...parts: string[]): string {
  const dir = path.join(app.getPath("userData"), ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

interface StoredIdentity {
  publicKey: string;
  secretKey: string;
  name: string;
  color: string;
}

export interface KeyPair {
  publicKey: Buffer;
  secretKey: Buffer;
}

const identityFile = () => path.join(dataDir(), "identity.json");

export function loadIdentity(): { identity: Identity; keyPair: KeyPair } | null {
  const stored = readJson<StoredIdentity | null>(identityFile(), null);
  if (!stored?.name) return null;
  return {
    identity: { publicKey: stored.publicKey, name: stored.name, color: stored.color },
    keyPair: { publicKey: b4a.from(stored.publicKey, "hex"), secretKey: b4a.from(stored.secretKey, "hex") },
  };
}

export function saveIdentity(name: string): { identity: Identity; keyPair: KeyPair } {
  const existing = readJson<StoredIdentity | null>(identityFile(), null);
  let stored: StoredIdentity;
  if (existing?.publicKey) {
    stored = { ...existing, name };
  } else {
    const kp = crypto.keyPair();
    const pk = b4a.toString(kp.publicKey, "hex");
    stored = {
      publicKey: pk,
      secretKey: b4a.toString(kp.secretKey, "hex"),
      name,
      color: COLORS[parseInt(pk.slice(0, 4), 16) % COLORS.length],
    };
  }
  writeJson(identityFile(), stored);
  return loadIdentity()!;
}

const settingsFile = () => path.join(dataDir(), "settings.json");

export function loadSettings(): Settings {
  const defaults: Settings = {
    autoDownload: false,
    autoDownloadMaxMB: 2048,
    downloadDir: path.join(os.homedir(), "Downloads", "queueue"),
    tmdbKey: "",
    openAtLogin: true,
    favouritesAsked: false,
    autoplayClips: true,
  };
  return { ...defaults, ...readJson<Partial<Settings>>(settingsFile(), {}) };
}

export function saveSettings(s: Settings): void {
  writeJson(settingsFile(), s);
}
