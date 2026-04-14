const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function spawnFloater(root, kind) {
  const el = document.createElement("div");
  el.className = `fx fx-${kind}`;

  const size = kind === "bubble" ? rand(10, 26) : rand(18, 30);
  const x = rand(0, 100);
  const drift = rand(-10, 10);
  const dur = kind === "bubble" ? rand(6.5, 11.5) : rand(7.5, 12.5);
  const delay = rand(0, 0.6);
  const op = kind === "bubble" ? rand(0.28, 0.8) : rand(0.48, 0.75);

  el.style.setProperty("--x", `${x}vw`);
  el.style.setProperty("--drift", `${drift}vw`);
  el.style.setProperty("--dur", `${dur}s`);
  el.style.setProperty("--delay", `${delay}s`);
  el.style.setProperty("--size", `${size}px`);
  el.style.setProperty("--op", `${op}`);

  if (kind === "heart") {
    el.textContent = Math.random() < 0.5 ? "💗" : Math.random() < 0.5 ? "💕" : "💞";
  } else {
    // bubble
    el.textContent = "";
  }

  el.addEventListener("animationend", () => el.remove(), { once: true });
  root.appendChild(el);

  // hard cap tránh leak nếu tab background lâu
  const max = 36;
  while (root.children.length > max) {
    root.firstElementChild?.remove();
  }
}

function startFloaters() {
  const root = document.querySelector(".bg-effects");
  if (!root) return;
  if (prefersReduced) return;

  // nhịp spawn nhẹ, không gây rối mắt
  setInterval(() => spawnFloater(root, "bubble"), 900);
  setInterval(() => spawnFloater(root, "heart"), 1200);
}

function placeSideGardens() {
  const left = document.querySelector(".side-garden.left");
  const right = document.querySelector(".side-garden.right");
  if (!left || !right) return;

  const appMax = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-max")) || 1120;
  const gap = Math.max(0, (window.innerWidth - appMax) / 2 - 12);
  const w = clamp(gap, 0, 360);
  left.style.width = `${w}px`;
  right.style.width = `${w}px`;
}

function startGardens() {
  if (prefersReduced) return;
  placeSideGardens();
  window.addEventListener("resize", placeSideGardens);
}

startFloaters();
startGardens();

