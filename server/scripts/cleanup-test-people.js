#!/usr/bin/env node
// Lists old test people in a Natter database, and can remove chosen ones.
//
//   Dry run (default, changes nothing):
//     node server/scripts/cleanup-test-people.js --db <path to natter.db>
//
//   Remove (needs all of these, and a backup folder you can write to):
//     node server/scripts/cleanup-test-people.js --db <path> --delete \
//       --ids id1,id2 --list-code <code from the dry run> --backup-dir <folder> \
//       [--move-messages-to <id>] [--delete-own-messages] [--delete-dm-messages]
//
// What happens to a person's words (nothing is ever filed under anyone by default):
//   --move-messages-to <id>   their messages and files go to that person
//   --delete-own-messages     their messages and file records are deleted
//   --delete-dm-messages      each direct message they are in is deleted, with every
//                             message in it (other people's too), then the chat itself
//   The dry run says exactly whose messages would go. Use --ids in the dry run to preview
//   one group, plus the two flags to see what they would do.

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
    else if (a === "--delete-own-messages") out.deleteOwn = true;
    else if (a === "--delete-dm-messages") out.deleteDm = true;
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

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// Works out what would happen to one person. Changes nothing.
function planFor(db, id, args, names) {
  const own = db.prepare(`SELECT id FROM messages WHERE author_id = ?`).all(id).map((r) => r.id);
  const files = db.prepare(`SELECT count(*) AS n FROM encrypted_files WHERE uploader_id = ?`).get(id).n;
  const dms = db
    .prepare(`SELECT id FROM channels WHERE dm_user1_id = ? OR dm_user2_id = ?`)
    .all(id, id)
    .map((r) => r.id);
  const dmMsgs = dms.length
    ? db
        .prepare(`SELECT id, author_id FROM messages WHERE channel_id IN (${dms.map(() => "?").join(",")})`)
        .all(...dms)
    : [];
  const dmCount = dmMsgs.length;
  const others = new Map(); // author name -> count, other people's messages that would go with the DMs
  for (const m of dmMsgs) {
    if (m.author_id === id) continue;
    const n = names.get(m.author_id) || m.author_id;
    others.set(n, (others.get(n) || 0) + 1);
  }
  const problems = [];
  if (args.deleteOwn && args.moveTo) problems.push("--delete-own-messages and --move-messages-to cannot be used together");
  if ((own.length || files) && !args.moveTo && !args.deleteOwn) {
    problems.push(`has ${plural(own.length, "message")} and ${plural(files, "file")}, use --move-messages-to or --delete-own-messages`);
  }
  if (dmCount && !args.deleteDm) {
    problems.push(`is in direct messages with ${plural(dmCount, "message")}, use --delete-dm-messages`);
  }
  return { id, own, files, dms, dmMsgs, dmCount, others, problems };
}

function describePlan(plan, name) {
  const lines = [];
  lines.push(`  ${plan.id} (${name})`);
  if (plan.problems.length) lines.push(`    would be skipped: ${plan.problems.join("; ")}`);
  else lines.push("    would be removed");
  lines.push(`    own messages: ${plan.own.length}, file records: ${plan.files}`);
  lines.push(`    direct messages: ${plan.dms.length}, messages in them: ${plan.dmCount}`);
  if (plan.others.size) {
    const list = [...plan.others].map(([n, c]) => `${n} ${c}`).join(", ");
    lines.push(`    other people's messages that go with the direct messages: ${list}`);
  } else {
    lines.push("    other people's messages that go with the direct messages: none");
  }
  return lines;
}

const args = parseArgs(process.argv.slice(2));
if (!args.db) fail("Say which database with --db <path>. Nothing done.");
if (args.deleteOwn && args.moveTo) fail("Pick one, --delete-own-messages or --move-messages-to, not both. Nothing done.");
if ((args.deleteOwn || args.deleteDm) && !args.delete) {
  // Allowed in a dry run, so the preview can show what the flags would do.
}

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
db.pragma("foreign_keys = ON");
const allPeople = db.prepare(`SELECT id, display_name FROM people`).all();
const byId = new Map(allPeople.map((p) => [p.id, p]));
const names = new Map(allPeople.map((p) => [p.id, p.display_name]));

if (!args.delete) {
  const list = listCandidates(db);
  if (!list.length) console.log("No test people found.");
  for (const p of list) {
    console.log(`${p.id}\t${p.display_name}\t${p.messages} messages\t${p.tokens} tokens\t${p.why}`);
  }
  if (list.length) console.log(`List code: ${listCode(list.map((p) => p.id))} (all ${list.length} listed)`);
  const listedIds = new Set(list.map((p) => p.id));
  for (const id of args.ids) {
    if (!byId.has(id)) fail(`No person with id ${id}. Nothing done.`);
    if (!listedIds.has(id)) fail(`${id} is not on the test list. Nothing done.`);
  }
  const preview = args.ids.length ? args.ids : list.map((p) => p.id);
  if (preview.length && (args.ids.length || args.deleteOwn || args.deleteDm || args.moveTo)) {
    console.log("");
    console.log("What a delete with these choices would do:");
    for (const id of preview) for (const l of describePlan(planFor(db, id, args, names), names.get(id))) console.log(l);
  }
  console.log("Dry run. Nothing deleted.");
  db.close();
  process.exit(0);
}

// ---- delete mode ----
if (!args.ids.length) fail("Delete needs an exact list: --ids id1,id2. Nothing deleted.");
if (!args.listCode) fail("Delete needs --list-code from the dry run. Nothing deleted.");
if (!args.backupDir) fail("Delete needs --backup-dir <folder>. Nothing deleted.");

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

// Work out who can go.
const plans = args.ids.map((id) => planFor(db, id, args, names));
const toRemove = plans.filter((p) => !p.problems.length);
const skipped = plans.filter((p) => p.problems.length);

// Back up first, unless there is nothing to remove.
if (toRemove.length) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(args.backupDir, `natter-backup-${stamp}.db`);
  try {
    db.exec(`VACUUM INTO '${backupFile.replace(/'/g, "''")}'`);
  } catch (err) {
    fail(`Can't write the backup to ${args.backupDir}: ${err.message}. Nothing deleted.`);
  }
  console.log(`Backup written: ${backupFile}`);
} else {
  console.log("Nothing to remove, so no backup was made.");
}

// One transaction for everything. If any step fails, nothing changes.
const run = db.transaction(() => {
  for (const plan of toRemove) {
    const id = plan.id;
    // Direct messages first: every message in them, then the chat.
    for (const ch of plan.dms) {
      db.prepare(`DELETE FROM messages WHERE channel_id = ?`).run(ch);
      db.prepare(`DELETE FROM channels WHERE id = ?`).run(ch);
    }
    if (args.moveTo) {
      db.prepare(`UPDATE messages SET author_id = ? WHERE author_id = ?`).run(args.moveTo, id);
      db.prepare(`UPDATE encrypted_files SET uploader_id = ? WHERE uploader_id = ?`).run(args.moveTo, id);
    } else if (args.deleteOwn) {
      db.prepare(`DELETE FROM messages WHERE author_id = ?`).run(id);
      db.prepare(`DELETE FROM encrypted_files WHERE uploader_id = ?`).run(id);
    }
    db.prepare(`DELETE FROM device_tokens WHERE person_id = ?`).run(id);
    db.prepare(`DELETE FROM channel_reads WHERE person_id = ?`).run(id);
    db.prepare(`DELETE FROM reactions WHERE person_id = ?`).run(id);
    db.prepare(`DELETE FROM people WHERE id = ?`).run(id);
  }
  // A reply whose first message is gone becomes a plain message.
  if (toRemove.length) {
    db.prepare(`UPDATE messages SET parent_id = NULL WHERE parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM messages)`).run();
  }
  const bad = db.prepare(`PRAGMA foreign_key_check`).all();
  if (bad.length) throw new Error(`${bad.length} rows would point at something missing`);
});
try {
  run();
} catch (err) {
  fail(`Stopped, nothing was changed: ${err.message}.`);
}
for (const p of toRemove) {
  const gone = [...p.others].map(([n, c]) => `${n} ${c}`).join(", ");
  console.log(`Removed ${p.id} (${byId.get(p.id).display_name})${gone ? `, with other people's messages: ${gone}` : ""}`);
}
for (const p of skipped) console.log(`Skipped ${p.id}: ${p.problems.join("; ")}`);
console.log(`Done. Removed ${toRemove.length}, skipped ${skipped.length}.`);
db.close();
