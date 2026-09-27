import { nanoid } from "nanoid";
import { getReactionsForMessage, markChannelRead, getUnreadCounts, fetchMessage, purgeEncryptedFile } from "./db.js";

export function attachRealtime({ wss, db, onReady }) {
  const clients = new Map();
  const swarm = new Map();

  function swarmSnapshot() {
    const byHash = {};
    for (const [hash, peers] of swarm.entries()) {
      byHash[hash] = [...peers.values()];
    }
    return byHash;
  }

  function broadcastSwarm() {
    broadcast({ type: "swarm.snapshot", swarm: swarmSnapshot() });
  }

  function setSwarmPeer(infoHash, person, { role, progress, fileId }) {
    const hash = String(infoHash || "").toLowerCase();
    if (!hash || !person?.id) return;
    if (!swarm.has(hash)) swarm.set(hash, new Map());
    swarm.get(hash).set(person.id, {
      personId: person.id,
      displayName: person.displayName,
      color: person.color,
      role: role === "leech" ? "leech" : "seed",
      progress: Math.max(0, Math.min(1, Number(progress) || 0)),
      fileId: fileId || null,
      updatedAt: Date.now(),
    });
  }

  function removeSwarmPeer(infoHash, personId) {
    const hash = String(infoHash || "").toLowerCase();
    const peers = swarm.get(hash);
    if (!peers) return;
    peers.delete(personId);
    if (peers.size === 0) swarm.delete(hash);
  }

  function removePersonFromSwarm(personId) {
    for (const [hash, peers] of swarm.entries()) {
      peers.delete(personId);
      if (peers.size === 0) swarm.delete(hash);
    }
  }

  function broadcast(payload, except) {
    const data = JSON.stringify(payload);
    for (const [ws] of clients.entries()) {
      if (ws === except) continue;
      if (ws.readyState === 1) ws.send(data);
    }
  }

  function send(ws, payload) {
    if (ws.readyState === 1) ws.send(JSON.stringify(payload));
  }

  function presenceList() {
    const online = [];
    for (const meta of clients.values()) {
      if (meta.person) online.push(meta.person);
    }
    const seen = new Set();
    return online.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }

  function postMessage({
    channelId,
    authorId,
    body,
    source = "lounge",
    attachment = null,
    parentId = null,
  }) {
    const trimmed = String(body || "").trim().slice(0, 32000);
    if (!trimmed && !attachment?.id && !attachment?.infoHash) throw new Error("Empty message");
    const channel = db.prepare(`SELECT id, kind FROM channels WHERE id = ?`).get(channelId);
    if (!channel) throw new Error("Unknown channel");
    const person = db
      .prepare(
        `SELECT id, display_name AS displayName, color FROM people WHERE id = ?`
      )
      .get(authorId);
    if (!person) throw new Error("Unknown person");

    if (parentId) {
      const parent = db.prepare(`SELECT id FROM messages WHERE id = ? AND channel_id = ?`).get(parentId, channelId);
      if (!parent) throw new Error("Parent message not found");
    }

    const id = `m_${nanoid(12)}`;
    const createdAt = Date.now();
    db.prepare(
      `INSERT INTO messages (
        id, channel_id, author_id, body, created_at, source,
        attachment_id, attachment_name, attachment_type, attachment_size, attachment_iv,
        parent_id, info_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      channelId,
      authorId,
      trimmed,
      createdAt,
      source,
      attachment?.id || null,
      attachment?.name || null,
      attachment?.type || null,
      attachment?.size || null,
      attachment?.iv || null,
      parentId || null,
      attachment?.infoHash || null
    );

    db.prepare(`UPDATE people SET last_seen = ? WHERE id = ?`).run(createdAt, authorId);
    markChannelRead(db, authorId, channelId, createdAt);

    const message = {
      id,
      channelId,
      authorId,
      authorName: person.displayName,
      authorColor: person.color,
      body: trimmed,
      createdAt,
      source,
      parentId: parentId || null,
      replyCount: 0,
      lastReplyAt: null,
      reactions: [],
      attachmentId: attachment?.id || null,
      attachmentName: attachment?.name || null,
      attachmentType: attachment?.type || null,
      attachmentSize: attachment?.size || null,
      attachmentIv: attachment?.iv || null,
      infoHash: attachment?.infoHash || null,
      editedAt: null,
      deletedAt: null,
    };

    broadcast({ type: "message.created", message });

    if (parentId) {
      const stats = db
        .prepare(
          `SELECT COUNT(*) AS replyCount, MAX(created_at) AS lastReplyAt
           FROM messages WHERE parent_id = ?`
        )
        .get(parentId);

      broadcast({
        type: "thread.updated",
        parentId,
        channelId,
        replyCount: stats.replyCount,
        lastReplyAt: stats.lastReplyAt,
      });
    }

    return message;
  }

  wss.on("connection", (ws) => {
    clients.set(ws, { person: null });
    send(ws, { type: "hello", online: presenceList() });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === "identify") {
        const person = db
          .prepare(
            `SELECT id, display_name AS displayName, color, last_seen AS lastSeen
             FROM people WHERE id = ?`
          )
          .get(msg.personId);
        if (!person) {
          send(ws, { type: "error", error: "Unknown person. Sign in again." });
          return;
        }
        db.prepare(`UPDATE people SET last_seen = ? WHERE id = ?`).run(Date.now(), person.id);
        clients.set(ws, { person });
        const unreadCounts = getUnreadCounts(db, person.id);
        broadcast({ type: "presence", online: presenceList() });
        send(ws, {
          type: "identified",
          person,
          online: presenceList(),
          unreadCounts,
          swarm: swarmSnapshot(),
        });
        return;
      }

      if (msg.type === "swarm.update") {
        const meta = clients.get(ws);
        if (!meta?.person || !msg.infoHash) return;
        setSwarmPeer(msg.infoHash, meta.person, {
          role: msg.role,
          progress: msg.progress,
          fileId: msg.fileId,
        });
        broadcastSwarm();
        return;
      }

      if (msg.type === "swarm.leave") {
        const meta = clients.get(ws);
        if (!meta?.person || !msg.infoHash) return;
        removeSwarmPeer(msg.infoHash, meta.person.id);
        broadcastSwarm();
        return;
      }

      if (msg.type === "swarm.clear") {
        const meta = clients.get(ws);
        if (!meta?.person) return;
        removePersonFromSwarm(meta.person.id);
        broadcastSwarm();
        return;
      }

      if (msg.type === "channel.read") {
        const meta = clients.get(ws);
        if (!meta?.person || !msg.channelId) return;
        markChannelRead(db, meta.person.id, msg.channelId, Date.now());
        const unreadCounts = getUnreadCounts(db, meta.person.id);
        send(ws, { type: "unread.updated", unreadCounts });
        return;
      }

      if (msg.type === "message.send") {
        const meta = clients.get(ws);
        if (!meta?.person) {
          send(ws, { type: "error", error: "Identify before chatting." });
          return;
        }
        try {
          postMessage({
            channelId: msg.channelId,
            authorId: meta.person.id,
            body: msg.body,
            source: "lounge",
            attachment: msg.attachment || null,
            parentId: msg.parentId || null,
          });
        } catch (err) {
          send(ws, {
            type: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (msg.type === "message.edit") {
        const meta = clients.get(ws);
        if (!meta?.person) {
          send(ws, { type: "error", error: "Identify before chatting." });
          return;
        }
        try {
          const messageId = String(msg.messageId || "");
          const trimmed = String(msg.body || "").trim().slice(0, 32000);
          if (!messageId || !trimmed) throw new Error("Empty edit");
          const existing = db
            .prepare(
              `SELECT id, author_id AS authorId, deleted_at AS deletedAt FROM messages WHERE id = ?`
            )
            .get(messageId);
          if (!existing) throw new Error("Message not found");
          if (existing.authorId !== meta.person.id) throw new Error("You can only edit your own messages");
          if (existing.deletedAt) throw new Error("Can't edit a deleted message");
          const editedAt = Date.now();
          db.prepare(`UPDATE messages SET body = ?, edited_at = ? WHERE id = ?`).run(trimmed, editedAt, messageId);
          const message = fetchMessage(db, messageId);
          if (message) broadcast({ type: "message.updated", message });
        } catch (err) {
          send(ws, {
            type: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (msg.type === "message.delete") {
        const meta = clients.get(ws);
        if (!meta?.person) {
          send(ws, { type: "error", error: "Identify before chatting." });
          return;
        }
        try {
          const messageId = String(msg.messageId || "");
          const existing = db
            .prepare(
              `SELECT id, author_id AS authorId, deleted_at AS deletedAt, attachment_id AS attachmentId
               FROM messages WHERE id = ?`
            )
            .get(messageId);
          if (!existing) throw new Error("Message not found");
          if (existing.authorId !== meta.person.id) throw new Error("You can only delete your own messages");
          if (existing.deletedAt) return;
          const deletedAt = Date.now();
          db.prepare(
            `UPDATE messages SET
               body = '',
               deleted_at = ?,
               attachment_id = NULL,
               attachment_name = NULL,
               attachment_type = NULL,
               attachment_size = NULL,
               attachment_iv = NULL,
               info_hash = NULL
             WHERE id = ?`
          ).run(deletedAt, messageId);
          if (existing.attachmentId) purgeEncryptedFile(db, existing.attachmentId);
          const message = fetchMessage(db, messageId);
          if (message) broadcast({ type: "message.deleted", message });
        } catch (err) {
          send(ws, {
            type: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (msg.type === "reaction.toggle") {
        const meta = clients.get(ws);
        if (!meta?.person) return;
        const { messageId, emoji } = msg;
        if (!messageId || !emoji) return;

        const existing = db
          .prepare(
            `SELECT id FROM reactions WHERE message_id = ? AND person_id = ? AND emoji = ?`
          )
          .get(messageId, meta.person.id, emoji);

        if (existing) {
          db.prepare(`DELETE FROM reactions WHERE id = ?`).run(existing.id);
        } else {
          const id = `r_${nanoid(12)}`;
          db.prepare(
            `INSERT INTO reactions (id, message_id, person_id, emoji, created_at)
             VALUES (?, ?, ?, ?, ?)`
          ).run(id, messageId, meta.person.id, emoji, Date.now());
        }

        const reactions = getReactionsForMessage(db, messageId);
        const targetMsg = db
          .prepare(`SELECT channel_id AS channelId, parent_id AS parentId FROM messages WHERE id = ?`)
          .get(messageId);

        if (targetMsg) {
          broadcast({
            type: "reaction.updated",
            messageId,
            channelId: targetMsg.channelId,
            parentId: targetMsg.parentId,
            reactions,
          });
        }
        return;
      }

      if (msg.type === "typing") {
        const meta = clients.get(ws);
        if (!meta?.person) return;
        broadcast(
          {
            type: "typing",
            channelId: msg.channelId,
            parentId: msg.parentId || null,
            person: meta.person,
          },
          ws
        );
      }
    });

    ws.on("close", () => {
      const meta = clients.get(ws);
      clients.delete(ws);
      if (meta?.person) {
        removePersonFromSwarm(meta.person.id);
        broadcastSwarm();
      }
      broadcast({ type: "presence", online: presenceList() });
    });
  });

  onReady(broadcast);
  return { broadcast, postMessage, presenceList };
}
