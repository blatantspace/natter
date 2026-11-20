#!/usr/bin/env node
// Lists old test people in a Natter database, and can remove chosen ones.
//
//   Dry run (default, changes nothing):
//     node server/scripts/cleanup-test-people.js --db <path to natter.db>
//
//   Remove (needs all of these, and a backup folder you can write to):
//     node server/scripts/cleanup-test-people.js --db <path> --delete \
//       --ids id1,id2 --list-code <code from the dry run> --backup-dir <folder> \
//       [--move-messages-to <id>]
//
// The main account and the system account are never listed and never removed.
// A person with messages is skipped unless --move-messages-to says who gets them.
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const PROTECTED_IDS = new Set(["u_792346675", "u_natter"]);
const PROTECTED_NAMES = new Set(["ben", "natter"]);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { ids: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--delete") out.delete = true;
    else if (a === "--db") out.db = argv[++i];
    else if (a === "--ids") out.ids = String(argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--list-code") out.listCode = argv[++i];
    else if (a === "--backup-dir") out.backupDir = argv[++i];
    else if (a === "--move-messages-to") out.moveTo = argv[++i];
    else fail(`Unknown option: ${a}`);
  }
  return out;
}

function isProtected(p) {
  return PROTECTED_IDS.has(p.id) || PROTECTED_NAMES.has(String(p.display_name).trim().toLowerCase());
}

function whyCandidate(p) {
  const name = String(p.display_name).trim();
  const reasons = [];
  if (/test/i.test(name)) reasons.push("name says test");
  if (/^[a-z]+\.\d+$/i.test(name) || /^[a-z]\.\d*$/i.test(name)) reasons.push("name looks made up (letter and number)");
  if (/^ben\s*\S+$/i.test(name)) reasons.push("looks like a copy of the main account name");
  if (/\d$/.test(name) && !reasons.length) reasons.push("name ends in a number");
  if (!p.messages && !p.tokens) reasons.push("no messages and never signed in");
  return reasons.join("; ");
}

function listCandidates(db) {
  const rows = db
    .prepare(
      `SELECT p.id, p.display_name, p.last_seen,
              (SELECT count(*) FROM messages m WHERE m.author_id = p.id) AS messages,
              (SELECT count(*) FROM device_tokens d WHERE d.person_id = p.id) AS tokens
       FROM people p ORDER BY p.display_name`
    )
    .all();
  return rows
    .filter((p) => !isProtected(p))
    .map((p) => ({ ...p, why: whyCandidate(p) }))
    .filter((p) => p.why);
}

function listCode(ids) {
  return crypto.createHash("sha256").update([...ids].sort().join(",")).digest("hex").slice(0, 8);
}

const args = parseArgs(process.argv.slice(2));
if (!args.db) fail("Say which database with --db <path>. Nothing done.");

// Protected people can never be asked for, in any mode.
for (const id of args.ids) {
  if (PROTECTED_IDS.has(id)) fail("That is the main account. Not removing it.");
}

if (!fs.existsSync(args.db) || !fs.statSync(args.db).isFile()) {
  fail(`No database at ${args.db}. Nothing done.`);
}

let db;
try {
  db = new Database(args.db, { fileMustExist: true, readonly: !args.delete });
} catch (err) {
  fail(`Could not open ${args.db}: ${err.message}. Nothing done.`);
}

if (!args.delete) {
  const list = listCandidates(db);
  if (!list.length) console.log("No test people found.");
  for (const p of list) {
    console.log(`${p.id}\t${p.display_name}\t${p.messages} messages\t${p.tokens} tokens\t${p.why}`);
  }
  if (list.length) console.log(`List code: ${listCode(list.map((p) => p.id))} (all ${list.length} listed)`);
  console.log("Dry run. Nothing deleted.");
  db.close();
  process.exit(0);
}

// ---- delete mode ----
if (!args.ids.length) fail("Delete needs an exact list: --ids id1,id2. Nothing deleted.");
if (!args.listCode) fail("Delete needs --list-code from the dry run. Nothing deleted.");
if (!args.backupDir) fail("Delete needs --backup-dir <folder>. Nothing deleted.");

const rows = db.prepare(`SELECT id, display_name FROM people`).all();
const byId = new Map(rows.map((p) => [p.id, p]));
for (const id of args.ids) {
  const p = byId.get(id);
  if (!p) fail(`No person with id ${id}. Nothing deleted.`);
  if (isProtected(p)) fail("That is the main account. Not removing it.");
}
const candidateIds = new Set(listCandidates(db).map((p) => p.id));
for (const id of args.ids) {
  if (!candidateIds.has(id)) fail(`${id} is not on the test list. Nothing deleted.`);
}
if (listCode(args.ids) !== args.listCode) {
  fail("That list is not the one from the dry run. Run the dry run again and use its list code. Nothing deleted.");
}
if (args.moveTo) {
  if (args.ids.includes(args.moveTo)) fail("Messages cannot move to a person being removed. Nothing deleted.");
  if (!byId.has(args.moveTo)) fail(`No person with id ${args.moveTo} to move messages to. Nothing deleted.`);
}

// Backup folder must be writable before anything is touched.
try {
  fs.mkdirSync(args.backupDir, { recursive: true });
  fs.accessSync(args.backupDir, fs.constants.W_OK | fs.constants.X_OK);
  const probe = path.join(args.backupDir, `.write-test-${process.pid}`);
  fs.writeFileSync(probe, "x");
  fs.unlinkSync(probe);
} catch {
  fail(`Can't write the backup to ${args.backupDir}. Nothing deleted.`);
}

// Work out who can go. Someone with messages needs somewhere for them to move.
const toRemove = [];
const skipped = [];
for (const id of args.ids) {
  const msgs = db.prepare(`SELECT count(*) AS n FROM messages WHERE author_id = ?`).get(id).n;
  const files = db.prepare(`SELECT count(*) AS n FROM encrypted_files WHERE uploader_id = ?`).get(id).n;
  const dmMsgs = db
    .prepare(
      `SELECT count(*) AS n FROM messages WHERE channel_id IN
         (SELECT id FROM channels WHERE dm_user1_id = ? OR dm_user2_id = ?)`
    )
    .get(id, id).n;
  if ((msgs || files) && !args.moveTo) {
    skipped.push(`${id}: has ${msgs} messages and ${files} files, use --move-messages-to to keep them`);
  } else if (dmMsgs) {
    skipped.push(`${id}: is in a direct message with ${dmMsgs} messages, left alone`);
  } else {
    toRemove.push(id);
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupFile = path.join(args.backupDir, `natter-backup-${stamp}.db`);
try {
  db.exec(`VACUUM INTO '${backupFile.replace(/'/g, "''")}'`);
} catch (err) {
  fail(`Can't write the backup to ${args.backupDir}: ${err.message}. Nothing deleted.`);
}
console.log(`Backup written: ${backupFile}`);

const run = db.transaction(() => {
  for (const id of toRemove) {
    if (args.moveTo) {
      db.prepare(`UPDATE messages SET author_id = ? WHERE author_id = ?`).run(args.moveTo, id);
      db.prepare(`UPDATE encrypted_files SET uploader_id = ? WHERE uploader_id = ?`).run(args.moveTo, id);
    }
    db.prepare(`DELETE FROM channels WHERE dm_user1_id = ? OR dm_user2_id = ?`).run(id, id);
    db.prepare(`DELETE FROM device_tokens WHERE person_id = ?`).run(id);
    db.prepare(`DELETE FROM channel_reads WHERE person_id = ?`).run(id);
    db.prepare(`DELETE FROM reactions WHERE person_id = ?`).run(id);
    db.prepare(`DELETE FROM people WHERE id = ?`).run(id);
  }
});
run();
for (const id of toRemove) console.log(`Removed ${id} (${byId.get(id).display_name})`);
for (const s of skipped) console.log(`Skipped ${s}`);
const bad = db.prepare(`PRAGMA foreign_key_check`).all();
if (bad.length) console.error(`Warning: ${bad.length} rows point at something missing.`);
console.log(`Done. Removed ${toRemove.length}, skipped ${skipped.length}.`);
db.close();
