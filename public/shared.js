export const STORAGE_KEY = "coupleMemories_prefs";

export const $ = (id) => document.getElementById(id);

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const j = JSON.parse(raw);
    return {
      room: String(j.room || ""),
      author: String(j.author || ""),
      pass: String(j.pass || ""),
    };
  } catch {
    return {};
  }
}

export function savePrefs({ room, author, pass }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ room: String(room || "").trim(), author: String(author || "").trim(), pass: String(pass || "") }));
}

export function normalize(s) {
  return String(s || "").toLowerCase();
}

export function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

