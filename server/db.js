import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function openDb() {
  const dataDir = path.join(__dirname, "..", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, "natter.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      color TEXT NOT NULL,
      pin_hash TEXT,
      last_seen INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS device_tokens (
      token TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      topic TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'lounge',
      dm_user1_id TEXT,
      dm_user2_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'lounge',
      attachment_id TEXT,
      attachment_name TEXT,
      attachment_type TEXT,
      attachment_size INTEGER,
      attachment_iv TEXT,
      parent_id TEXT,
      FOREIGN KEY (channel_id) REFERENCES channels(id),
      FOREIGN KEY (author_id) REFERENCES people(id)
    );

    CREATE TABLE IF NOT EXISTS encrypted_files (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      iv TEXT NOT NULL,
      file_path TEXT NOT NULL,
      uploader_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reactions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS channel_reads (
      person_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      last_read_at INTEGER NOT NULL,
      PRIMARY KEY (person_id, channel_id),
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_unique
      ON reactions(message_id, person_id, emoji);

    CREATE INDEX IF NOT EXISTS idx_reactions_message_id
      ON reactions(message_id);

    CREATE INDEX IF NOT EXISTS idx_messages_channel_time
      ON messages(channel_id, created_at);
  `);

  migrate(db);
  seed(db);
  return db;
}

function migrate(db) {
  // Ensure pin_hash column exists in people
  const peopleCols = db.prepare(`PRAGMA table_info(people)`).all();
  if (!peopleCols.some((c) => c.name === "pin_hash")) {
    db.exec(`ALTER TABLE people ADD COLUMN pin_hash TEXT;`);
  }

  // Ensure dm columns exist in channels
  const channelCols = db.prepare(`PRAGMA table_info(channels)`).all();
  if (!channelCols.some((c) => c.name === "dm_user1_id")) {
    db.exec(`ALTER TABLE channels ADD COLUMN dm_user1_id TEXT;`);
  }
  if (!channelCols.some((c) => c.name === "dm_user2_id")) {
    db.exec(`ALTER TABLE channels ADD COLUMN dm_user2_id TEXT;`);
  }

  // Ensure parent_id column exists in messages for threads
  const messageCols = db.prepare(`PRAGMA table_info(messages)`).all();
  if (!messageCols.some((c) => c.name === "parent_id")) {
    db.exec(`ALTER TABLE messages ADD COLUMN parent_id TEXT;`);
  }
  if (!messageCols.some((c) => c.name === "info_hash")) {
    db.exec(`ALTER TABLE messages ADD COLUMN info_hash TEXT;`);
  }
  if (!messageCols.some((c) => c.name === "edited_at")) {
    db.exec(`ALTER TABLE messages ADD COLUMN edited_at INTEGER;`);
  }
  if (!messageCols.some((c) => c.name === "deleted_at")) {
    db.exec(`ALTER TABLE messages ADD COLUMN deleted_at INTEGER;`);
  }
  if (!messageCols.some((c) => c.name === "legacy_enc")) {
    // Rows written while room-password encryption was on. Hidden in the app, kept in the database.
    db.exec(`ALTER TABLE messages ADD COLUMN legacy_enc INTEGER NOT NULL DEFAULT 0;`);
    db.exec(`UPDATE messages SET legacy_enc = 1 WHERE body LIKE 'ENC:%'`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_info_hash
      ON messages(info_hash);
  `);

  const fileCols = db.prepare(`PRAGMA table_info(encrypted_files)`).all();
  if (!fileCols.some((c) => c.name === "info_hash")) {
    db.exec(`ALTER TABLE encrypted_files ADD COLUMN info_hash TEXT;`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_encrypted_files_info_hash
      ON encrypted_files(info_hash);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_parent_id
      ON messages(parent_id, created_at);
  `);

  // Remove any legacy usenet channels and config
  try {
    db.exec(`DELETE FROM channels WHERE kind = 'usenet'`);
    db.exec(`DELETE FROM messages WHERE source = 'usenet'`);
    db.exec(`DROP TABLE IF EXISTS nntp_config`);
  } catch {
    // Ignore if already clean
  }

  // Ensure channel_reads table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_reads (
      person_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      last_read_at INTEGER NOT NULL,
      PRIMARY KEY (person_id, channel_id),
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );
  `);

  // Backfill channel_reads for existing users if empty
  const hasReads = db.prepare(`SELECT COUNT(*) AS n FROM channel_reads`).get().n;
  if (hasReads === 0) {
    const peopleList = db.prepare(`SELECT id, last_seen FROM people`).all();
    const channelsList = db.prepare(`SELECT id FROM channels`).all();
    const insertRead = db.prepare(`
      INSERT OR IGNORE INTO channel_reads (person_id, channel_id, last_read_at)
      VALUES (?, ?, ?)
    `);
    for (const p of peopleList) {
      for (const ch of channelsList) {
        insertRead.run(p.id, ch.id, p.last_seen || Date.now());
      }
    }
  }

  // Deduplicate people rows with same display_name (case-insensitive)
  const allPeople = db.prepare(`SELECT * FROM people ORDER BY last_seen DESC`).all();
  const seenNames = new Map();

  for (const person of allPeople) {
    const key = person.display_name.trim().toLowerCase();
    if (!seenNames.has(key)) {
      seenNames.set(key, person);
    } else {
      const canonical = seenNames.get(key);
      // Reassign all messages and files to canonical ID
      db.prepare(`UPDATE messages SET author_id = ? WHERE author_id = ?`).run(
        canonical.id,
        person.id
      );
      db.prepare(`UPDATE encrypted_files SET uploader_id = ? WHERE uploader_id = ?`).run(
        canonical.id,
        person.id
      );
      db.prepare(`DELETE FROM people WHERE id = ?`).run(person.id);
    }
  }

  // Ensure unique index on lower(display_name)
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_people_display_name_unique
      ON people(lower(trim(display_name)));
  `);
}

function seed(db) {
  const channelCount = db.prepare(`SELECT COUNT(*) AS n FROM channels`).get().n;
  if (channelCount === 0) {
    const now = Date.now();
    db.prepare(
      `INSERT INTO channels (id, name, topic, kind, created_at) VALUES
       ('ch_general', 'general', 'The living room. Say hi.', 'lounge', ?),
       ('ch_random', 'random', 'Memes, tangents, nonsense.', 'lounge', ?),
       ('ch_intros', 'intros', 'Who are you and what are you into?', 'lounge', ?)`
    ).run(now, now, now);
  }

  const peopleCount = db.prepare(`SELECT COUNT(*) AS n FROM people`).get().n;
  if (peopleCount === 0) {
    const botId = "u_natter";
    db.prepare(
      `INSERT INTO people (id, display_name, color, last_seen) VALUES (?, ?, ?, ?)`
    ).run(botId, "Natter", "#611f69", Date.now());

    const welcome = [
      {
        channel: "ch_general",
        body: "Welcome to Natter. This is your private lounge. Slack vibes with zero friction.",
      },
      {
        channel: "ch_general",
        body: "Pick a display name, hop into a channel, and chat. No accounts, no friction. Invite your buds to the same URL.",
      },
      {
        channel: "ch_random",
        body: "This channel is for the weird stuff. Go nuts.",
      },
      {
        channel: "ch_intros",
        body: "Drop a quick intro: name, city, what you're into. Helps the room feel alive.",
      },
    ];

    const insert = db.prepare(
      `INSERT INTO messages (id, channel_id, author_id, body, created_at, source)
       VALUES (?, ?, ?, ?, ?, 'system')`
    );
    welcome.forEach((msg, i) => {
      insert.run(`m_welcome_${i}`, msg.channel, botId, msg.body, Date.now() - (welcome.length - i) * 1000);
    });
  }
}

export function getReactionsForMessages(db, messageIds) {
  if (!messageIds || messageIds.length === 0) return new Map();
  const placeholders = messageIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT r.message_id AS messageId, r.emoji, r.person_id AS personId, p.display_name AS personName
       FROM reactions r
       JOIN people p ON p.id = r.person_id
       WHERE r.message_id IN (${placeholders})
       ORDER BY r.created_at ASC`
    )
    .all(...messageIds);

  const map = new Map();
  for (const id of messageIds) {
    map.set(id, []);
  }

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.messageId)) {
      grouped.set(row.messageId, new Map());
    }
    const emojiMap = grouped.get(row.messageId);
    if (!emojiMap.has(row.emoji)) {
      emojiMap.set(row.emoji, {
        emoji: row.emoji,
        count: 0,
        personIds: [],
        personNames: [],
      });
    }
    const g = emojiMap.get(row.emoji);
    g.count += 1;
    g.personIds.push(row.personId);
    g.personNames.push(row.personName);
  }

  for (const [msgId, emojiMap] of grouped.entries()) {
    map.set(msgId, Array.from(emojiMap.values()));
  }

  return map;
}

export function getReactionsForMessage(db, messageId) {
  const map = getReactionsForMessages(db, [messageId]);
  return map.get(messageId) || [];
}

export function markChannelRead(db, personId, channelId, timestamp = Date.now()) {
  if (!personId || !channelId) return;
  db.prepare(`
    INSERT INTO channel_reads (person_id, channel_id, last_read_at)
    VALUES (?, ?, ?)
    ON CONFLICT(person_id, channel_id) DO UPDATE SET last_read_at = excluded.last_read_at
  `).run(personId, channelId, timestamp);
}

export function getUnreadCounts(db, personId) {
  if (!personId) return {};
  const rows = db
    .prepare(`
      SELECT c.id AS channelId,
             COUNT(m.id) AS unreadCount
      FROM channels c
      LEFT JOIN channel_reads cr ON cr.channel_id = c.id AND cr.person_id = ?
      LEFT JOIN messages m ON m.channel_id = c.id
        AND m.author_id != ?
        AND m.deleted_at IS NULL
        AND m.legacy_enc = 0
        AND m.created_at > COALESCE(cr.last_read_at, 0)
      WHERE c.kind = 'lounge' OR (c.kind = 'dm' AND (c.dm_user1_id = ? OR c.dm_user2_id = ?))
      GROUP BY c.id
    `)
    .all(personId, personId, personId, personId);

  const counts = {};
  for (const r of rows) {
    if (r.unreadCount > 0) {
      counts[r.channelId] = r.unreadCount;
    }
  }
  return counts;
}

const ENCRYPTED_UPLOADS_DIR = path.join(__dirname, "..", "data", "encrypted_uploads");

export const MESSAGE_SELECT = `
  m.id, m.channel_id AS channelId, m.author_id AS authorId,
  m.body, m.created_at AS createdAt, m.source,
  m.attachment_id AS attachmentId, m.attachment_name AS attachmentName,
  m.attachment_type AS attachmentType, m.attachment_size AS attachmentSize,
  m.attachment_iv AS attachmentIv, m.parent_id AS parentId,
  m.info_hash AS infoHash,
  m.edited_at AS editedAt, m.deleted_at AS deletedAt, m.legacy_enc AS legacyEnc
`;

export function fetchMessage(db, id) {
  const row = db
    .prepare(
      `SELECT ${MESSAGE_SELECT},
              (SELECT COUNT(*) FROM messages r WHERE r.parent_id = m.id) AS replyCount,
              (SELECT MAX(created_at) FROM messages r WHERE r.parent_id = m.id) AS lastReplyAt,
              p.display_name AS authorName, p.color AS authorColor
       FROM messages m
       JOIN people p ON p.id = m.author_id
       WHERE m.id = ?`
    )
    .get(id);
  if (!row) return null;
  return { ...row, reactions: getReactionsForMessage(db, id) };
}

export function purgeEncryptedFile(db, fileId) {
  if (!fileId) return;
  const stillUsed = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE attachment_id = ?`).get(fileId).n;
  if (stillUsed > 0) return;
  const row = db.prepare(`SELECT file_path FROM encrypted_files WHERE id = ?`).get(fileId);
  if (!row) return;
  const paths = [row.file_path, path.join(ENCRYPTED_UPLOADS_DIR, `${fileId}.enc`), path.join(ENCRYPTED_UPLOADS_DIR, `${fileId}.torrent`)];
  for (const filePath of paths) {
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignore missing files
    }
  }
  db.prepare(`DELETE FROM encrypted_files WHERE id = ?`).run(fileId);
}
