import { $, formatTime, loadPrefs, normalize } from "/shared.js";

const roomLabel = $("roomLabel");
// topbar height fixed via CSS var --topbar-h

const tabs = document.querySelectorAll(".tab");
const panels = {
  memories: $("panel-memories"),
  notes: $("panel-notes"),
  chat: $("panel-chat"),
};

const memoriesGrid = $("memoriesGrid");
const memoriesEmpty = $("memoriesEmpty");
const uploadSlot = $("uploadSlot");
const memoriesLoadingSlot = $("memoriesLoadingSlot");
const mediaInput = $("mediaInput");
const mediaCaption = $("mediaCaption");
const memSearch = $("memSearch");
const memDateFrom = $("memDateFrom");
const memDateTo = $("memDateTo");
const memDateFromDisplay = $("memDateFromDisplay");
const memDateToDisplay = $("memDateToDisplay");
const memTypeButtons = document.querySelectorAll("[data-filter-type]");

const noteForm = $("noteForm");
const noteText = $("noteText");
const notesList = $("notesList");
const notesLoading = $("notesLoading");
const noteSearch = $("noteSearch");
const noteDateFrom = $("noteDateFrom");
const noteDateTo = $("noteDateTo");
const noteDateFromDisplay = $("noteDateFromDisplay");
const noteDateToDisplay = $("noteDateToDisplay");

const chatMessages = $("chatMessages");
const chatForm = $("chatForm");
const chatInput = $("chatInput");
const chatSearch = $("chatSearch");

const lightbox = $("lightbox");
const lightboxImg = $("lightboxImg");
const lightboxCap = $("lightboxCap");
const lightboxNavButtons = document.querySelectorAll("[data-nav]");

const prefs = loadPrefs();
const urlRoom = new URLSearchParams(location.search).get("room") || "";

let room = (urlRoom || prefs.room || "").trim();
let author = (prefs.author || "Bạn").trim() || "Bạn";
let pass = prefs.pass || "";

let socket = null;
let lastMemories = [];
let lastMessages = [];

const chatPaging = {
  limit: 50,
  loading: false,
  done: false,
  oldestCreatedAt: "",
};

const mediaPaging = { limit: 24, loading: false, done: false, cursor: "", lastRequestedCursor: "" };
const notePaging = { limit: 30, loading: false, done: false, cursor: "", lastRequestedCursor: "" };
let notesCache = [];

let uploadStates = []; // [{ id, type, previewUrl, caption, progress }]
let uploadQueue = [];
let uploadRunning = false;
let refreshAfterUploadsTimer = null;

function renderUploadCard() {
  if (!uploadSlot) return;
  uploadSlot.innerHTML = "";
  if (!uploadStates.length) return;

  uploadStates.forEach((st) => {
    const card = document.createElement("article");
    card.className = "memory-card is-loading";
    card.id = `uploadCard_${st.id}`;
    const wrap = document.createElement("div");
    wrap.className = "media-wrap";
    if (st.type === "video") {
      const v = document.createElement("video");
      v.src = st.previewUrl;
      v.muted = true;
      v.playsInline = true;
      v.loop = true;
      v.autoplay = true;
      wrap.appendChild(v);
    } else {
      const img = document.createElement("img");
      img.src = st.previewUrl;
      img.alt = st.caption || "Đang tải lên...";
      wrap.appendChild(img);
    }
    card.appendChild(wrap);

    const prog = document.createElement("div");
    prog.className = "upload-progress";
    const row = document.createElement("div");
    row.className = "row";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = "Đang tải lên…";
    const pct = document.createElement("div");
    pct.className = "pct";
    pct.id = `uploadPct_${st.id}`;
    pct.textContent = `${Math.round(st.progress || 0)}%`;
    row.appendChild(title);
    row.appendChild(pct);
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("div");
    fill.className = "fill";
    fill.id = `uploadFill_${st.id}`;
    fill.style.width = `${Math.max(0, Math.min(100, st.progress || 0))}%`;
    bar.appendChild(fill);
    prog.appendChild(row);
    prog.appendChild(bar);
    card.appendChild(prog);

    uploadSlot.appendChild(card);
  });
}

function updateUploadCardProgress() {
  // giữ tương thích: không dùng nữa
}

function updateUploadCardProgressById(id, progress) {
  const pct = document.getElementById(`uploadPct_${id}`);
  const fill = document.getElementById(`uploadFill_${id}`);
  if (!pct || !fill) return;
  pct.textContent = `${Math.round(progress || 0)}%`;
  fill.style.width = `${Math.max(0, Math.min(100, progress || 0))}%`;
}

const lightboxState = {
  images: [],
  index: 0,
};

const filters = {
  mem: { type: "all", q: "", sort: "desc", from: "", to: "" },
  note: { q: "", sort: "desc", from: "", to: "" },
  chat: { q: "" },
};

function isoToVN(iso) {
  const s = String(iso || "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function syncDateDisplays() {
  const set = (displayEl, inputEl, emptyText) => {
    if (!displayEl) return;
    const has = Boolean(inputEl?.value);
    displayEl.textContent = has ? isoToVN(inputEl.value) : emptyText;
    displayEl.setAttribute("data-empty", has ? "0" : "1");
  };
  set(memDateFromDisplay, memDateFrom, "Từ dd/MM/yyyy");
  set(memDateToDisplay, memDateTo, "Đến dd/MM/yyyy");
  set(noteDateFromDisplay, noteDateFrom, "Từ dd/MM/yyyy");
  set(noteDateToDisplay, noteDateTo, "Đến dd/MM/yyyy");
}

if (!room || !pass) {
  window.location.replace("/gate.html");
}

roomLabel.textContent = room;
document.title = `${room} • Kỷ niệm của đôi ta 💕`;

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

  if (name === "chat") {
    // Đảm bảo mở tab chat là thấy tin mới nhất
    queueMicrotask(() => {
      if (!chatMessages) return;
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
  }
}

tabs.forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));

function applyMemFilters(list) {
  let out = Array.isArray(list) ? list.slice() : [];
  const q = normalize(filters.mem.q).trim();
  const type = filters.mem.type;
  const from = String(filters.mem.from || "").trim();
  const to = String(filters.mem.to || "").trim();
  out = out.filter((m) => m.type === "image" || m.type === "video");
  if (type !== "all") out = out.filter((m) => m.type === type);
  if (q) out = out.filter((m) => normalize(m.caption).includes(q));
  if (from || to) {
    out = out.filter((m) => {
      const d = String(m.createdAt || "").slice(0, 10); // YYYY-MM-DD
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }
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
  const from = String(filters.note.from || "").trim();
  const to = String(filters.note.to || "").trim();
  out = out.filter((m) => m.type === "text");
  if (q) out = out.filter((m) => normalize(m.text).includes(q));
  if (from || to) {
    out = out.filter((m) => {
      const d = String(m.createdAt || "").slice(0, 10); // YYYY-MM-DD
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }
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

function isMemFilterActive() {
  return (
    filters.mem.type !== "all" ||
    String(filters.mem.q || "").trim() ||
    String(filters.mem.from || "").trim() ||
    String(filters.mem.to || "").trim() ||
    String(filters.mem.sort || "desc") !== "desc"
  );
}

function isNoteFilterActive() {
  return (
    String(filters.note.q || "").trim() ||
    String(filters.note.from || "").trim() ||
    String(filters.note.to || "").trim() ||
    String(filters.note.sort || "desc") !== "desc"
  );
}

function showMemoriesSkeleton(show) {
  if (!memoriesLoadingSlot) return;
  memoriesLoadingSlot.innerHTML = "";
  if (!show) return;
  const n = 6;
  for (let i = 0; i < n; i++) {
    const card = document.createElement("div");
    card.className = "skeleton-card";
    const wrap = document.createElement("div");
    wrap.className = "media-wrap";
    card.appendChild(wrap);
    memoriesLoadingSlot.appendChild(card);
  }
}

function renderMemories(list) {
  renderUploadCard();
  memoriesGrid.innerHTML = "";
  const media = applyMemFilters(list);
  memoriesEmpty.hidden = media.length > 0;

  media.forEach((m) => {
    const card = document.createElement("article");
    card.className = "memory-card is-loading";
    const wrap = document.createElement("div");
    wrap.className = "media-wrap";
    if (m.type === "video") {
      const v = document.createElement("video");
      v.src = m.url;
      v.controls = true;
      v.playsInline = true;
      v.addEventListener("loadeddata", () => card.classList.remove("is-loading"), { once: true });
      v.addEventListener("error", () => card.classList.remove("is-loading"), { once: true });
      wrap.appendChild(v);
    } else {
      wrap.classList.add("clickable");
      const img = document.createElement("img");
      img.src = m.url;
      img.alt = m.caption || "Kỷ niệm";
      img.loading = "lazy";
      img.addEventListener("load", () => card.classList.remove("is-loading"), { once: true });
      img.addEventListener("error", () => card.classList.remove("is-loading"), { once: true });
      wrap.appendChild(img);
      wrap.addEventListener("click", () => openLightbox(m.url, m.caption || ""));
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
      await loadMediaInitial();
    });
    card.appendChild(del);
    memoriesGrid.appendChild(card);
  });
}

function appendMemories(items) {
  items.forEach((m) => {
    const card = document.createElement("article");
    card.className = "memory-card is-loading";
    const wrap = document.createElement("div");
    wrap.className = "media-wrap";
    if (m.type === "video") {
      const v = document.createElement("video");
      v.src = m.url;
      v.controls = true;
      v.playsInline = true;
      v.addEventListener("loadeddata", () => card.classList.remove("is-loading"), { once: true });
      v.addEventListener("error", () => card.classList.remove("is-loading"), { once: true });
      wrap.appendChild(v);
    } else {
      wrap.classList.add("clickable");
      const img = document.createElement("img");
      img.src = m.url;
      img.alt = m.caption || "Kỷ niệm";
      img.loading = "lazy";
      img.addEventListener("load", () => card.classList.remove("is-loading"), { once: true });
      img.addEventListener("error", () => card.classList.remove("is-loading"), { once: true });
      wrap.appendChild(img);
      wrap.addEventListener("click", () => openLightbox(m.url, m.caption || ""));
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
      await loadMediaInitial();
    });
    card.appendChild(del);
    memoriesGrid.appendChild(card);
  });
}

function buildImageList() {
  // Dựa theo bộ lọc hiện tại, chỉ lấy ảnh (không lấy video)
  const filteredMedia = applyMemFilters(lastMemories).filter((m) => m.type === "image");
  return filteredMedia.map((m) => ({ url: m.url, caption: m.caption || "" }));
}

function showLightboxAt(index) {
  if (!lightbox || !lightboxImg) return;
  const list = lightboxState.images;
  if (!list.length) return;
  const i = ((index % list.length) + list.length) % list.length;
  lightboxState.index = i;
  lightboxImg.src = list[i].url;
  lightboxCap.textContent = list[i].caption || "";
}

function openLightbox(url, caption) {
  if (!lightbox || !lightboxImg) return;
  lightboxState.images = buildImageList();
  const found = lightboxState.images.findIndex((x) => x.url === url);
  lightboxState.index = found >= 0 ? found : 0;
  lightbox.hidden = false;
  document.body.style.overflow = "hidden";
  if (caption && found < 0) {
    // fallback nếu ảnh không nằm trong list hiện tại
    lightboxImg.src = url;
    lightboxCap.textContent = caption || "";
  } else {
    showLightboxAt(lightboxState.index);
  }
}

function closeLightbox() {
  if (!lightbox) return;
  lightbox.hidden = true;
  if (lightboxImg) lightboxImg.src = "";
  document.body.style.overflow = "";
}

lightbox?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close) closeLightbox();
  const nav = e.target?.dataset?.nav;
  if (nav) {
    showLightboxAt(lightboxState.index + Number(nav));
  }
});

window.addEventListener("keydown", (e) => {
  if (!lightbox || lightbox.hidden) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") showLightboxAt(lightboxState.index - 1);
  if (e.key === "ArrowRight") showLightboxAt(lightboxState.index + 1);
});

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
      await loadNotesInitial();
    });
    item.appendChild(del);
    notesList.appendChild(item);
  });
}

function appendNotes(items) {
  items.forEach((m) => {
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
      await loadNotesInitial();
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
}

function isNearBottom(el) {
  const gap = el.scrollHeight - (el.scrollTop + el.clientHeight);
  return gap < 40;
}

function prependChatBubbles(msgs) {
  if (!msgs.length) return;
  const beforeHeight = chatMessages.scrollHeight;
  const beforeTop = chatMessages.scrollTop;
  const frag = document.createDocumentFragment();
  msgs.forEach((m) => {
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble" + (m.author === author ? " me" : "");
    const who = document.createElement("div");
    who.className = "who";
    who.textContent = m.author;
    const txt = document.createElement("p");
    txt.className = "txt";
    txt.textContent = m.text;
    const when = document.createElement("div");
    when.className = "when";
    when.textContent = formatTime(m.createdAt);
    bubble.appendChild(who);
    bubble.appendChild(txt);
    bubble.appendChild(when);
    frag.appendChild(bubble);
  });
  chatMessages.insertBefore(frag, chatMessages.firstChild);
  const afterHeight = chatMessages.scrollHeight;
  chatMessages.scrollTop = beforeTop + (afterHeight - beforeHeight);
}

function renderChat(list) {
  chatMessages.innerHTML = "";
  const filtered = applyChatFilters(list);
  filtered.forEach((m) => appendChatBubble(m, m.author === author));
}

async function loadMediaInitial() {
  mediaPaging.loading = true;
  mediaPaging.done = false;
  mediaPaging.cursor = "";
  mediaPaging.lastRequestedCursor = "";
  showMemoriesSkeleton(true);
  const items = await api(`/api/memories?limit=${mediaPaging.limit}&type=media`);
  lastMemories = items;
  mediaPaging.cursor = items[items.length - 1]?.createdAt || "";
  mediaPaging.done = items.length < mediaPaging.limit;
  mediaPaging.loading = false;
  showMemoriesSkeleton(false);
  renderMemories(lastMemories);
}

async function loadMoreMedia() {
  if (mediaPaging.loading || mediaPaging.done) return;
  if (!mediaPaging.cursor) return;
  // Nếu cursor không đổi mà bị trigger lại (bounce scroll), bỏ qua
  if (mediaPaging.lastRequestedCursor === mediaPaging.cursor) return;
  mediaPaging.loading = true;
  mediaPaging.lastRequestedCursor = mediaPaging.cursor;
  showMemoriesSkeleton(true);
  try {
    const older = await api(
      `/api/memories?limit=${mediaPaging.limit}&type=media&before=${encodeURIComponent(mediaPaging.cursor)}`
    );
    if (!older.length) {
      mediaPaging.done = true;
      return;
    }
    mediaPaging.cursor = older[older.length - 1]?.createdAt || mediaPaging.cursor;
    if (older.length < mediaPaging.limit) mediaPaging.done = true;
    const existing = new Set(lastMemories.map((m) => m.id));
    const toAdd = older.filter((m) => !existing.has(m.id));
    lastMemories = [...lastMemories, ...toAdd];
    // Nếu không thêm được item mới (trùng hết) thì dừng hẳn để tránh gọi lặp
    if (!toAdd.length) {
      mediaPaging.done = true;
      return;
    }
    if (isMemFilterActive()) renderMemories(lastMemories);
    else appendMemories(toAdd);
  } finally {
    showMemoriesSkeleton(false);
    mediaPaging.loading = false;
  }
}

async function loadNotesInitial() {
  notePaging.loading = true;
  notePaging.done = false;
  notePaging.cursor = "";
  notePaging.lastRequestedCursor = "";
  if (notesLoading) notesLoading.hidden = true;
  const items = await api(`/api/memories?limit=${notePaging.limit}&type=text`);
  notesCache = items;
  notePaging.cursor = items[items.length - 1]?.createdAt || "";
  notePaging.done = items.length < notePaging.limit;
  notePaging.loading = false;
  renderNotes(notesCache);
}

async function loadMoreNotes() {
  if (notePaging.loading || notePaging.done) return;
  if (!notePaging.cursor) return;
  if (notePaging.lastRequestedCursor === notePaging.cursor) return;
  notePaging.loading = true;
  notePaging.lastRequestedCursor = notePaging.cursor;
  if (notesLoading) notesLoading.hidden = false;
  try {
    const older = await api(`/api/memories?limit=${notePaging.limit}&type=text&before=${encodeURIComponent(notePaging.cursor)}`);
    if (!older.length) {
      notePaging.done = true;
      return;
    }
    notePaging.cursor = older[older.length - 1]?.createdAt || notePaging.cursor;
    if (older.length < notePaging.limit) notePaging.done = true;
    const existing = new Set(notesCache.map((m) => m.id));
    const toAdd = older.filter((m) => !existing.has(m.id));
    notesCache = [...notesCache, ...toAdd];
    // Trùng hết => dừng để tránh gọi hoài khi scroll lại
    if (!toAdd.length) {
      notePaging.done = true;
      return;
    }
    if (isNoteFilterActive()) renderNotes(notesCache);
    else appendNotes(toAdd);
  } finally {
    if (notesLoading) notesLoading.hidden = true;
    notePaging.loading = false;
  }
}

async function loadChatHistory() {
  chatPaging.loading = true;
  chatPaging.done = false;
  chatPaging.oldestCreatedAt = "";
  const msgs = await api(`/api/chat?limit=${chatPaging.limit}`);
  lastMessages = msgs;
  chatPaging.oldestCreatedAt = lastMessages[0]?.createdAt || "";
  chatPaging.done = msgs.length < chatPaging.limit;
  chatPaging.loading = false;
  renderChat(lastMessages);
  queueMicrotask(() => {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

async function loadOlderChat() {
  if (chatPaging.loading || chatPaging.done) return;
  if (!chatPaging.oldestCreatedAt) return;
  chatPaging.loading = true;
  try {
    const older = await api(`/api/chat?limit=${chatPaging.limit}&before=${encodeURIComponent(chatPaging.oldestCreatedAt)}`);
    if (!older.length) {
      chatPaging.done = true;
      return;
    }
    chatPaging.oldestCreatedAt = older[0]?.createdAt || chatPaging.oldestCreatedAt;
    if (older.length < chatPaging.limit) chatPaging.done = true;

    // merge unique by id (tránh trùng)
    const existing = new Set(lastMessages.map((m) => m.id));
    const toAdd = older.filter((m) => !existing.has(m.id));
    lastMessages = [...toAdd, ...lastMessages];

    // Nếu đang search filter chat => render lại full (đơn giản)
    if (String(filters.chat.q || "").trim()) {
      renderChat(lastMessages);
      return;
    }
    // Không filter => prepend DOM để không nháy + giữ vị trí scroll
    prependChatBubbles(toAdd);
  } finally {
    chatPaging.loading = false;
  }
}

function connectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  socket = io({ transports: ["websocket", "polling"] });
  socket.emit("join", { room, pass });
  socket.on("chat", (msg) => {
    const wasNearBottom = isNearBottom(chatMessages);
    lastMessages.push(msg);
    if (String(filters.chat.q || "").trim()) {
      renderChat(lastMessages);
    } else {
      appendChatBubble(msg, msg.author === author);
    }
    if (wasNearBottom) chatMessages.scrollTop = chatMessages.scrollHeight;
  });
  socket.on("auth_error", (p) => {
    alert(p?.error || "Sai mật khẩu phòng");
    window.location.href = "/gate.html";
  });
}

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
memDateFrom?.addEventListener("change", () => {
  filters.mem.from = memDateFrom.value || "";
  if (memDateTo?.value && filters.mem.from && memDateTo.value < filters.mem.from) memDateTo.value = filters.mem.from;
  filters.mem.to = memDateTo?.value || "";
  syncDateDisplays();
  renderMemories(lastMemories);
});
memDateTo?.addEventListener("change", () => {
  filters.mem.to = memDateTo.value || "";
  if (memDateFrom?.value && filters.mem.to && filters.mem.to < memDateFrom.value) memDateFrom.value = filters.mem.to;
  filters.mem.from = memDateFrom?.value || "";
  syncDateDisplays();
  renderMemories(lastMemories);
});
noteSearch?.addEventListener("input", () => {
  filters.note.q = noteSearch.value;
  renderNotes(notesCache);
});
noteDateFrom?.addEventListener("change", () => {
  filters.note.from = noteDateFrom.value || "";
  if (noteDateTo?.value && filters.note.from && noteDateTo.value < filters.note.from) noteDateTo.value = filters.note.from;
  filters.note.to = noteDateTo?.value || "";
  syncDateDisplays();
  renderNotes(notesCache);
});
noteDateTo?.addEventListener("change", () => {
  filters.note.to = noteDateTo.value || "";
  if (noteDateFrom?.value && filters.note.to && filters.note.to < noteDateFrom.value) noteDateFrom.value = filters.note.to;
  filters.note.from = noteDateFrom?.value || "";
  syncDateDisplays();
  renderNotes(notesCache);
});

syncDateDisplays();

// Mở date picker khi bấm icon lịch / cả cụm ngày
document.querySelectorAll("[data-date-open]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.dateOpen;
    const input = id ? document.getElementById(id) : null;
    if (!input) return;
    if (typeof input.showPicker === "function") input.showPicker();
    else input.click();
  });
});
function initDropdown(ddName, onChange) {
  const root = document.querySelector(`.dd[data-dd="${ddName}"]`);
  if (!root) return;
  const btn = root.querySelector(".dd-btn");
  const label = root.querySelector(".dd-label");
  const menu = root.querySelector(".dd-menu");
  const items = Array.from(root.querySelectorAll(".dd-item"));
  if (!btn || !label || !menu || !items.length) return;

  const close = () => {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    const r = btn.getBoundingClientRect();
    // menu fixed => không ảnh hưởng scroll của filter-row
    menu.style.top = `${Math.round(r.bottom + 8)}px`;
    menu.style.left = `${Math.round(r.right - Math.max(menu.offsetWidth || 180, r.width))}px`;
    menu.style.minWidth = `${Math.round(Math.max(180, r.width))}px`;
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  };

  const setValue = (value) => {
    const it = items.find((x) => x.dataset.value === value) || items[0];
    const v = it.dataset.value;
    label.textContent = it.textContent;
    items.forEach((x) => x.classList.toggle("active", x === it));
    onChange(v);
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.hidden) open();
    else close();
  });

  items.forEach((it) => {
    it.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setValue(it.dataset.value);
      close();
    });
  });

  document.addEventListener("click", () => close());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  window.addEventListener("resize", () => {
    if (!menu.hidden) open();
  });
  window.addEventListener(
    "scroll",
    () => {
      if (!menu.hidden) close();
    },
    true
  );

  // init
  setValue("desc");
}

initDropdown("memSort", (v) => {
  filters.mem.sort = v;
  renderMemories(lastMemories);
});

initDropdown("noteSort", (v) => {
  filters.note.sort = v;
  renderNotes(notesCache);
});

chatSearch?.addEventListener("input", () => {
  filters.chat.q = chatSearch.value;
  renderChat(lastMessages);
});

// Lazy load media/notes khi scroll gần cuối danh sách
const memScroll = document.querySelector("#panel-memories .panel-scroll");
const notesScroll = document.querySelector("#panel-notes .panel-scroll");

let lastMemScrollTop = 0;
let lastNotesScrollTop = 0;

memScroll?.addEventListener("scroll", () => {
  // Chỉ load khi đang scroll xuống (không load khi scroll ngược lên rồi thả)
  const goingDown = memScroll.scrollTop > lastMemScrollTop;
  lastMemScrollTop = memScroll.scrollTop;
  if (!goingDown) return;
  const gap = memScroll.scrollHeight - (memScroll.scrollTop + memScroll.clientHeight);
  if (gap < 220) loadMoreMedia();
});

notesScroll?.addEventListener("scroll", () => {
  const goingDown = notesScroll.scrollTop > lastNotesScrollTop;
  lastNotesScrollTop = notesScroll.scrollTop;
  if (!goingDown) return;
  const gap = notesScroll.scrollHeight - (notesScroll.scrollTop + notesScroll.clientHeight);
  if (gap < 220) loadMoreNotes();
});

chatMessages?.addEventListener("scroll", () => {
  if (chatMessages.scrollTop < 60) {
    loadOlderChat();
  }
});

mediaInput.addEventListener("change", async () => {
  const files = Array.from(mediaInput.files || []);
  if (!files.length) return;
  const caption = mediaCaption.value || "";

  files.forEach((file) => {
    uploadQueue.push({ file, caption });
  });

  // reset UI input 1 lần
  mediaCaption.value = "";
  mediaInput.value = "";

  if (!uploadRunning) runUploadQueue();
});

function scheduleRefreshAfterUploads() {
  if (refreshAfterUploadsTimer) clearTimeout(refreshAfterUploadsTimer);
  refreshAfterUploadsTimer = setTimeout(async () => {
    refreshAfterUploadsTimer = null;
    await loadMediaInitial();
  }, 300);
}

async function runUploadQueue() {
  uploadRunning = true;
  try {
    while (uploadQueue.length) {
      const job = uploadQueue.shift();
      const file = job.file;
      const isVideo = file.type.startsWith("video/");
      const id = crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const previewUrl = URL.createObjectURL(file);
      const st = { id, type: isVideo ? "video" : "image", previewUrl, caption: job.caption, progress: 0 };
      uploadStates = [st, ...uploadStates];
      renderUploadCard();

      await new Promise((resolve) => {
        const fd = new FormData();
        fd.append("room", room);
        fd.append("type", isVideo ? "video" : "image");
        fd.append("caption", job.caption);
        fd.append("file", file);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/memories?room=${encodeURIComponent(room)}`, true);
        xhr.setRequestHeader("X-Room-Pass", pass);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) st.progress = (e.loaded / e.total) * 100;
          else st.progress = Math.min(99, (st.progress || 0) + 2);
          updateUploadCardProgressById(st.id, st.progress);
        };
        xhr.onload = () => {
          const ok = xhr.status >= 200 && xhr.status < 300;
          URL.revokeObjectURL(previewUrl);
          uploadStates = uploadStates.filter((x) => x.id !== st.id);
          renderUploadCard();
          if (!ok) {
            try {
              const j = JSON.parse(xhr.responseText || "{}");
              alert(j.error || "Tải lên thất bại — thử file nhỏ hơn hoặc định dạng khác.");
            } catch {
              alert("Tải lên thất bại — thử file nhỏ hơn hoặc định dạng khác.");
            }
          } else {
            scheduleRefreshAfterUploads();
          }
          resolve();
        };
        xhr.onerror = () => {
          URL.revokeObjectURL(previewUrl);
          uploadStates = uploadStates.filter((x) => x.id !== st.id);
          renderUploadCard();
          alert("Tải lên thất bại — kiểm tra mạng và thử lại.");
          resolve();
        };
        xhr.send(fd);
      });
    }
  } finally {
    uploadRunning = false;
  }
}

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
    await loadNotesInitial();
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

(async function boot() {
  try {
    await loadMediaInitial();
    await loadNotesInitial();
    await loadChatHistory();
    connectSocket();
  } catch (e) {
    alert(e?.message || "Không vào được phòng.");
    window.location.href = "/gate.html";
  }
})();

