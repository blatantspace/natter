import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { nanoid } from "nanoid";
import { openDb, getReactionsForMessages, getReactionsForMessage, markChannelRead, getUnreadCounts } from "./db.js";
import { attachRealtime } from "./realtime.js";
import { attachTracker } from "./tracker.js";
import {
  getColorForName,
  hashPin,
  verifyPin,
  createDeviceToken,
  getPersonByToken,
} from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3847);
const isProd = process.env.NODE_ENV === "production";
const uploadsDir = path.join(__dirname, "..", "data", "encrypted_uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const db = openDb();
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });
const { wss: trackerWss } = attachTracker();

server.on("upgrade", (request, socket, head) => {
  const { pathname } = new URL(request.url, "http://natter.local");
  if (pathname === "/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else if (pathname === "/tracker") {
    trackerWss.handleUpgrade(request, socket, head, (ws) => {
      trackerWss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.raw({ type: "application/octet-stream", limit: "100mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "natter" });
});

app.get("/api/bootstrap", (req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim() || String(req.query.token || "");
  let person = null;
  if (token) {
    person = getPersonByToken(db, token);
  } else if (req.query.personId) {
    person = db
      .prepare(`SELECT id FROM people WHERE id = ?`)
      .get(String(req.query.personId));
  }

  const channels = db
    .prepare(
      `SELECT id, name, topic, kind, dm_user1_id AS dmUser1Id, dm_user2_id AS dmUser2Id, created_at AS createdAt
       FROM channels ORDER BY kind DESC, name ASC`
    )
    .all();
  const people = db
    .prepare(
      `SELECT id, display_name AS displayName, color, last_seen AS lastSeen
       FROM people ORDER BY display_name ASC`
    )
    .all();

  const unreadCounts = person ? getUnreadCounts(db, person.id) : {};

  res.json({
    workspace: { name: "Natter Lounge", emoji: "💬" },
    channels,
    people,
    unreadCounts,
  });
});

app.get("/api/channels/:id/messages", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 80, 200);
  const before = req.query.before ? Number(req.query.before) : null;
  const query = `
    SELECT m.id, m.channel_id AS channelId, m.author_id AS authorId,
           m.body, m.created_at AS createdAt, m.source,
           m.attachment_id AS attachmentId, m.attachment_name AS attachmentName,
           m.attachment_type AS attachmentType, m.attachment_size AS attachmentSize,
           m.attachment_iv AS attachmentIv, m.parent_id AS parentId,
           m.info_hash AS infoHash,
           m.edited_at AS editedAt, m.deleted_at AS deletedAt, m.legacy_enc AS legacyEnc,
           (SELECT COUNT(*) FROM messages r WHERE r.parent_id = m.id) AS replyCount,
           (SELECT MAX(created_at) FROM messages r WHERE r.parent_id = m.id) AS lastReplyAt,
           p.display_name AS authorName, p.color AS authorColor
    FROM messages m
    JOIN people p ON p.id = m.author_id
    WHERE m.channel_id = ? AND m.parent_id IS NULL ${before ? "AND m.created_at < ?" : ""}
    ORDER BY m.created_at DESC LIMIT ?
  `;
  const rows = before
    ? db.prepare(query).all(req.params.id, before, limit)
    : db.prepare(query).all(req.params.id, limit);

  const messageIds = rows.map((r) => r.id);
  const reactionsMap = getReactionsForMessages(db, messageIds);
  const messagesWithReactions = rows.map((r) => ({
    ...r,
    reactions: reactionsMap.get(r.id) || [],
  }));

  res.json({ messages: messagesWithReactions.reverse() });
});

// Get thread parent message and its replies
app.get("/api/messages/:id/thread", (req, res) => {
  const parentQuery = `
    SELECT m.id, m.channel_id AS channelId, m.author_id AS authorId,
           m.body, m.created_at AS createdAt, m.source,
           m.attachment_id AS attachmentId, m.attachment_name AS attachmentName,
           m.attachment_type AS attachmentType, m.attachment_size AS attachmentSize,
           m.attachment_iv AS attachmentIv, m.parent_id AS parentId,
           m.info_hash AS infoHash,
           m.edited_at AS editedAt, m.deleted_at AS deletedAt, m.legacy_enc AS legacyEnc,
           (SELECT COUNT(*) FROM messages r WHERE r.parent_id = m.id) AS replyCount,
           (SELECT MAX(created_at) FROM messages r WHERE r.parent_id = m.id) AS lastReplyAt,
           p.display_name AS authorName, p.color AS authorColor
    FROM messages m
    JOIN people p ON p.id = m.author_id
    WHERE m.id = ?
  `;
  const parent = db.prepare(parentQuery).get(req.params.id);
  if (!parent) {
    return res.status(404).json({ error: "Message not found" });
  }

  const repliesQuery = `
    SELECT m.id, m.channel_id AS channelId, m.author_id AS authorId,
           m.body, m.created_at AS createdAt, m.source,
           m.attachment_id AS attachmentId, m.attachment_name AS attachmentName,
           m.attachment_type AS attachmentType, m.attachment_size AS attachmentSize,
           m.attachment_iv AS attachmentIv, m.parent_id AS parentId,
           m.info_hash AS infoHash,
           m.edited_at AS editedAt, m.deleted_at AS deletedAt, m.legacy_enc AS legacyEnc,
           p.display_name AS authorName, p.color AS authorColor
    FROM messages m
    JOIN people p ON p.id = m.author_id
    WHERE m.parent_id = ?
    ORDER BY m.created_at ASC
  `;
  const replies = db.prepare(repliesQuery).all(req.params.id);

  const allIds = [parent.id, ...replies.map((r) => r.id)];
  const reactionsMap = getReactionsForMessages(db, allIds);

  const parentWithReactions = {
    ...parent,
    reactions: reactionsMap.get(parent.id) || [],
  };
  const repliesWithReactions = replies.map((r) => ({
    ...r,
    reactions: reactionsMap.get(r.id) || [],
  }));

  res.json({ parent: parentWithReactions, replies: repliesWithReactions });
});

app.get("/api/seeds", (req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim() || String(req.query.token || "");
  let person = null;
  if (token) {
    person = getPersonByToken(db, token);
  } else if (req.query.personId) {
    person = db.prepare(`SELECT id FROM people WHERE id = ?`).get(String(req.query.personId));
  }
  if (!person) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const rows = db.prepare(`
    SELECT m.id, m.channel_id AS channelId, m.author_id AS authorId,
           m.body, m.created_at AS createdAt, m.source,
           m.attachment_id AS attachmentId, m.attachment_name AS attachmentName,
           m.attachment_type AS attachmentType, m.attachment_size AS attachmentSize,
           m.attachment_iv AS attachmentIv, m.parent_id AS parentId,
           m.info_hash AS infoHash,
           m.edited_at AS editedAt, m.deleted_at AS deletedAt, m.legacy_enc AS legacyEnc,
           p.display_name AS authorName, p.color AS authorColor,
           c.name AS channelName, c.kind AS channelKind
    FROM messages m
    JOIN people p ON p.id = m.author_id
    JOIN channels c ON c.id = m.channel_id
    WHERE (m.attachment_id IS NOT NULL OR m.info_hash IS NOT NULL)
      AND m.deleted_at IS NULL
      AND (
        c.kind = 'lounge'
        OR (c.kind = 'dm' AND (c.dm_user1_id = ? OR c.dm_user2_id = ?))
      )
    ORDER BY m.created_at DESC
    LIMIT 400
  `).all(person.id, person.id);

  res.json({ messages: rows });
});

function safeInfoHash(value) {
  const hash = String(value || "").toLowerCase();
  if (/^[a-f0-9]{40}$/.test(hash) || /^[a-z2-7]{32}$/.test(hash)) return hash;
  return null;
}

const magnetsDir = path.join(__dirname, "..", "data", "magnet_torrents");
fs.mkdirSync(magnetsDir, { recursive: true });

app.put("/api/magnets/:infoHash/torrent", (req, res) => {
  const infoHash = safeInfoHash(req.params.infoHash);
  if (!infoHash) return res.status(400).json({ error: "Bad infohash" });
  if (!req.body || !req.body.length) return res.status(400).json({ error: "Empty torrent" });
  const filePath = path.join(magnetsDir, `${infoHash}.torrent`);
  fs.writeFile(filePath, req.body, (err) => {
    if (err) return res.status(500).json({ error: "Failed to store torrent" });
    res.json({ ok: true, infoHash });
  });
});

app.get("/api/magnets/:infoHash/torrent", (req, res) => {
  const infoHash = safeInfoHash(req.params.infoHash);
  if (!infoHash) return res.status(400).json({ error: "Bad infohash" });
  const filePath = path.join(magnetsDir, `${infoHash}.torrent`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Not found" });
  res.setHeader("Content-Type", "application/x-bittorrent");
  res.setHeader("Cache-Control", "private, no-store");
  fs.createReadStream(filePath).pipe(res);
});

// Blind Encrypted Blob Upload Endpoint
app.post("/api/files/encrypted", (req, res) => {
  const uploaderId = String(req.headers["x-uploader-id"] || "unknown");
  if (!req.body || !req.body.length) {
    return res.status(400).json({ error: "That upload had nothing in it. Nothing was saved." });
  }

  const fileId = `f_${nanoid(16)}`;
  const filePath = path.join(uploadsDir, `${fileId}.enc`);

  fs.writeFile(filePath, req.body, (err) => {
    if (err) {
      return res.status(500).json({ error: "The file could not be saved on the server. Please try again." });
    }

    const sizeBytes = req.body.length || 0;
    db.prepare(`
      INSERT INTO encrypted_files (id, original_name, mime_type, size_bytes, iv, file_path, uploader_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fileId,
      `${fileId}.bin`,
      "application/octet-stream",
      sizeBytes,
      "",
      filePath,
      uploaderId,
      Date.now()
    );

    res.status(201).json({
      ok: true,
      fileId,
      sizeBytes,
    });
  });
});

function sendEncryptedBlob(req, res, filePath, sizeBytes) {
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const range = req.headers.range;
  if (!range) {
    res.setHeader("Content-Length", String(sizeBytes));
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const match = String(range).match(/bytes=(\d*)-(\d*)/);
  if (!match) {
    res.status(416).end();
    return;
  }

  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : sizeBytes - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= sizeBytes) {
    res.status(416);
    res.setHeader("Content-Range", `bytes */${sizeBytes}`);
    res.end();
    return;
  }

  end = Math.min(end, sizeBytes - 1);
  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${sizeBytes}`);
  res.setHeader("Content-Length", String(end - start + 1));
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

// Download Blind Encrypted Blob (webseed)
app.get("/api/files/:id/raw", (req, res) => {
  const row = db.prepare(`SELECT * FROM encrypted_files WHERE id = ?`).get(req.params.id);
  if (!row || !fs.existsSync(row.file_path)) {
    return res.status(404).json({ error: "Encrypted file not found" });
  }

  const sizeBytes = Number(row.size_bytes) || fs.statSync(row.file_path).size;
  sendEncryptedBlob(req, res, row.file_path, sizeBytes);
});

app.put("/api/files/:id/torrent", (req, res) => {
  const row = db.prepare(`SELECT id FROM encrypted_files WHERE id = ?`).get(req.params.id);
  if (!row) {
    return res.status(404).json({ error: "Unknown file" });
  }
  const infoHash = String(req.headers["x-info-hash"] || "")
    .toLowerCase()
    .replace(/[^a-f0-9]/g, "");
  if (infoHash.length !== 40) {
    return res.status(400).json({ error: "40-char infoHash required" });
  }
  if (!req.body || !req.body.length) {
    return res.status(400).json({ error: "Empty torrent body" });
  }

  const torrentPath = path.join(uploadsDir, `${row.id}.torrent`);
  fs.writeFile(torrentPath, req.body, (err) => {
    if (err) {
      return res.status(500).json({ error: "Failed to store torrent" });
    }
    db.prepare(`UPDATE encrypted_files SET info_hash = ? WHERE id = ?`).run(infoHash, row.id);
    res.json({ ok: true, infoHash });
  });
});

app.get("/api/files/:id/torrent", (req, res) => {
  const torrentPath = path.join(uploadsDir, `${req.params.id}.torrent`);
  if (!fs.existsSync(torrentPath)) {
    return res.status(404).json({ error: "No torrent for this file" });
  }
  res.setHeader("Content-Type", "application/x-bittorrent");
  res.setHeader("Cache-Control", "private, no-store");
  fs.createReadStream(torrentPath).pipe(res);
});

// Direct Messages: Find or create a 1-on-1 DM channel between two users
app.post("/api/dm", (req, res) => {
  const user1Id = String(req.body?.user1Id || "").trim();
  const user2Id = String(req.body?.user2Id || "").trim();

  if (!user1Id || !user2Id) {
    return res.status(400).json({ error: "Both user IDs are required" });
  }

  const u1 = db.prepare(`SELECT id, display_name FROM people WHERE id = ?`).get(user1Id);
  const u2 = db.prepare(`SELECT id, display_name FROM people WHERE id = ?`).get(user2Id);

  if (!u1 || !u2) {
    return res.status(404).json({ error: "User not found" });
  }

  // Check if a DM channel already exists between these two users (order-independent)
  let channel = db
    .prepare(
      `SELECT id, name, topic, kind, dm_user1_id AS dmUser1Id, dm_user2_id AS dmUser2Id, created_at AS createdAt
       FROM channels
       WHERE kind = 'dm' AND (
         (dm_user1_id = ? AND dm_user2_id = ?) OR
         (dm_user1_id = ? AND dm_user2_id = ?)
       )`
    )
    .get(user1Id, user2Id, user2Id, user1Id);

  if (!channel) {
    const sortedIds = [user1Id, user2Id].sort();
    const id = `dm_${sortedIds[0]}_${sortedIds[1]}`;
    const name = `dm-${u1.display_name.toLowerCase()}-${u2.display_name.toLowerCase()}`;
    const topic = `Direct message between ${u1.display_name} and ${u2.display_name}`;
    const now = Date.now();

    db.prepare(
      `INSERT INTO channels (id, name, topic, kind, dm_user1_id, dm_user2_id, created_at)
       VALUES (?, ?, ?, 'dm', ?, ?, ?)`
    ).run(id, name, topic, user1Id, user2Id, now);

    channel = {
      id,
      name,
      topic,
      kind: "dm",
      dmUser1Id: user1Id,
      dmUser2Id: user2Id,
      createdAt: now,
    };

    broadcast({ type: "channel.created", channel });
  }

  return res.json({ channel });
});

app.post("/api/channels", (req, res) => {
  const name = String(req.body?.name || "")
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
  if (!name) return res.status(400).json({ error: "Channel name required" });
  const topic = String(req.body?.topic || "").trim().slice(0, 200);
  const existing = db
    .prepare(`SELECT id FROM channels WHERE name = ?`)
    .get(name);
  if (existing) return res.status(409).json({ error: "Channel already exists" });
  const id = `ch_${name}`;
  db.prepare(
    `INSERT INTO channels (id, name, topic, kind) VALUES (?, ?, ?, 'lounge')`
  ).run(id, name, topic || `Hangout in #${name}`);
  const channel = db
    .prepare(
      `SELECT id, name, topic, kind, created_at AS createdAt
       FROM channels WHERE id = ?`
    )
    .get(id);
  broadcast({ type: "channel.created", channel });
  res.status(201).json({ channel });
});

// Auth: Check if a display name exists and whether it requires a PIN
app.post("/api/auth/check", (req, res) => {
  const displayName = String(req.body?.displayName || "").trim().slice(0, 32);
  if (!displayName) {
    return res.status(400).json({ error: "Display name required" });
  }

  const person = db
    .prepare(
      `SELECT id, display_name AS displayName, color, pin_hash AS pinHash
       FROM people WHERE lower(trim(display_name)) = lower(trim(?))`
    )
    .get(displayName);

  if (!person) {
    return res.json({
      exists: false,
      hasPin: false,
      color: getColorForName(displayName),
    });
  }

  return res.json({
    exists: true,
    hasPin: Boolean(person.pinHash),
    displayName: person.displayName,
    color: person.color,
  });
});

// Auth: Login or register with a display name + optional PIN or device token
app.post("/api/auth/login", (req, res) => {
  const displayName = String(req.body?.displayName || "").trim().slice(0, 32);
  const pin = req.body?.pin ? String(req.body.pin).trim() : null;
  const clientToken = req.body?.token ? String(req.body.token).trim() : null;

  if (!displayName) {
    return res.status(400).json({ error: "Display name required" });
  }

  let person = db
    .prepare(
      `SELECT id, display_name AS displayName, color, pin_hash AS pinHash, last_seen AS lastSeen
       FROM people WHERE lower(trim(display_name)) = lower(trim(?))`
    )
    .get(displayName);

  // If person exists, verify authentication
  if (person) {
    let authenticated = false;

    // 1. Check if the device token matches this person
    if (clientToken) {
      const match = db
        .prepare(`SELECT person_id FROM device_tokens WHERE token = ? AND person_id = ?`)
        .get(clientToken, person.id);
      if (match) authenticated = true;
    }

    // 2. Check PIN if not already authenticated via device token
    if (!authenticated) {
      if (person.pinHash) {
        if (!pin) {
          return res.status(401).json({
            error: "This name is protected by a 4-digit PIN. Please enter your PIN.",
            requiresPin: true,
          });
        }
        if (!verifyPin(pin, person.pinHash)) {
          return res.status(401).json({
            error: "Incorrect PIN for this name. Try again.",
            requiresPin: true,
          });
        }
        authenticated = true;
      } else {
        // Person has no PIN set yet
        if (pin) {
          // User chose to set a PIN now
          const newPinHash = hashPin(pin);
          db.prepare(`UPDATE people SET pin_hash = ? WHERE id = ?`).run(newPinHash, person.id);
        }
        authenticated = true;
      }
    }

    const token = createDeviceToken(db, person.id);
    const now = Date.now();
    db.prepare(`UPDATE people SET last_seen = ? WHERE id = ?`).run(now, person.id);

    const safePerson = {
      id: person.id,
      displayName: person.displayName,
      color: person.color,
      lastSeen: now,
      hasPin: Boolean(person.pinHash || pin),
    };

    const unreadCounts = getUnreadCounts(db, person.id);
    return res.json({ person: safePerson, token, unreadCounts });
  }

  // Person does not exist -> Create new unique person
  const id = `u_${nanoid(10)}`;
  const color = getColorForName(displayName);
  const pinHash = pin ? hashPin(pin) : null;
  const now = Date.now();

  try {
    db.prepare(
      `INSERT INTO people (id, display_name, color, pin_hash, last_seen) VALUES (?, ?, ?, ?, ?)`
    ).run(id, displayName, color, pinHash, now);
  } catch (err) {
    return res.status(409).json({ error: "Display name is already taken." });
  }

  const token = createDeviceToken(db, id);
  const channelsList = db.prepare(`SELECT id FROM channels`).all();
  for (const ch of channelsList) {
    markChannelRead(db, id, ch.id, now);
  }

  const safePerson = {
    id,
    displayName,
    color,
    lastSeen: now,
    hasPin: Boolean(pinHash),
  };

  broadcast({ type: "people.joined", person: safePerson });
  return res.status(201).json({ person: safePerson, token, unreadCounts: {} });
});

// Auth: Verify existing saved device token
app.get("/api/auth/me", (req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim() || String(req.query.token || "");

  if (!token) {
    return res.status(401).json({ ok: false, error: "No token provided" });
  }

  const person = getPersonByToken(db, token);
  if (!person) {
    return res.status(401).json({ ok: false, error: "Invalid or expired session" });
  }

  db.prepare(`UPDATE people SET last_seen = ? WHERE id = ?`).run(Date.now(), person.id);
  const unreadCounts = getUnreadCounts(db, person.id);
  return res.json({ ok: true, person, token, unreadCounts });
});

// Channel Read & Unread Endpoints
app.post("/api/channels/:id/read", (req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim() || String(req.body?.token || "");
  let person = null;
  if (token) {
    person = getPersonByToken(db, token);
  } else if (req.body?.personId) {
    person = db.prepare(`SELECT id FROM people WHERE id = ?`).get(String(req.body.personId));
  }

  if (!person) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  markChannelRead(db, person.id, req.params.id, Date.now());
  const unreadCounts = getUnreadCounts(db, person.id);
  return res.json({ ok: true, unreadCounts });
});

app.get("/api/unread", (req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim() || String(req.query.token || "");
  let person = null;
  if (token) {
    person = getPersonByToken(db, token);
  } else if (req.query.personId) {
    person = db.prepare(`SELECT id FROM people WHERE id = ?`).get(String(req.query.personId));
  }

  if (!person) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const unreadCounts = getUnreadCounts(db, person.id);
  return res.json({ ok: true, unreadCounts });
});

// Auth: Logout and invalidate device token
app.post("/api/auth/logout", (req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim() || String(req.body?.token || "");

  if (token) {
    db.prepare(`DELETE FROM device_tokens WHERE token = ?`).run(token);
  }

  return res.json({ ok: true });
});

// Delete person by ID (admin/cleanup endpoint)
app.delete("/api/people/:id", (req, res) => {
  const personId = req.params.id;
  const person = db.prepare(`SELECT * FROM people WHERE id = ?`).get(personId);
  if (!person) {
    return res.status(404).json({ error: "Person not found" });
  }

  // Delete associated data (device tokens, reads, reactions, DM channels)
  db.prepare(`DELETE FROM device_tokens WHERE person_id = ?`).run(personId);
  db.prepare(`DELETE FROM channel_reads WHERE person_id = ?`).run(personId);
  db.prepare(`DELETE FROM reactions WHERE person_id = ?`).run(personId);
  db.prepare(`DELETE FROM channels WHERE dm_user1_id = ? OR dm_user2_id = ?`).run(personId, personId);
  db.prepare(`DELETE FROM people WHERE id = ?`).run(personId);

  broadcast({ type: "people.removed", personId });
  return res.json({ ok: true, removed: person });
});

// Legacy backward-compatible endpoint
app.post("/api/people", (req, res) => {
  const displayName = String(req.body?.displayName || "").trim().slice(0, 32);
  if (!displayName) {
    return res.status(400).json({ error: "Display name required" });
  }

  // Forward through login logic
  req.url = "/api/auth/login";
  return app._router.handle(req, res);
});

let broadcast = () => {};

const { broadcast: realtimeBroadcast, postMessage } = attachRealtime({
  wss,
  db,
  onReady: (fn) => {
    broadcast = fn;
  },
});

if (isProd) {
  const dist = path.join(__dirname, "..", "dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
} else {
  // Dev: UI lives on Vite — don't leave people staring at Express "Cannot GET /"
  app.get("/", (_req, res) => {
    res.redirect(302, "http://localhost:5173/");
  });
}

server.on("error", (err) => {
  console.error("Natter server failed to listen", err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Natter listening on http://localhost:${PORT}`);
});

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

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
