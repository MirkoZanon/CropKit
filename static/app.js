/* CropKit – browser interface. Talks to the local Python server (app.py). */
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

async function api(path, body, method) {
  const opt = body === undefined ? { method: method || "GET" }
    : { method: method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const r = await fetch(path, opt);
  let data = {};
  try { data = await r.json(); } catch (_) { /* empty */ }
  if (!r.ok) throw new Error(data.error || `${r.status} ${r.statusText}`);
  return data;
}
const qs = (o) => new URLSearchParams(o).toString();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtBytes = (b) => b > 1e9 ? (b / 1e9).toFixed(2) + " GB" : b > 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.round(b / 1e3) + " kB";
const fmtTime = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return m ? `${m} min ${s % 60}s` : `${s}s`; };

let toastTimer;
function toast(msg, err = false, ms = 3500) {
  const t = $("#toast");
  t.innerHTML = msg; t.classList.toggle("err", err); t.classList.remove("hidden");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
}

// ============================================================================ state
const S = {
  sys: null, settings: null, folder: null, outputDir: "", files: [], checked: new Set(), filter: "all",
  cur: -1, info: null, W: 0, H: 0, shape: "circle", pts: [], dirty: false, prevRoi: null,
  img: null, frames: new Map(), frameIdx: 0, gen: 0, fullRes: false,
  view: { s: 1, ox: 0, oy: 0 }, polling: null,
};

const T = () => (S.settings && S.settings.tasks) || { crop: true, resize: true, fps: true };
const cropOn = () => !!T().crop;

// ============================================================================ geometry (mirror of media.py)
function fitCircle(pts) {
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = pts.length, bx = 0, by = 0, b1 = 0;
  for (const [x, y] of pts) {
    const b = x * x + y * y;
    sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y; bx += x * b; by += y * b; b1 += b;
  }
  const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], v = [bx, by, b1];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  if (Math.abs(D) < 1e-9) return null;
  const c = [0, 1, 2].map((k) => det(M.map((row, i) => row.map((val, j) => (j === k ? v[i] : val)))) / D);
  const cx = c[0] / 2, cy = c[1] / 2, r2 = c[2] + cx * cx + cy * cy;
  return r2 > 0 ? { cx, cy, r: Math.sqrt(r2) } : null;
}

function roiFromPoints(shape, pts) {
  if (shape === "full") return { shape };
  if (shape === "circle" && pts.length >= 3) { const c = fitCircle(pts); return c && { shape, ...c }; }
  if ((shape === "rectangle" || shape === "square") && pts.length >= 2) {
    let [[xa, ya], [xb, yb]] = pts.slice(-2);
    if (shape === "square") {
      const side = Math.max(Math.abs(xb - xa), Math.abs(yb - ya));
      xb = xa + side * (xb >= xa ? 1 : -1); yb = ya + side * (yb >= ya ? 1 : -1);
    }
    return { shape, x0: Math.min(xa, xb), y0: Math.min(ya, yb), x1: Math.max(xa, xb), y1: Math.max(ya, yb) };
  }
  if (shape === "polygon" && pts.length >= 3) return { shape, pts };
  return null;
}

function pointsFromRoi(roi) {
  if (!roi) return [];
  if (roi.points && roi.points.length) return roi.points.map((p) => [p[0], p[1]]);
  if (roi.shape === "circle") return [0, 1, 2, 3].map((k) => [roi.cx + roi.r * Math.cos(k * Math.PI / 2), roi.cy + roi.r * Math.sin(k * Math.PI / 2)]);
  if (roi.shape === "rectangle" || roi.shape === "square") return [[roi.x0, roi.y0], [roi.x1, roi.y1]];
  if (roi.shape === "polygon") return roi.pts.map((p) => [p[0], p[1]]);
  return [];
}

const NEED = { circle: 3, rectangle: 2, square: 2, polygon: 3, full: 0 };
const HINT = {
  circle: "click 3 or more points on the edge",
  rectangle: "click 2 opposite corners",
  square: "click 2 opposite corners",
  polygon: "click the corners in order",
  full: "whole frame – nothing to draw",
};

// ============================================================================ canvas
const cv = $("#canvas"), ctx = cv.getContext("2d");

function resizeCanvas() {
  const r = $("#stage").getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
  cv._dpr = dpr; cv._w = r.width; cv._h = r.height;
  draw();
}
new ResizeObserver(() => { const had = cv._w; resizeCanvas(); if (!had) fitView(); }).observe($("#stage"));

function fitView() {
  if (!S.W) return;
  const pad = 16, s = Math.min((cv._w - 2 * pad) / S.W, (cv._h - 2 * pad) / S.H);
  S.view = { s, ox: (cv._w - S.W * s) / 2, oy: (cv._h - S.H * s) / 2 };
  draw();
}
const toScreen = ([x, y]) => [S.view.ox + x * S.view.s, S.view.oy + y * S.view.s];
const toImage = (sx, sy) => [(sx - S.view.ox) / S.view.s, (sy - S.view.oy) / S.view.s];

function roiPath(roi, p) {
  const v = S.view;
  if (roi.shape === "full") { p.rect(v.ox, v.oy, S.W * v.s, S.H * v.s); return; }
  if (roi.shape === "circle") { const [x, y] = toScreen([roi.cx, roi.cy]); p.moveTo(x + roi.r * v.s, y); p.arc(x, y, roi.r * v.s, 0, 2 * Math.PI); return; }
  if (roi.shape === "rectangle" || roi.shape === "square") {
    const [x0, y0] = toScreen([roi.x0, roi.y0]), [x1, y1] = toScreen([roi.x1, roi.y1]); p.rect(x0, y0, x1 - x0, y1 - y0); return;
  }
  roi.pts.forEach((q, i) => { const [x, y] = toScreen(q); i ? p.lineTo(x, y) : p.moveTo(x, y); }); p.closePath();
}

function draw() {
  const dpr = cv._dpr || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cv._w, cv._h);
  if (!S.img || !S.W) return;
  const v = S.view;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(S.img, v.ox, v.oy, S.W * v.s, S.H * v.s);
  if (!cropOn()) { updateStatus(null); return; }
  const roi = roiFromPoints(S.shape, S.pts);
  if (roi && roi.shape !== "full") {
    const p = new Path2D(); p.rect(0, 0, cv._w, cv._h); roiPath(roi, p);
    ctx.fillStyle = "rgba(10,12,16,0.55)"; ctx.fill(p, "evenodd");
    const o = new Path2D(); roiPath(roi, o);
    ctx.lineWidth = 2.2; ctx.strokeStyle = "#ff4d4d"; ctx.stroke(o);
    if (roi.shape === "circle") {
      const [x, y] = toScreen([roi.cx, roi.cy]);
      ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); ctx.stroke();
    }
  } else if (roi && roi.shape === "full") {
    const o = new Path2D(); roiPath(roi, o); ctx.lineWidth = 3; ctx.strokeStyle = "#ff4d4d"; ctx.stroke(o);
  }
  if (S.shape === "polygon" && S.pts.length >= 2 && !roi) {
    ctx.beginPath(); S.pts.forEach((q, i) => { const [x, y] = toScreen(q); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.lineWidth = 2; ctx.strokeStyle = "#ff4d4d"; ctx.stroke();
  }
  S.pts.forEach((q, i) => {
    const [x, y] = toScreen(q);
    ctx.beginPath(); ctx.arc(x, y, 5.5, 0, 2 * Math.PI);
    ctx.fillStyle = "#ffd34d"; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = "#1a1a1a"; ctx.stroke();
    if (S.shape === "polygon") { ctx.fillStyle = "#fff"; ctx.font = "11px sans-serif"; ctx.fillText(String(i + 1), x + 7, y - 7); }
  });
  updateStatus(roi);
}

function updateStepHint() {
  const t = T(), n = S.files.length, drawn = S.files.filter((f) => f.roi).length;
  if (t.crop) {
    $("#stepIcon").textContent = "✏️";
    $("#editorTitle").textContent = n && drawn === n ? "All areas drawn – press ▶ Process" : "Draw the area to keep on each file";
    $("#drawProgress").textContent = n ? `${drawn} of ${n} drawn` : "";
    $("#drawProgress").classList.toggle("alldone", n > 0 && drawn === n);
  } else {
    $("#stepIcon").textContent = "👁";
    $("#editorTitle").textContent = "Check your files, then press ▶ Process";
  }
}
function updateStatus(roi = roiFromPoints(S.shape, S.pts)) {
  const f = S.files[S.cur];
  if (!f) { $("#hud").textContent = ""; $("#status").innerHTML = "—"; return; }
  if (!cropOn()) {
    $("#hud").textContent = "preview · drag = move · wheel = zoom";
    $("#status").innerHTML = `whole picture ${S.W} × ${S.H} px` + (S.info && S.info.kind === "video" && S.info.fps ? ` · ${S.info.fps} fps` : "");
    return;
  }
  const n = S.pts.length, need = NEED[S.shape];
  let hud = `${S.shape}: ${HINT[S.shape]}`;
  if (S.shape !== "full") hud += ` · ${n} point${n === 1 ? "" : "s"}` + (n < need ? ` (need ${need})` : "");
  hud += "  ·  drag = move · wheel = zoom";
  $("#hud").textContent = hud;
  let st;
  if (roi) {
    let d = "";
    if (roi.shape === "circle") {
      const dev = Math.max(...S.pts.map(([x, y]) => Math.abs(Math.hypot(x - roi.cx, y - roi.cy) - roi.r)));
      d = `centre (${roi.cx.toFixed(0)}, ${roi.cy.toFixed(0)}), radius <b>${roi.r.toFixed(0)} px</b>, max point deviation ${dev.toFixed(1)} px`;
    } else if (roi.shape === "full") d = `whole frame ${S.W} × ${S.H} px`;
    else {
      const xs = roi.shape === "polygon" ? roi.pts.map((p) => p[0]) : [roi.x0, roi.x1];
      const ys = roi.shape === "polygon" ? roi.pts.map((p) => p[1]) : [roi.y0, roi.y1];
      d = `<b>${(Math.max(...xs) - Math.min(...xs)).toFixed(0)} × ${(Math.max(...ys) - Math.min(...ys)).toFixed(0)} px</b>`;
    }
    st = `${S.dirty ? "<b>not saved yet</b> · " : (f.roi ? "✔ saved · " : "")}${roi.shape}: ${d}`;
  } else {
    st = f.roi && !S.dirty ? "✔ saved" : "no area yet";
  }
  $("#status").innerHTML = st;
}

// ---------------------------------------------------------------- mouse / keys
let drag = null;
function hitPoint(sx, sy) {
  if (!cropOn()) return -1;
  let best = -1, bd = 10;
  S.pts.forEach((q, i) => { const [x, y] = toScreen(q); const d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = i; } });
  return best;
}
cv.addEventListener("contextmenu", (e) => e.preventDefault());
cv.addEventListener("pointerdown", (e) => {
  if (!S.img) return;
  cv.setPointerCapture(e.pointerId);
  const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
  const hp = e.button === 0 ? hitPoint(sx, sy) : -1;
  drag = hp >= 0 ? { type: "point", i: hp } : { type: "pan", x: sx, y: sy, ox: S.view.ox, oy: S.view.oy, moved: e.button !== 0 };
});
cv.addEventListener("pointermove", (e) => {
  const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (!drag) { cv.classList.toggle("overpoint", hitPoint(sx, sy) >= 0); return; }
  if (drag.type === "point") { S.pts[drag.i] = toImage(sx, sy); S.dirty = true; draw(); return; }
  const dx = sx - drag.x, dy = sy - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
  if (drag.moved) { cv.classList.add("panning"); S.view.ox = drag.ox + dx; S.view.oy = drag.oy + dy; draw(); }
});
cv.addEventListener("pointerup", (e) => {
  const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
  cv.classList.remove("panning");
  if (drag && drag.type === "pan" && !drag.moved && e.button === 0) addPoint(toImage(sx, sy));
  drag = null;
});
cv.addEventListener("wheel", (e) => {
  if (!S.img) return;
  e.preventDefault();
  const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
  const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
  const s = Math.min(Math.max(S.view.s * k, 0.02), 40);
  const [ix, iy] = toImage(sx, sy);
  S.view = { s, ox: sx - ix * s, oy: sy - iy * s };
  draw();
}, { passive: false });

function addPoint(p) {
  if (!cropOn()) return;
  if (S.shape === "full") { toast("Whole frame: nothing to click – just press Save &amp; next."); return; }
  if ((S.shape === "rectangle" || S.shape === "square") && S.pts.length >= 2) {
    const two = S.pts.slice(-2);
    const k = Math.hypot(p[0] - two[0][0], p[1] - two[0][1]) <= Math.hypot(p[0] - two[1][0], p[1] - two[1][1]) ? 0 : 1;
    two[k] = p; S.pts = two;
  } else S.pts.push(p);
  S.dirty = true; draw();
}

document.addEventListener("keydown", (e) => {
  const tag = (document.activeElement && document.activeElement.tagName) || "";
  if (["INPUT", "SELECT", "TEXTAREA"].includes(tag) && document.activeElement.type !== "range") return;
  if ($$(".modal").some((m) => !m.classList.contains("hidden"))) {
    if (e.key === "Escape") closeModals(); return;
  }
  if (e.key === "Escape") { hidePopover(); return; }
  if (S.cur < 0) return;
  if (!$("#home").classList.contains("hidden")) return;
  if (e.key === "Enter") { e.preventDefault(); saveAndNext(); }
  else if ((e.key === "Backspace" || e.key === "Delete") && cropOn()) { e.preventDefault(); undo(); }
  else if (e.key === "ArrowRight" && S.info?.kind === "video") { e.preventDefault(); stepFrame(1); }
  else if (e.key === "ArrowLeft" && S.info?.kind === "video") { e.preventDefault(); stepFrame(-1); }
  else if (e.key.toLowerCase() === "f") fitView();
});

function undo() { if (S.pts.length) { S.pts.pop(); S.dirty = true; draw(); } }

// ============================================================================ shapes toolbar
function setShape(shape, clear = true) {
  if (shape === S.shape && !clear) return;
  S.shape = shape;
  if (clear) { S.pts = []; S.dirty = true; }
  $$("#shapeButtons button").forEach((b) => b.classList.toggle("on", b.dataset.shape === shape));
  draw();
}
$$("#shapeButtons button").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.shape === S.shape) return;
  if (S.pts.length && !confirm(`Switch to ${b.dataset.shape}? The points you clicked will be cleared.`)) return;
  setShape(b.dataset.shape); saveSettings({ default_shape: b.dataset.shape });
}));
$("#btnUndo").onclick = undo;
$("#btnClear").onclick = () => { S.pts = []; S.dirty = true; draw(); };
$("#btnFit").onclick = fitView;
$("#btnPrevRoi").onclick = () => {
  if (!S.prevRoi) { toast("No previous area yet – save one first."); return; }
  setShape(S.prevRoi.shape); S.pts = pointsFromRoi(S.prevRoi); S.dirty = true; draw();
};

// ============================================================================ folder & files
async function openFolder(path) {
  if (!path) return;
  if (!(T().crop || T().resize || T().fps)) { toast("First pick what you want to do (Crop, Resize or Frame rate).", true); return; }
  if (!(await leaveFile())) return;
  try {
    const d = await api("/api/folder", { path });
    S.folder = d.path; S.files = d.files; S.outputDir = d.output_dir;
    $("#folderName").textContent = baseName(d.path); $("#folderPill").title = d.path + " – change folder (Home)";
    hideHome();
    S.checked = new Set(S.files.map((f) => f.name));
    S.cur = -1; S.prevRoi = [...S.files].reverse().find((f) => f.roi)?.roi || null;
    $("#folderPath").value = d.path;
    fillRecent(d.recent);
    renderFiles(); renderRunSummary();
    const first = cropOn() ? S.files.findIndex((f) => !f.roi) : 0;
    if (S.files.length) { $("#emptyMsg").classList.add("hidden"); openFile(first >= 0 ? first : 0); }
    else { S.img = null; draw(); $("#emptyMsg").classList.remove("hidden"); $("#emptyMsg p").innerHTML = "<b>No videos or images</b> in this folder."; }
  } catch (e) { toast(e.message, true); }
}
async function refreshFiles() {
  if (!S.folder) return;
  try {
    const d = await api("/api/folder", { path: S.folder });
    const byName = Object.fromEntries(d.files.map((f) => [f.name, f]));
    S.files.forEach((f) => { if (byName[f.name]) { f.done = byName[f.name].done; f.roi = byName[f.name].roi; } });
    S.outputDir = d.output_dir; renderFiles(); renderRunSummary();
  } catch (_) { /* ignore */ }
}
const baseName = (p) => String(p).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
function fillRecent(list) {
  S.recent = list || [];
  $("#recentList").innerHTML = S.recent.slice(0, 5).map((p) => `
    <button class="rrow" data-path="${esc(p)}"><span class="ri">📁</span>
      <span class="rt"><b>${esc(baseName(p))}</b><small>${esc(p)}</small></span><span class="go">Open</span></button>`).join("");
  $$("#recentList .rrow").forEach((b) => (b.onclick = () => openFolder(b.dataset.path)));
}
$("#btnOpenFolder").onclick = async () => {
  const d = await api("/api/pick-folder", { prompt: "Choose the folder with your videos / images" }).catch((e) => toast(e.message, true));
  if (d && d.path) openFolder(d.path);
};
$("#folderPath").addEventListener("keydown", (e) => { if (e.key === "Enter") openFolder(e.target.value.trim()); });

function visibleFiles() {
  return S.files.map((f, i) => [f, i]).filter(([f]) =>
    S.filter === "all" || (S.filter === "roi" && f.roi) || (S.filter === "noroi" && !f.roi) || S.filter === f.kind);
}
function renderFiles() {
  const ul = $("#fileList");
  ul.innerHTML = visibleFiles().map(([f, i]) => `
    <li data-i="${i}" class="${i === S.cur ? "active" : ""}">
      <input type="checkbox" ${S.checked.has(f.name) ? "checked" : ""} title="Include in processing">
      <span>${f.kind === "video" ? "🎞" : "🖼"}</span>
      <span class="fname" title="${esc(f.name)}">${esc(f.name)}</span>
      <span class="badges">${f.roi && cropOn() ? `<span class="badge roi">${f.roi.shape === "full" ? "whole" : "area"}</span>` : ""}${f.done ? '<span class="badge done">done</span>' : ""}</span>
      <span class="fsub">${fmtBytes(f.bytes)}${f.roi && cropOn() ? " · " + f.roi.shape : ""}</span>
    </li>`).join("");
  $$("#fileList li").forEach((li) => {
    const i = +li.dataset.i;
    li.querySelector("input").addEventListener("click", (e) => {
      e.stopPropagation();
      e.target.checked ? S.checked.add(S.files[i].name) : S.checked.delete(S.files[i].name);
      renderRunSummary();
    });
    li.addEventListener("click", () => openFile(i));
  });
  const nroi = S.files.filter((f) => f.roi).length;
  $("#fileSummary").textContent = S.folder ? `${S.files.length} files` + (cropOn() ? ` · ${nroi} with area` : "") : "No folder open";
  updateStepHint();
  $("#chkAll").checked = S.files.length > 0 && S.files.every((f) => S.checked.has(f.name));
}
$("#chkAll").onchange = (e) => {
  visibleFiles().forEach(([f]) => (e.target.checked ? S.checked.add(f.name) : S.checked.delete(f.name)));
  renderFiles(); renderRunSummary();
};
$("#fileFilter").onchange = (e) => { S.filter = e.target.value; renderFiles(); };

async function leaveFile() {
  if (S.cur < 0 || !S.dirty || !cropOn()) return true;
  const roi = roiFromPoints(S.shape, S.pts);
  if (!roi) return true;
  if (confirm(`Save the area you drew on "${S.files[S.cur].name}" before leaving it?`)) return await saveRoi();
  return true;
}

// ============================================================================ open a file / frames
async function openFile(i) {
  if (i === S.cur) return;
  if (!(await leaveFile())) return;
  const f = S.files[i]; if (!f) return;
  S.cur = i; S.gen++; const gen = S.gen;
  S.frames = new Map(); S.fullRes = false; S.img = null;
  renderFiles();
  $("#fileTitle").textContent = f.name;
  $("#loading").classList.remove("hidden");
  try {
    S.info = await api("/api/info?" + qs({ folder: S.folder, name: f.name }));
  } catch (e) { toast(e.message, true); $("#loading").classList.add("hidden"); return; }
  if (gen !== S.gen) return;
  [S.W, S.H] = S.info.size;
  const shape = f.roi ? f.roi.shape : (S.settings.default_shape || "circle");
  setShape(shape, false);
  S.pts = pointsFromRoi(f.roi); S.dirty = false;
  const meta = S.info.kind === "video"
    ? `${S.W}×${S.H} · ${S.info.fps ?? "?"} fps · ${fmtTime(S.info.duration || 0)} · ${S.info.codec || ""}`
    : `${S.W}×${S.H} · image`;
  $("#fileTitle").innerHTML = `<b>${esc(f.name)}</b> · ${meta} · ${fmtBytes(f.bytes)} <span class="muted">(${i + 1}/${S.files.length})</span>`;
  $("#frameBar").classList.toggle("hidden", S.info.kind !== "video");
  if (S.info.kind === "video") {
    const n = S.info.times.length;
    $("#frameSlider").max = n - 1; $("#frameSlider").value = 0; S.frameIdx = 0;
    await showFrame(0, gen, true);
    preloadFrames(gen);
  } else {
    const img = await loadImage(frameUrl(f.name, 0, 2400)).catch((e) => { toast("Could not load: " + e.message, true); return null; });
    if (gen !== S.gen || !img) return;
    S.img = img; fitView();
    $("#loading").classList.add("hidden");
    prefetchNext(gen);
  }
}

const frameUrl = (name, t, w, fast = true) => "/api/frame?" + qs({ folder: S.folder, name, t, w, fast: fast ? 1 : 0 });
function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("frame could not be read")); im.src = url; });
}
function frameLabel() {
  const t = S.info.times[S.frameIdx], n = S.info.times.length;
  $("#frameLabel").textContent = `${S.frameIdx + 1}/${n} · ${fmtTime(t)} / ${fmtTime(S.info.duration || 0)}` + (S.fullRes ? " · full res" : "");
}
async function showFrame(k, gen = S.gen, first = false) {
  S.frameIdx = k; $("#frameSlider").value = k; S.fullRes = false; frameLabel();
  let img = S.frames.get(k);
  if (!img) {
    $("#loading").classList.remove("hidden");
    img = await loadImage(frameUrl(S.files[S.cur].name, S.info.times[k], 1280)).catch(() => null);
    if (img) S.frames.set(k, img);
  }
  if (gen !== S.gen || S.frameIdx !== k) return;
  $("#loading").classList.add("hidden");
  if (!img) { toast("Could not read this frame", true); return; }
  S.img = img;
  if (first) fitView(); else draw();
  updatePreloadLabel();
}
function stepFrame(d) {
  if (!S.info || S.info.kind !== "video") return;
  const k = Math.min(Math.max(S.frameIdx + d, 0), S.info.times.length - 1);
  if (k !== S.frameIdx) showFrame(k);
}
$("#frameSlider").addEventListener("input", (e) => showFrame(+e.target.value));
$("#btnFramePrev").onclick = () => stepFrame(-1);
$("#btnFrameNext").onclick = () => stepFrame(1);
$("#btnFullRes").onclick = async () => {
  const gen = S.gen, k = S.frameIdx;
  $("#loading").classList.remove("hidden"); $("#loading").textContent = "loading full resolution…";
  const img = await loadImage(frameUrl(S.files[S.cur].name, S.info.times[k], 0, false)).catch(() => null);
  $("#loading").textContent = "loading…";
  if (gen !== S.gen || S.frameIdx !== k) return;
  $("#loading").classList.add("hidden");
  if (img) { S.img = img; S.fullRes = true; frameLabel(); draw(); }
};

function bisectOrder(n) {
  const order = [], seen = new Set(), q = [[0, n - 1]];
  for (const k of [0, n - 1]) if (!seen.has(k)) { order.push(k); seen.add(k); }
  while (q.length) {
    const [a, b] = q.shift(), m = (a + b) >> 1;
    if (!seen.has(m)) { order.push(m); seen.add(m); }
    if (m - a > 1) q.push([a, m]);
    if (b - m > 1) q.push([m, b]);
  }
  for (let k = 0; k < n; k++) if (!seen.has(k)) order.push(k);
  return order;
}
function updatePreloadLabel() {
  if (!S.info || S.info.kind !== "video") return;
  const n = S.info.times.length, k = S.frames.size;
  $("#preloadLabel").textContent = k < n ? `previews ${k}/${n}` : "all previews loaded ✔";
}
async function preloadFrames(gen) {
  const name = S.files[S.cur].name, times = S.info.times, order = bisectOrder(times.length);
  let next = 0;
  const worker = async () => {
    while (next < order.length && gen === S.gen) {
      const k = order[next++];
      if (S.frames.has(k)) continue;
      const img = await loadImage(frameUrl(name, times[k], 1280)).catch(() => null);
      if (gen !== S.gen) return;
      if (img) { S.frames.set(k, img); updatePreloadLabel(); }
    }
  };
  await Promise.all([worker(), worker()]);
  if (gen === S.gen) prefetchNext(gen);
}
async function prefetchNext(gen) {
  // warm up the first frames of the next file so "Save & next" is instant
  const nf = S.files[S.cur + 1];
  if (!nf || gen !== S.gen) return;
  try {
    const info = await api("/api/info?" + qs({ folder: S.folder, name: nf.name }));
    if (gen !== S.gen) return;
    if (info.kind === "video") {
      const t = info.times, ks = [...new Set([0, t.length >> 1, t.length - 1])];
      for (const k of ks) { if (gen !== S.gen) return; await loadImage(frameUrl(nf.name, t[k], 1280)).catch(() => null); }
    } else await loadImage(frameUrl(nf.name, 0, 2400)).catch(() => null);
  } catch (_) { /* ignore */ }
}

// ============================================================================ saving ROIs
async function saveRoi() {
  const f = S.files[S.cur];
  const roi = roiFromPoints(S.shape, S.pts);
  if (!roi) { toast(`${S.shape}: ${HINT[S.shape]} first (need ${NEED[S.shape]} points).`, true); return false; }
  try {
    const d = await api("/api/roi", { folder: S.folder, name: f.name, shape: S.shape, points: S.pts });
    f.roi = d.roi; S.prevRoi = d.roi; S.dirty = false;
    renderFiles(); renderRunSummary(); draw();
    return true;
  } catch (e) { toast(e.message, true); return false; }
}
async function saveAndNext() {
  if (S.cur < 0) return;
  if (cropOn() && !(S.files[S.cur].roi && !S.dirty) && !(await saveRoi())) return;
  if (S.cur + 1 < S.files.length) openFile(S.cur + 1);
  else toast(cropOn() ? "✔ That was the last file. Check the settings on the right and press <b>▶ Process</b>."
                      : "That was the last file.", false, 6000);
}
$("#btnSaveNext").onclick = saveAndNext;
$("#btnPrevFile").onclick = () => { if (S.cur > 0) openFile(S.cur - 1); };
$("#btnRemoveRoi").onclick = async () => {
  const f = S.files[S.cur]; if (!f) return;
  if (!f.roi) { S.pts = []; S.dirty = false; draw(); return; }
  if (!confirm(`Delete the saved area of "${f.name}"?`)) return;
  try {
    await api("/api/roi", { folder: S.folder, name: f.name, shape: null });
    f.roi = null; S.pts = []; S.dirty = false; renderFiles(); renderRunSummary(); draw();
  } catch (e) { toast(e.message, true); }
};
$("#btnCopyRoi").onclick = async () => {
  const f = S.files[S.cur]; if (!f) return;
  if (S.dirty && !(await saveRoi())) return;
  if (!f.roi) { toast("Draw and save an area on this file first.", true); return; }
  $("#copyFrom").textContent = f.name; $("#copyModal").classList.remove("hidden");
};
$("#btnCopyGo").onclick = async () => {
  const targets = $("input[name=copyTargets]:checked").value;
  try {
    const d = await api("/api/roi/copy", { folder: S.folder, name: S.files[S.cur].name, targets });
    closeModals(); await refreshFiles();
    toast(`Area copied to ${d.copied.length} file(s)` + (d.skipped.length ? ` · ${d.skipped.length} skipped (different size)` : ""));
  } catch (e) { toast(e.message, true); }
};

// ============================================================================ settings
const NUM = ["out_w", "out_h", "crf", "jpeg_quality", "parallel", "preview_n", "percent", "fps"];
const SEL = ["scale_mode", "transparent_video_format", "image_format", "no_roi", "preset", "exact_fit"];
const CHK = ["uniform", "audio", "hwaccel", "overwrite", "allow_upscale"];
const colorToHex = (c) => { const x = document.createElement("canvas").getContext("2d"); x.fillStyle = "#000"; x.fillStyle = c; return x.fillStyle; };

function fillSettings(s) {
  NUM.forEach((k) => ($("#s_" + k).value = s[k]));
  SEL.forEach((k) => ($("#s_" + k).value = s[k]));
  CHK.forEach((k) => ($("#s_" + k).checked = !!s[k]));
  $("#s_output_dir").value = s.output_dir || "";
  $(`input[name=resize_mode][value=${s.resize_mode}]`).checked = true;
  if (!s.fps) $("#s_fps").value = 10;
  const bg = s.background;
  const radio = bg === "black" || bg === "white" || bg === "transparent" ? bg : "custom";
  $(`input[name=bg][value=${radio}]`).checked = true;
  if (radio === "custom") $("#bgColor").value = colorToHex(bg);
  $("#transpOpts").classList.toggle("hidden", bg !== "transparent");
  $("#crfVal").textContent = s.crf; $("#jqVal").textContent = s.jpeg_quality;
  const m = s.resize_mode;
  $(".boxopts").classList.toggle("hidden", m === "percent");
  $(".pctopts").classList.toggle("hidden", m !== "percent");
  $(".fitopts").classList.toggle("hidden", m !== "fit");
  $(".exactopts").classList.toggle("hidden", m !== "exact");
  $("#resizeHint").textContent = m === "percent" ? `Width and height × ${s.percent / 100} (e.g. 3840 × 2160 → ${Math.round(3840 * s.percent / 100)} × ${Math.round(2160 * s.percent / 100)}).`
    : m === "exact" ? `Every result is exactly ${s.out_w} × ${s.out_h} px.`
    : `Shrunk to fit inside ${s.out_w} × ${s.out_h} px, proportions kept` + (s.allow_upscale ? "." : " (smaller pictures stay as they are).");
  applyTasks();
}
function collectSettings() {
  const s = {};
  NUM.forEach((k) => (s[k] = +$("#s_" + k).value));
  SEL.forEach((k) => (s[k] = $("#s_" + k).value));
  CHK.forEach((k) => (s[k] = $("#s_" + k).checked));
  s.output_dir = $("#s_output_dir").value.trim();
  s.resize_mode = $("input[name=resize_mode]:checked").value;
  const bg = $("input[name=bg]:checked").value;
  s.background = bg === "custom" ? $("#bgColor").value : bg;
  return s;
}
let saveTimer;
async function saveSettings(partial) {
  try {
    const d = await api("/api/settings", partial);
    S.settings = d.settings; fillSettings(S.settings);
    if (S.folder) refreshFiles(); else renderRunSummary();
  } catch (e) { toast(e.message, true); }
}
function onSettingChange() { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveSettings(collectSettings()), 250); }
$$("[id^=s_], input[name=bg], input[name=resize_mode], #bgColor").forEach((el) => {
  if (el.id.startsWith("s_update_")) return;
  el.addEventListener("change", onSettingChange);
});
$("#s_crf").addEventListener("input", (e) => ($("#crfVal").textContent = e.target.value));
$("#s_jpeg_quality").addEventListener("input", (e) => ($("#jqVal").textContent = e.target.value));
$("#sizePreset").onchange = (e) => {
  if (!e.target.value) return;
  const [w, h] = e.target.value.split("x"); $("#s_out_w").value = w; $("#s_out_h").value = h;
  e.target.value = ""; onSettingChange();
};
$("#bgColor").addEventListener("input", () => { $("input[name=bg][value=custom]").checked = true; });
$("#btnPickOut").onclick = async () => {
  const d = await api("/api/pick-folder", { prompt: "Choose the folder for the results" }).catch((e) => toast(e.message, true));
  if (d && d.path) { $("#s_output_dir").value = d.path; onSettingChange(); }
};
$("#btnUseDefaultOut").onclick = () => { $("#s_output_dir").value = ""; onSettingChange(); };
$("#btnReset").onclick = async () => {
  if (!confirm("Reset all settings to their defaults?")) return;
  const d = await api("/api/settings/reset", {}); S.settings = d.settings; fillSettings(S.settings); refreshFiles();
};
function describeTasks(s) {
  const t = s.tasks, parts = [];          // in the order they are applied
  if (t.fps) parts.push(`${s.fps} fps`);
  if (t.crop) parts.push("crop");
  if (t.resize) parts.push(s.resize_mode === "percent" ? `resize ${s.percent}%` :
    s.resize_mode === "exact" ? `exact ${s.out_w}×${s.out_h} (${s.exact_fit})` : `fit in ${s.out_w}×${s.out_h}`);
  return parts;
}
function renderRunSummary() {
  const s = S.settings; if (!s) return;
  $("#outDirResolved").innerHTML = S.folder && S.outputDir
    ? `<b>${esc(baseName(S.outputDir))}</b><br><span class="muted">${esc(S.outputDir)}</span>` : "";
  if (!S.folder) { $("#runSummary").textContent = "Open a folder first."; $("#btnProcess").disabled = true; return; }
  const t = s.tasks;
  const sel = S.files.filter((f) => S.checked.has(f.name));
  const withRoi = sel.filter((f) => f.roi), without = sel.length - withRoi.length;
  const use = !t.crop || s.no_roi === "full" ? sel : withRoi;
  const n = use.length, nv = use.filter((f) => f.kind === "video").length;
  const bg = s.background === "transparent" ? "transparent" : s.background;
  const parts = describeTasks(s);
  const framed = (t.resize && s.resize_mode === "exact") || s.uniform;
  let txt = `<b>${n}</b> file${n === 1 ? "" : "s"} (${nv} video, ${n - nv} image) · ${esc(parts.join(" → ") || "nothing selected")}` +
    (framed ? " · all same size" : "") + (t.crop || framed ? ` · background ${esc(bg)}` : "");
  if (t.fps && !nv) txt += `<br><span class="muted">Frame rate only changes videos.</span>`;
  if (t.crop && without && s.no_roi === "skip") txt += `<br><span class="muted">${without} ticked file(s) without area will be skipped.</span>`;
  $("#runSummary").innerHTML = txt;
  $("#btnProcess").textContent = `▶ Process ${n} file${n === 1 ? "" : "s"}`;
  $("#btnProcess").disabled = n === 0 || !parts.length;
}

// ============================================================================ processing
$("#btnProcess").onclick = async () => {
  if (S.dirty && roiFromPoints(S.shape, S.pts) && confirm("Save the area you are drawing first?")) await saveRoi();
  try {
    const names = S.files.filter((f) => S.checked.has(f.name)).map((f) => f.name);
    const d = await api("/api/process", { folder: S.folder, names });
    renderJobs(d.jobs, true);
    startPolling();
  } catch (e) { toast(e.message, true, 6000); }
};
$("#btnCancel").onclick = async () => { await api("/api/cancel", {}); toast("Cancelling…"); };
$("#btnRevealOut").onclick = async () => {
  if (!S.outputDir) return toast("Open a folder first.");
  api("/api/reveal", { path: S.outputDir }).catch((e) => toast(e.message, true));
};

function renderJobs(jobs, busy) {
  const now = Date.now() / 1000;
  $("#jobs").innerHTML = jobs.map((j) => {
    let eta = "";
    if (j.status === "running" && j.started && j.progress > 0.02) eta = ` · ${fmtTime((now - j.started) * (1 - j.progress) / j.progress)} left`;
    const pct = Math.round((j.progress || 0) * 100);
    const label = { queued: "waiting", running: `${pct}%`, done: "✔ done", failed: "✖ failed", skipped: "skipped", cancelled: "cancelled" }[j.status];
    return `<div class="job ${j.status}">
      <div class="jl"><span class="jn" title="${esc(j.name)} → ${esc(j.output)}">${j.kind === "video" ? "🎞" : "🖼"} ${esc(j.name)}</span><span>${label}</span></div>
      <div class="bar"><div style="width:${j.status === "running" || j.status === "done" ? pct : 0}%"></div></div>
      <div class="jt" title="${esc(j.text || "")}">${esc(j.text || "")}${eta}</div></div>`;
  }).join("");
  $("#btnCancel").classList.toggle("hidden", !busy);
  $("#btnProcess").disabled = busy || !S.folder;
}
function startPolling() {
  clearInterval(S.polling);
  S.polling = setInterval(async () => {
    try {
      const d = await api("/api/jobs");
      renderJobs(d.jobs, d.busy);
      if (!d.busy) {
        clearInterval(S.polling); S.polling = null;
        const c = (st) => d.jobs.filter((j) => j.status === st).length;
        const took = d.batch && d.batch.finished ? ` in ${fmtTime(d.batch.finished - d.batch.started)}` : "";
        toast(`Finished${took}: ${c("done")} done` + (c("skipped") ? `, ${c("skipped")} skipped` : "") +
              (c("failed") ? `, <b>${c("failed")} failed</b>` : "") + (c("cancelled") ? `, ${c("cancelled")} cancelled` : ""),
              c("failed") > 0, 8000);
        await refreshFiles(); renderRunSummary();
      }
    } catch (_) { /* server busy – try again */ }
  }, 700);
}

// ============================================================================ popovers, help, modals
function hidePopover() { $("#popover").classList.add("hidden"); }
document.addEventListener("click", (e) => {
  const i = e.target.closest(".info");
  if (i && i.dataset.help) {
    e.preventDefault(); e.stopPropagation();
    const pop = $("#popover");
    pop.innerHTML = INFO[i.dataset.help] || "";
    pop.classList.remove("hidden");
    const r = i.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = Math.min(r.left, window.innerWidth - pw - 10), y = r.bottom + 6;
    if (y + ph > window.innerHeight - 10) y = r.top - ph - 6;
    pop.style.left = Math.max(10, x) + "px"; pop.style.top = Math.max(10, y) + "px";
    return;
  }
  if (!e.target.closest("#popover")) hidePopover();
  if (e.target.matches("[data-close]") || e.target.classList.contains("modal")) closeModals();
}, true);

function closeModals() { $$(".modal").forEach((m) => m.classList.add("hidden")); }
function openHelp(section = 0) {
  const nav = $("#helpNav");
  nav.innerHTML = HELP.map(([t], k) => `<a href="#" data-k="${k}">${t}</a>`).join("");
  const show = (k) => {
    $$("#helpNav a").forEach((a) => a.classList.toggle("on", +a.dataset.k === k));
    $("#helpContent").innerHTML = `<h3>${HELP[k][0]}</h3>` + HELP[k][1];
    if (HELP[k][0] === "System check") renderSysCheck();
  };
  $$("#helpNav a").forEach((a) => (a.onclick = (e) => { e.preventDefault(); show(+a.dataset.k); }));
  show(section);
  $("#helpModal").classList.remove("hidden");
}
function renderSysCheck() {
  const s = S.sys || {};
  const ok = (b) => (b ? "✔" : "✖");
  $("#syscheck").innerHTML = `<table>
    <tr><td>CropKit</td><td>${esc(s.version || "?")}</td></tr>
    <tr><td>Python</td><td>${esc(s.python || "?")} (${esc(s.platform || "?")})</td></tr>
    <tr><td>ffmpeg (videos)</td><td>${ok(s.ffmpeg)} ${esc(s.ffmpeg || "not found")}<br><span class="muted">${esc(s.ffmpeg_version || "")}</span></td></tr>
    <tr><td>Video types</td><td>${esc((s.video_exts || []).join(" "))}</td></tr>
    <tr><td>Image types</td><td>${esc((s.image_exts || []).join(" "))}</td></tr>
    <tr><td>Settings file</td><td><code>~/.cropkit/settings.json</code></td></tr>
  </table>`;
}
$("#btnHelp").onclick = $("#btnHelp2").onclick = () => openHelp(0);
$("#btnHelpClose").onclick = closeModals;
$("#btnQuit").onclick = $("#btnQuit2").onclick = async () => {
  if (!confirm("Stop CropKit? (Running jobs are cancelled.)")) return;
  try { await api("/api/quit", {}); } catch (_) { /* server already gone */ }
  document.body.innerHTML = '<div style="padding:60px;text-align:center;font-family:sans-serif"><h2>CropKit stopped.</h2><p>You can close this window. Start it again with start.command (Mac) or start.bat (Windows).</p></div>';
};

// ============================================================================ home & tasks
function renderChips() {
  const t = T(), names = { crop: "Crop", resize: "Resize", fps: "Frame rate" };
  $("#taskChips").innerHTML = Object.keys(names).filter((k) => t[k]).map((k) => `<span class="chip">${names[k]}</span>`).join("") ||
    '<span class="chip off">nothing</span>';
}
function applyTasks() {
  const t = T(), s = S.settings;
  document.body.classList.toggle("nocrop", !t.crop);
  $("#cardCrop").classList.toggle("hidden", !t.crop);
  $("#cardResize").classList.toggle("hidden", !t.resize);
  $("#cardFps").classList.toggle("hidden", !t.fps);
  const exact = t.resize && s.resize_mode === "exact";
  // "same size for all" is implied by an exact size
  $("#s_uniform").closest("label").classList.toggle("hidden", exact);
  // the background choice lives in the Crop card; without crop it moves to "Save to" (for borders)
  const bg = $("#fsBackground");
  if (t.crop && bg.parentElement.id !== "cardCrop") $("#cardCrop h3").after(bg);
  if (!t.crop && bg.parentElement.id !== "bgHolder") $("#bgHolder").appendChild(bg);
  bg.classList.toggle("hidden", !(t.crop || exact || s.uniform));
  $("#transpOpts").classList.toggle("hidden", s.background !== "transparent");
  $("#uniformNote").textContent = exact ? "" : s.uniform
    ? (t.resize && s.resize_mode === "fit" ? `Every result is ${s.out_w} × ${s.out_h}, the picture centred.` : "Every result gets the size of the biggest one.")
    : "Each result is only as big as its own picture.";
  $("#drawInfo").dataset.help = t.crop ? "draw" : "preview";
  $("#btnSaveNext").innerHTML = t.crop ? "✔ Save &amp; next ▶" : "Next ▶";
  $("#settingsSub").textContent = "Done in this order: " + ["fps", "crop", "resize"].filter((k) => t[k])
    .map((k) => ({ fps: "frame rate", crop: "crop", resize: "resize" }[k])).concat(["save"]).join(" → ");
  renderChips(); renderFiles(); renderRunSummary(); draw();
}
function renderHome() {
  const t = T();
  $$(".task[data-task]").forEach((b) => b.classList.toggle("on", !!t[b.dataset.task]));
  const any = t.crop || t.resize || t.fps;
  $("#continueRow").classList.toggle("hidden", !S.folder);
  $("#btnContinue").disabled = !any;
  $("#btnContinue").textContent = any ? `Continue with “${baseName(S.folder || "")}” →` : "Pick at least one thing to do";
  $("#footVersion").textContent = "CropKit " + (S.sys ? S.sys.version : "");
}
function showHome() {
  renderHome(); $("#home").classList.remove("hidden");
  $("#folderPill").classList.add("hidden"); $("#taskChips").classList.add("hidden");
}
function hideHome() {
  $("#home").classList.add("hidden");
  $("#folderPill").classList.toggle("hidden", !S.folder); $("#taskChips").classList.remove("hidden");
  applyTasks(); resizeCanvas();
}
$$(".task[data-task]").forEach((b) => (b.onclick = async () => {
  const k = b.dataset.task;
  await saveSettings({ tasks: { ...T(), [k]: !T()[k] } }); renderHome();
}));
$("#btnHome").onclick = $("#taskChips").onclick = $("#folderPill").onclick = showHome;
$("#btnContinue").onclick = () => { if (!(T().crop || T().resize || T().fps)) return; hideHome(); };
const RECIPES = {
  dlc: [{ tasks: { crop: true, resize: true, fps: true }, resize_mode: "fit", out_w: 720, out_h: 720, allow_upscale: false,
          uniform: true, scale_mode: "fit", background: "black", fps: 10, crf: 20, image_format: "same", no_roi: "skip", audio: false },
        "DeepLabCut: crop the arena, black outside, all 720 × 720, 10 fps, MP4"],
  slides: [{ tasks: { crop: true, resize: true, fps: false }, resize_mode: "fit", out_w: 1920, out_h: 1080, allow_upscale: false,
             uniform: false, background: "transparent", transparent_video_format: "mov", image_format: "png", audio: false },
           "Clip for slides: crop, transparent outside, max 1920 × 1080, original frame rate"],
  smaller: [{ tasks: { crop: false, resize: true, fps: true }, resize_mode: "fit", out_w: 1280, out_h: 720, allow_upscale: false,
              uniform: false, fps: 30, background: "black", image_format: "same", crf: 23 },
            "Smaller videos: max 1280 × 720, 30 fps, no crop"],
  fpsonly: [{ tasks: { crop: false, resize: false, fps: true }, fps: 10, uniform: false, background: "black" },
            "Only frame rate: 10 fps, picture unchanged"],
  half: [{ tasks: { crop: false, resize: true, fps: false }, resize_mode: "percent", percent: 50, uniform: false,
           background: "black", image_format: "same" },
         "Half size: every image and video at 50 %"],
};
$$("[data-recipe]").forEach((b) => (b.onclick = async () => {
  const [p, msg] = RECIPES[b.dataset.recipe];
  await saveSettings(p); renderHome();
  toast("✔ " + msg + (S.folder ? " – press Continue." : " – now choose your folder."), false, 5000);
}));
$("#btnMakeIcon").onclick = async () => {
  $("#btnMakeIcon").disabled = true;
  try {
    const d = await api("/api/shortcut", { desktop: true });
    S.sys.shortcut = true; renderSettingsModal();
    toast("✔ App icon created. " + esc(d.hint), false, 12000);
  } catch (e) { toast(e.message, true, 8000); }
  $("#btnMakeIcon").disabled = false;
};

// ============================================================================ settings window
function renderSettingsModal() {
  $("#setVersion").textContent = S.sys.version;
  $("#s_update_check").checked = !!S.settings.update_check;
  $("#s_update_auto").checked = !!S.settings.update_auto;
  if (S.sys.shortcut) {
    $("#btnMakeIcon").textContent = "Create again";
    $("#btnMakeIcon").classList.remove("primary");
    $("#iconText").textContent = "✔ CropKit has its own app icon on this computer. Create it again if you moved the CropKit folder.";
  }
}
function openSettingsModal() { renderSettingsModal(); $("#settingsModal").classList.remove("hidden"); }
$("#btnSettings").onclick = openSettingsModal;
$$("[data-open=settings]").forEach((b) => (b.onclick = openSettingsModal));
$("#btnSetCheck").onclick = () => { closeModals(); openUpdates(); };

// ============================================================================ updates
const U = { info: null };
function mdNotes(t) {
  if (!t) return "";
  let html = "", inList = false;
  for (const raw of t.split("\n")) {
    const l = raw.trim();
    if (/^[-*] /.test(l)) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${esc(l.slice(2))}</li>`; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    if (!l) continue;
    html += /^#+ /.test(l) ? `<b>${esc(l.replace(/^#+ /, ""))}</b><br>` : `<p style="margin:4px 0">${esc(l)}</p>`;
  }
  return html + (inList ? "</ul>" : "");
}
function renderUpdateInfo() {
  const d = U.info;
  $("#upCurrent").textContent = S.sys.version;
  $("#upSource").textContent = S.sys.update_repo
    ? `Updates come from github.com/${S.sys.update_repo}` + (S.sys.git_copy ? " · this folder is a git clone: updating uses git pull." : "")
    : "No update source configured (update.json).";
  if (!d) return;
  $("#upLatest").textContent = d.latest || "–";
  $("#upWhen").textContent = d.published ? "(" + d.published.slice(0, 10) + ")" : "";
  $("#upMsg").className = "upmsg";
  $("#upMsg").innerHTML = d.available ? `<b>A new version is available.</b>` : `✔ You have the latest version.`;
  $("#upNotes").innerHTML = d.available && d.notes ? "<b>What's new</b>" + mdNotes(d.notes) : "";
  $("#upNotes").classList.toggle("hidden", !(d.available && d.notes));
  $("#btnUpInstall").classList.toggle("hidden", !d.available);
  $("#btnUpdate").classList.toggle("hidden", !d.available);
  if (d.available) $("#btnUpdate").textContent = `⬆ Update to ${d.latest}`;
}
async function checkUpdates(force = false, quiet = true) {
  if (!quiet) { $("#upMsg").className = "upmsg"; $("#upMsg").textContent = "Checking GitHub…"; }
  try {
    const d = await api("/api/update/check?" + qs(force ? { force: 1 } : { auto: 1 }));
    if (d.skipped) return;
    U.info = d; renderUpdateInfo();
  } catch (e) {
    if (!quiet) { $("#upMsg").className = "upmsg err"; $("#upMsg").textContent = e.message; }
  }
}
function openUpdates() {
  renderUpdateInfo();
  $("#updateModal").classList.remove("hidden");
  if (!U.info) checkUpdates(true, false);
}
$("#btnVersion").onclick = openUpdates;
$("#btnUpdate").onclick = openUpdates;
$("#btnUpCheck").onclick = () => checkUpdates(true, false);
["update_check", "update_auto"].forEach((k) =>
  $("#s_update_" + k.split("_")[1]).addEventListener("change", (e) => saveSettings({ [k]: e.target.checked })));
const STAGES = { start: "Starting…", download: "Downloading", unpack: "Unpacking", backup: "Backing up the current version",
  files: "Replacing files", libraries: "Installing libraries", git: "git pull", done: "Done" };
$("#btnUpInstall").onclick = async () => {
  try { await api("/api/update/install", {}); } catch (e) { $("#upMsg").className = "upmsg err"; $("#upMsg").textContent = e.message; return; }
  $("#btnUpInstall").classList.add("hidden"); $("#btnUpCheck").disabled = true;
  $("#upProgress").classList.remove("hidden");
  const t = setInterval(async () => {
    let d; try { d = await api("/api/update/progress"); } catch (_) { return; }
    const frac = d.total ? d.done / d.total : (d.stage === "done" ? 1 : 0.15);
    $("#upBar").style.width = Math.round(Math.min(frac, 1) * 100) + "%";
    $("#upStage").textContent = (STAGES[d.stage] || d.stage || "") + (d.stage === "download" && d.done ? ` · ${fmtBytes(d.done)}` : "");
    if (d.running) return;
    clearInterval(t); $("#btnUpCheck").disabled = false;
    if (d.error) { $("#upMsg").className = "upmsg err"; $("#upMsg").textContent = d.error; $("#btnUpInstall").classList.remove("hidden"); return; }
    const r = d.result || {};
    $("#upBar").style.width = "100%";
    $("#upMsg").className = "upmsg";
    $("#upMsg").innerHTML = `✔ Version <b>${esc(r.installed)}</b> installed. <b>Restart CropKit</b> to use it.` +
      (r.warning ? `<br><span class="small muted">${esc(r.warning)}</span>` : "");
    $("#btnUpRestart").classList.remove("hidden");
  }, 400);
};
$("#btnUpRestart").onclick = async () => {
  const old = S.sys.version;
  try { await api("/api/update/restart", {}); } catch (e) { $("#upMsg").className = "upmsg err"; $("#upMsg").textContent = e.message; return; }
  $("#upMsg").textContent = "Restarting… the window reloads by itself.";
  $("#btnUpRestart").disabled = true;
  let wentDown = false;
  const t = setInterval(async () => {
    try {
      const d = await (await fetch("/api/ping", { cache: "no-store" })).json();
      if (wentDown || d.version !== old) { clearInterval(t); location.reload(); }
    } catch (_) { wentDown = true; }
  }, 1000);
};
function showJustUpdated() {
  const j = S.settings.just_updated || {};
  if (!j.version) return;
  toast(`✔ CropKit was updated to <b>${esc(j.version)}</b> (from ${esc(j.previous || "?")}).` +
        (j.notes ? ` <a href="#" id="whatsNew" style="color:#9cc0ff">What's new</a>` : ""), false, 12000);
  const a = $("#whatsNew");
  if (a) a.onclick = (e) => {
    e.preventDefault(); openUpdates();
    $("#upNotes").innerHTML = "<b>What's new in " + esc(j.version) + "</b>" + mdNotes(j.notes); $("#upNotes").classList.remove("hidden");
  };
  api("/api/update/seen", {}).catch(() => {});
}

// ============================================================================ start
(async function init() {
  try {
    S.sys = await api("/api/state");
  } catch (e) { toast("Cannot reach the CropKit server: " + e.message, true, 10000); return; }
  S.settings = S.sys.settings;
  S.shape = S.settings.default_shape || "circle";
  setShape(S.shape, false);
  fillSettings(S.settings); fillRecent(S.settings.recent_folders); renderRunSummary(); resizeCanvas();
  $("#footVersion").textContent = "CropKit " + S.sys.version;
  showJustUpdated();
  checkUpdates();
  applyTasks();
  showHome();
  if (!S.sys.ffmpeg) toast("ffmpeg was not found: images work, videos won't. See Help → Troubleshooting.", true, 10000);
  const j = await api("/api/jobs").catch(() => null);
  if (j && j.jobs.length) { renderJobs(j.jobs, j.busy); if (j.busy) startPolling(); }
})();
