import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

export function openDb({ rootDir, dataDirOverride }) {
  const dataDir = dataDirOverride ? String(dataDirOverride) : join(rootDir, "data");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "app.sqlite");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY,
      pass_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      room TEXT NOT NULL,
      type TEXT NOT NULL,
      caption TEXT,
      text TEXT,
      url TEXT,
      mime TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(room) REFERENCES rooms(code) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memories_room_created ON memories(room, created_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room TEXT NOT NULL,
      author TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(room) REFERENCES rooms(code) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room, created_at DESC);
  `);

  return db;
}

export function tryMigrateFromJson({ rootDir, db, bcryptHashForRoom, dataDirOverride }) {
  const dataDir = dataDirOverride ? String(dataDirOverride) : join(rootDir, "data");
  const storePath = join(dataDir, "store.json");
  if (!existsSync(storePath)) return { migrated: false, reason: "no_store_json" };

  const hasAny = db.prepare("SELECT 1 FROM memories LIMIT 1").get() || db.prepare("SELECT 1 FROM messages LIMIT 1").get();
  if (hasAny) return { migrated: false, reason: "db_not_empty" };

  let store;
  try {
    store = JSON.parse(readFileSync(storePath, "utf8"));
  } catch {
    return { migrated: false, reason: "bad_store_json" };
  }

  const memoriesByRoom = store?.memoriesByRoom || {};
  const messagesByRoom = store?.messagesByRoom || {};

  const insertRoom = db.prepare("INSERT OR IGNORE INTO rooms(code, pass_hash, created_at) VALUES(?, ?, ?)");
  const insertMemory = db.prepare(
    "INSERT OR REPLACE INTO memories(id, room, type, caption, text, url, mime, created_at) VALUES(@id, @room, @type, @caption, @text, @url, @mime, @created_at)"
  );
  const insertMessage = db.prepare(
    "INSERT OR REPLACE INTO messages(id, room, author, text, created_at) VALUES(@id, @room, @author, @text, @created_at)"
  );

  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    for (const [room, list] of Object.entries(memoriesByRoom)) {
      const hash = bcryptHashForRoom(room);
      insertRoom.run(room, hash, now);
      for (const m of Array.isArray(list) ? list : []) {
        insertMemory.run({
          id: String(m.id),
          room,
          type: String(m.type),
          caption: m.caption ?? null,
          text: m.text ?? null,
          url: m.url ?? null,
          mime: m.mime ?? null,
          created_at: m.createdAt || now,
        });
      }
    }

    for (const [room, list] of Object.entries(messagesByRoom)) {
      const hash = bcryptHashForRoom(room);
      insertRoom.run(room, hash, now);
      for (const msg of Array.isArray(list) ? list : []) {
        insertMessage.run({
          id: String(msg.id),
          room,
          author: String(msg.author || "Bạn").slice(0, 40),
          text: String(msg.text || "").slice(0, 2000),
          created_at: msg.createdAt || now,
        });
      }
    }
  });

  tx();

  // Lưu bản sao để tham chiếu, nhưng vẫn giữ store.json (phòng khi cần rollback)
  const backupPath = join(dataDir, "store.migrated.json");
  try {
    writeFileSync(backupPath, JSON.stringify(store, null, 2), "utf8");
  } catch {
    // ignore
  }

  // Đổi tên store.json -> store.legacy.json để tránh hiểu nhầm đang còn dùng JSON
  try {
    const legacyPath = join(dataDir, "store.legacy.json");
    renameSync(storePath, legacyPath);
  } catch {
    // ignore
  }

  return { migrated: true, reason: "ok" };
}
