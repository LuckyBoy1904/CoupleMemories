const $ = (id) => document.getElementById(id);

const gate = $("gate");
const app = $("app");
const gateError = $("gateError");
const roomInput = $("roomCode");
const nameInput = $("displayName");
const passInput = $("roomPass");
const enterBtn = $("enterBtn");
const leaveBtn = $("leaveBtn");
const roomLabel = $("roomLabel");

const tabs = document.querySelectorAll(".tab");
const panels = {
  memories: $("panel-memories"),
  notes: $("panel-notes"),
  chat: $("panel-chat"),
};

const memoriesGrid = $("memoriesGrid");
const memoriesEmpty = $("memoriesEmpty");
const mediaInput = $("mediaInput");
const mediaCaption = $("mediaCaption");
const memSearch = $("memSearch");
const memSort = $("memSort");
const memTypeButtons = document.querySelectorAll("[data-filter-type]");

const noteForm = $("noteForm");
const noteText = $("noteText");
const notesList = $("notesList");
const noteSearch = $("noteSearch");
const noteSort = $("noteSort");

const chatMessages = $("chatMessages");
const chatForm = $("chatForm");
const chatInput = $("chatInput");
const chatSearch = $("chatSearch");

let room = "";
let author = "";
let pass = "";
let socket = null;
let lastMemories = [];
let lastMessages = [];

const filters = {
  mem: { type: "all", q: "", sort: "desc" },
  note: { q: "", sort: "desc" },
  chat: { q: "" },
};

const STORAGE_KEY = "coupleMemories_prefs";

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const j = JSON.parse(raw);
    if (j.room) roomInput.value = j.room;
    if (j.author) nameInput.value = j.author;
    if (j.pass) passInput.value = j.pass;
  } catch {
    /* ignore */
  }
}

function savePrefs() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ room: roomInput.value.trim(), author: nameInput.value.trim(), pass: passInput.value })
  );
}

function showGateError(msg) {
  gateError.textContent = msg;
  gateError.hidden = !msg;
}

async function api(path, opts = {}) {
  const url = path.includes("?") ? `${path}&room=${encodeURIComponent(room)}` : `${path}?room=${encodeURIComponent(room)}`;
  const headers = new Headers(opts.headers || {});
  headers.set("X-Room-Pass", pass);
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function normalize(s) {
  return String(s || "").toLowerCase();
}

function applyMemFilters(list) {
  let out = Array.isArray(list) ? list.slice() : [];
  const q = normalize(filters.mem.q).trim();
  const type = filters.mem.type;
  out = out.filter((m) => m.type === "image" || m.type === "video");
  if (type !== "all") out = out.filter((m) => m.type === type);
  if (q) out = out.filter((m) => normalize(m.caption).includes(q));
  out.sort((a, b) => {
    const da = new Date(a.createdAt).getTime();
    const db = new Date(b.createdAt).getTime();
    return filters.mem.sort === "asc" ? da - db : db - da;
  });
  return out;
}

function applyNoteFilters(list) {
  let out = Array.isArray(list) ? list.slice() : [];
  const q = normalize(filters.note.q).trim();
  out = out.filter((m) => m.type === "text");
  if (q) out = out.filter((m) => normalize(m.text).includes(q));
  out.sort((a, b) => {
    const da = new Date(a.createdAt).getTime();
    const db = new Date(b.createdAt).getTime();
    return filters.note.sort === "asc" ? da - db : db - da;
  });
  return out;
}

function applyChatFilters(list) {
  let out = Array.isArray(list) ? list.slice() : [];
  const q = normalize(filters.chat.q).trim();
  if (q) out = out.filter((m) => normalize(m.author).includes(q) || normalize(m.text).includes(q));
  return out;
}

function setTab(name) {
  tabs.forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  Object.entries(panels).forEach(([key, el]) => {
    const on = key === name;
    el.classList.toggle("active", on);
    el.hidden = !on;
  });
}

tabs.forEach((t) => {
  t.addEventListener("click", () => setTab(t.dataset.tab));
});

function renderMemories(list) {
  memoriesGrid.innerHTML = "";
  const media = applyMemFilters(list);
  memoriesEmpty.hidden = media.length > 0;

  media.forEach((m) => {
    const card = document.createElement("article");
    card.className = "memory-card";
    const wrap = document.createElement("div");
    wrap.className = "media-wrap";
    if (m.type === "video") {
      const v = document.createElement("video");
      v.src = m.url;
      v.controls = true;
      v.playsInline = true;
      wrap.appendChild(v);
    } else {
      const img = document.createElement("img");
      img.src = m.url;
      img.alt = m.caption || "Kỷ niệm";
      img.loading = "lazy";
      wrap.appendChild(img);
    }
    card.appendChild(wrap);
    if (m.caption) {
      const cap = document.createElement("div");
      cap.className = "caption";
      cap.textContent = m.caption;
      card.appendChild(cap);
    }
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = formatTime(m.createdAt);
    card.appendChild(meta);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "del";
    del.setAttribute("aria-label", "Xóa");
    del.textContent = "×";
    del.addEventListener("click", async () => {
      if (!confirm("Xóa kỷ niệm này?")) return;
      await api(`/api/memories/${m.id}`, { method: "DELETE" });
      await refreshMemories();
    });
    card.appendChild(del);
    memoriesGrid.appendChild(card);
  });
}

function renderNotes(list) {
  notesList.innerHTML = "";
  const notes = applyNoteFilters(list);
  notes.forEach((m) => {
    const item = document.createElement("div");
    item.className = "note-item";
    const p = document.createElement("p");
    p.textContent = m.text || "";
    item.appendChild(p);
    const meta = document.createElement("div");
    meta.className = "note-meta";
    meta.textContent = formatTime(m.createdAt);
    item.appendChild(meta);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "del";
    del.setAttribute("aria-label", "Xóa");
    del.textContent = "🗑";
    del.addEventListener("click", async () => {
      if (!confirm("Xóa lời nhắn này?")) return;
      await api(`/api/memories/${m.id}`, { method: "DELETE" });
      await refreshMemories();
    });
    item.appendChild(del);
    notesList.appendChild(item);
  });
}

function appendChatBubble(msg, isMe) {
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble" + (isMe ? " me" : "");
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = msg.author;
  const txt = document.createElement("p");
  txt.className = "txt";
  txt.textContent = msg.text;
  const when = document.createElement("div");
  when.className = "when";
  when.textContent = formatTime(msg.createdAt);
  bubble.appendChild(who);
  bubble.appendChild(txt);
  bubble.appendChild(when);
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderChat(list) {
  chatMessages.innerHTML = "";
  const filtered = applyChatFilters(list);
  filtered.forEach((m) => appendChatBubble(m, m.author === author));
}

async function refreshMemories() {
  const list = await api("/api/memories");
  lastMemories = list;
  renderMemories(lastMemories);
  renderNotes(lastMemories);
}

async function loadChatHistory() {
  const msgs = await api("/api/chat");
  lastMessages = msgs;
  renderChat(lastMessages);
}

function connectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  socket = io({ transports: ["websocket", "polling"] });
  socket.emit("join", { room, pass });
  socket.on("chat", (msg) => {
    lastMessages.push(msg);
    renderChat(lastMessages);
  });
  socket.on("auth_error", (p) => {
    alert(p?.error || "Sai mật khẩu phòng");
  });
}

function setScreen(screen) {
  const isGate = screen === "gate";
  gate.hidden = !isGate;
  app.hidden = isGate;
}

function syncRoute() {
  const hash = location.hash || "#/gate";
  if (hash.startsWith("#/detail")) {
    // Chỉ vào chi tiết khi đã có đủ thông tin
    if (!roomInput.value.trim() || !passInput.value.trim()) {
      setScreen("gate");
      return;
    }
    setScreen("detail");
  } else {
    setScreen("gate");
  }
}

enterBtn.addEventListener("click", async () => {
  showGateError("");
  const code = roomInput.value.trim();
  const name = nameInput.value.trim() || "Bạn";
  const pw = passInput.value;
  if (code.length < 2) {
    showGateError("Mã phòng cần ít nhất 2 ký tự nhé.");
    return;
  }
  if ((pw || "").trim().length < 4) {
    showGateError("Mật khẩu phòng cần ít nhất 4 ký tự nhé.");
    return;
  }
  room = code;
  author = name;
  pass = pw;
  savePrefs();
  roomLabel.textContent = code;
  location.hash = "#/detail";
  setScreen("detail");
  try {
    await refreshMemories();
    await loadChatHistory();
    connectSocket();
  } catch (e) {
    location.hash = "#/gate";
    setScreen("gate");
    showGateError(e.message || "Không kết nối được máy chủ.");
  }
});

leaveBtn.addEventListener("click", () => {
  if (socket) socket.disconnect();
  socket = null;
  location.hash = "#/gate";
  setScreen("gate");
  room = "";
  pass = "";
});

memTypeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    memTypeButtons.forEach((b) => b.classList.toggle("active", b === btn));
    filters.mem.type = btn.dataset.filterType || "all";
    renderMemories(lastMemories);
  });
});

memSearch?.addEventListener("input", () => {
  filters.mem.q = memSearch.value;
  renderMemories(lastMemories);
});

memSort?.addEventListener("change", () => {
  filters.mem.sort = memSort.value;
  renderMemories(lastMemories);
});

noteSearch?.addEventListener("input", () => {
  filters.note.q = noteSearch.value;
  renderNotes(lastMemories);
});

noteSort?.addEventListener("change", () => {
  filters.note.sort = noteSort.value;
  renderNotes(lastMemories);
});

chatSearch?.addEventListener("input", () => {
  filters.chat.q = chatSearch.value;
  renderChat(lastMessages);
});

mediaInput.addEventListener("change", async () => {
  const file = mediaInput.files?.[0];
  if (!file) return;
  const isVideo = file.type.startsWith("video/");
  const fd = new FormData();
  fd.append("room", room);
  fd.append("type", isVideo ? "video" : "image");
  fd.append("caption", mediaCaption.value);
  fd.append("file", file);
  try {
    await fetch(`/api/memories?room=${encodeURIComponent(room)}`, {
      method: "POST",
      body: fd,
      headers: { "X-Room-Pass": pass },
    });
    mediaCaption.value = "";
    mediaInput.value = "";
    await refreshMemories();
  } catch {
    alert("Tải lên thất bại — thử file nhỏ hơn hoặc định dạng khác.");
  }
});

noteForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = noteText.value.trim();
  if (!text) return;
  const fd = new FormData();
  fd.append("room", room);
  fd.append("type", "text");
  fd.append("text", text);
  try {
    await fetch(`/api/memories?room=${encodeURIComponent(room)}`, {
      method: "POST",
      body: fd,
      headers: { "X-Room-Pass": pass },
    });
    noteText.value = "";
    await refreshMemories();
    setTab("notes");
  } catch {
    alert("Không lưu được lời nhắn.");
  }
});

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !socket) return;
  socket.emit("chat", { room, pass, author, text });
  chatInput.value = "";
});

loadPrefs();
window.addEventListener("hashchange", syncRoute);
syncRoute();
