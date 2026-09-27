import crypto from "crypto";
import { nanoid } from "nanoid";

const COLORS = [
  "#c45c5c",
  "#3d7a76",
  "#5a6ea8",
  "#c48a3a",
  "#7a5a8a",
  "#4a8a5a",
  "#a85a4a",
  "#5a7a9a",
  "#8a6a4a",
  "#6a7a50",
];

export function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function getColorForName(name) {
  return COLORS[hashString(name.toLowerCase().trim()) % COLORS.length];
}

export function hashPin(pin) {
  if (!pin) return null;
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(String(pin), salt, 10000, 32, "sha256")
    .toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPin(pin, pinHash) {
  if (!pinHash) return true; // No PIN set
  if (!pin) return false;
  const parts = pinHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, expectedHash] = parts;
  const actualHash = crypto
    .pbkdf2Sync(String(pin), salt, 10000, 32, "sha256")
    .toString("hex");
  return actualHash === expectedHash;
}

export function createDeviceToken(db, personId) {
  const token = `dtk_${nanoid(32)}`;
  db.prepare(
    `INSERT INTO device_tokens (token, person_id, created_at) VALUES (?, ?, ?)`
  ).run(token, personId, Date.now());
  return token;
}

export function getPersonByToken(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT p.id, p.display_name AS displayName, p.color, p.last_seen AS lastSeen, p.pin_hash AS pinHash
       FROM device_tokens dt
       JOIN people p ON p.id = dt.person_id
       WHERE dt.token = ?`
    )
    .get(token);
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.displayName,
    color: row.color,
    lastSeen: row.lastSeen,
    hasPin: Boolean(row.pinHash),
  };
}
