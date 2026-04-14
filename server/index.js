import express from "express";
import cors from "cors";
import multer from "multer";
import { createServer } from "http";
import { Server } from "socket.io";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import { dirname, extname, join } from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { openDb, tryMigrateFromJson } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dataDir = process.env.DATA_DIR ? String(process.env.DATA_DIR) : join(root, "data");
const uploadsDir = process.env.UPLOADS_DIR ? String(process.env.UPLOADS_DIR) : join(root, "uploads");

if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

const db = openDb({ rootDir: root, dataDirOverride: dataDir });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = (extname(file.originalname) || "").slice(0, 16) || ".bin";
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype?.startsWith("image/") || file.mimetype?.startsWith("video/");
    cb(ok ? null : new Error("Chỉ cho phép upload ảnh hoặc video"), ok);
  },
});
const uploadMemory = upload.fields([{ name: "file", maxCount: 1 }]);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true } });

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(uploadsDir));
app.use(express.static(join(root, "public")));

function roomKey(code) {
  return String(code || "").trim().toLowerCase() || "default";
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

function getRoomPass(req) {
  return String(req.header("x-room-pass") || req.query.pass || req.body?.pass || "").trim();
}

function ensureRoomPassword(pass) {
  const p = String(pass || "").trim();
  if (p.length < 4) {
    const err = new Error("Mật khẩu phòng cần ít nhất 4 ký tự");
    err.status = 400;
    throw err;
  }
  return p.slice(0, 64);
}

function getOrCreateRoom({ code, pass }) {
  const row = db.prepare("SELECT code, pass_hash FROM rooms WHERE code = ?").get(code);
  if (!row) {
    const password = ensureRoomPassword(pass);
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("INSERT INTO rooms(code, pass_hash, created_at) VALUES(?, ?, ?)").run(code, hash, new Date().toISOString());
    return { code, isNew: true };
  }
  if (!bcrypt.compareSync(String(pass || ""), row.pass_hash)) {
    const err = new Error("Sai mật khẩu phòng");
    err.status = 401;
    throw err;
  }
  return { code, isNew: false };
}

function requireRoomAuth(req, _res, next) {
  try {
    const code = roomKey(req.query.room || req.body?.room);
    const pass = getRoomPass(req);
    getOrCreateRoom({ code, pass });
    req.room = code;
    next();
  } catch (e) {
    next(e);
  }
}

app.get("/api/memories", requireRoomAuth, (req, res) => {
  const code = req.room;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 80));
  const before = String(req.query.before || "").trim();
  const beforeIso = before && /^\d{4}-\d{2}-\d{2}T/.test(before) ? before : null;

  const typeRaw = String(req.query.type || "").trim().toLowerCase(); // "", "text", "media", "image,video"
  let types = [];
  if (typeRaw === "media") types = ["image", "video"];
  else if (typeRaw) types = typeRaw.split(",").map((s) => s.trim()).filter(Boolean);

  const where = ["room = ?"];
  const params = [code];
  if (types.length) {
    where.push(`type IN (${types.map(() => "?").join(",")})`);
    params.push(...types);
  }
  if (beforeIso) {
    where.push("created_at < ?");
    params.push(beforeIso);
  }

  const sql = `SELECT id, type, caption, text, url, mime, created_at as createdAt
               FROM memories
               WHERE ${where.join(" AND ")}
               ORDER BY created_at DESC
               LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

app.post("/api/memories", uploadMemory, requireRoomAuth, (req, res, next) => {
  try {
    const code = req.room;
    const type = req.body.type === "video" ? "video" : req.body.type === "text" ? "text" : "image";
    const file = req.files?.file?.[0];

    const payload = {
      id: uuidv4(),
      room: code,
      type,
      caption: (req.body.caption || "").slice(0, 500) || null,
      text: null,
      url: null,
      mime: null,
      createdAt: new Date().toISOString(),
    };

    if (type === "text") {
      payload.text = (req.body.text || "").trim().slice(0, 2000);
      if (!payload.text) {
        return res.status(400).json({ error: "Lời nhắn đang trống" });
      }
    } else if (file) {
      payload.url = `/uploads/${file.filename}`;
      payload.mime = file.mimetype;
    } else {
      return res.status(400).json({ error: "Thiếu file hoặc nội dung" });
    }

    db.prepare(
      "INSERT INTO memories(id, room, type, caption, text, url, mime, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(payload.id, payload.room, payload.type, payload.caption, payload.text, payload.url, payload.mime, payload.createdAt);

    res.json({
      id: payload.id,
      type: payload.type,
      caption: payload.caption || "",
      text: payload.text || undefined,
      url: payload.url || undefined,
      mime: payload.mime || undefined,
      createdAt: payload.createdAt,
    });
  } catch (e) {
    next(e);
  }
});

app.delete("/api/memories/:id", requireRoomAuth, (req, res) => {
  const code = req.room;
  const id = String(req.params.id);
  const row = db.prepare("SELECT id, type, url FROM memories WHERE id = ? AND room = ?").get(id, code);
  if (!row) return res.status(404).json({ error: "Không tìm thấy" });

  db.prepare("DELETE FROM memories WHERE id = ? AND room = ?").run(id, code);

  if ((row.type === "image" || row.type === "video") && typeof row.url === "string" && row.url.startsWith("/uploads/")) {
    const filename = row.url.replace("/uploads/", "");
    const full = join(uploadsDir, filename);
    try {
      if (existsSync(full)) unlinkSync(full);
    } catch {
      // ignore
    }
  }

  res.json({ ok: true });
});

app.get("/api/chat", requireRoomAuth, (req, res) => {
  const code = req.room;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const before = String(req.query.before || "").trim();
  const beforeIso = before && /^\d{4}-\d{2}-\d{2}T/.test(before) ? before : null;

  const rows = beforeIso
    ? db
        .prepare(
          "SELECT id, author, text, created_at as createdAt FROM messages WHERE room = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?"
        )
        .all(code, beforeIso, limit)
        .reverse()
    : db
        .prepare("SELECT id, author, text, created_at as createdAt FROM messages WHERE room = ? ORDER BY created_at DESC LIMIT ?")
        .all(code, limit)
        .reverse();
  res.json(rows);
});

io.on("connection", (socket) => {
  socket.on("join", (payload) => {
    try {
      const key = roomKey(payload?.room);
      const pass = String(payload?.pass || "").trim();
      getOrCreateRoom({ code: key, pass });
      socket.data.room = key;
      socket.join(key);
      socket.emit("joined", { room: key });
    } catch (e) {
      socket.emit("auth_error", { error: e.message || "Không vào được phòng" });
    }
  });

  socket.on("chat", (payload) => {
    try {
      const key = roomKey(payload?.room);
      const pass = String(payload?.pass || "").trim();
      getOrCreateRoom({ code: key, pass });

      const author = String(payload?.author || "Bạn").slice(0, 40);
      const text = String(payload?.text || "").trim().slice(0, 2000);
      if (!text) return;

      const msg = {
        id: uuidv4(),
        room: key,
        author,
        text,
        createdAt: new Date().toISOString(),
      };

      db.prepare("INSERT INTO messages(id, room, author, text, created_at) VALUES(?, ?, ?, ?, ?)").run(
        msg.id,
        msg.room,
        msg.author,
        msg.text,
        msg.createdAt
      );

      const count = db.prepare("SELECT COUNT(1) as c FROM messages WHERE room = ?").get(key)?.c || 0;
      const max = 500;
      if (count > max) {
        const toDelete = count - max;
        db.prepare(
          `DELETE FROM messages
           WHERE id IN (
             SELECT id FROM messages WHERE room = ? ORDER BY created_at ASC LIMIT ?
           )`
        ).run(key, toDelete);
      }

      io.to(key).emit("chat", { id: msg.id, author: msg.author, text: msg.text, createdAt: msg.createdAt });
    } catch (e) {
      socket.emit("auth_error", { error: e.message || "Gửi tin nhắn thất bại" });
    }
  });
});

const PORT = Number(process.env.PORT) || 3000;
httpServer.listen(PORT, () => {
  // migrate legacy JSON -> SQLite (one time)
  tryMigrateFromJson({
    rootDir: root,
    db,
    bcryptHashForRoom: (room) => bcrypt.hashSync(`legacy:${room}`, 10),
    dataDirOverride: dataDir,
  });
  console.log(`Couple Memories: http://localhost:${PORT}`);
});

app.use((err, _req, res, _next) => {
  const status = Number(err?.status) || 500;
  res.status(status).json({ error: err?.message || "Lỗi máy chủ" });
});
