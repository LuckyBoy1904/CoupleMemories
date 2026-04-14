import { $, loadPrefs, savePrefs } from "/shared.js";

const gateError = $("gateError");
const roomInput = $("roomCode");
const nameInput = $("displayName");
const passInput = $("roomPass");
const enterBtn = $("enterBtn");

function showGateError(msg) {
  gateError.textContent = msg;
  gateError.hidden = !msg;
}

function init() {
  const prefs = loadPrefs();
  if (prefs.room) roomInput.value = prefs.room;
  if (prefs.author) nameInput.value = prefs.author;
  if (prefs.pass) passInput.value = prefs.pass;
}

enterBtn.addEventListener("click", () => {
  showGateError("");
  const room = roomInput.value.trim();
  const author = nameInput.value.trim() || "Bạn";
  const pass = passInput.value;

  if (room.length < 2) {
    showGateError("Mã phòng cần ít nhất 2 ký tự nhé.");
    return;
  }
  if ((pass || "").trim().length < 4) {
    showGateError("Mật khẩu phòng cần ít nhất 4 ký tự nhé.");
    return;
  }

  // Kiểm tra mật khẩu ngay tại màn vào phòng:
  // - Nếu phòng đã tồn tại và mật khẩu sai => API trả 401, báo lỗi ngay.
  // - Nếu phòng chưa tồn tại => API sẽ tạo phòng (lần đầu), cho vào luôn.
  (async () => {
    enterBtn.disabled = true;
    try {
      const res = await fetch(`/api/memories?room=${encodeURIComponent(room)}`, {
        method: "GET",
        headers: { "X-Room-Pass": pass },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showGateError(err.error || "Sai mật khẩu phòng");
        return;
      }
      savePrefs({ room, author, pass });
      window.location.href = `/room.html?room=${encodeURIComponent(room)}`;
    } catch {
      showGateError("Không kết nối được máy chủ. Bạn thử lại nhé.");
    } finally {
      enterBtn.disabled = false;
    }
  })();
});

init();

