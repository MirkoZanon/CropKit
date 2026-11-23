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
  // an /api/ route the running program doesn't have (its answer is the generic "404 Not Found: The requested URL…")
  if (r.status === 404 && path.startsWith("/api/") && (!data.error || /^404 Not Found/.test(data.error))) {
    needsRestart(); throw new Error("CropKit was updated while it was running – please restart it.");
  }
  if (!r.ok) throw new Error(data.error || `${r.status} ${r.statusText}`);
  return data;
}
// The program running is older than the files on disk (CropKit was updated while it was running):
// a function of the page doesn't exist in it yet. Offer a restart instead of a confusing "404".
function needsRestart() {
  if (document.getElementById("restartBar")) return;
  const bar = document.createElement("div");
  bar.id = "restartBar"; bar.className = "restartbar";
  bar.innerHTML = `<b>CropKit was updated while it was running.</b> Restart it to use the new version.
    <button class="primary" id="btnRestartNow">↻ Restart CropKit</button>`;
  document.body.appendChild(bar);
  document.getElementById("btnRestartNow").onclick = async () => {
    bar.innerHTML = "Restarting… this window reloads by itself.";
    try { await fetch("/api/update/restart", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); }
    catch (_) { /* already going down */ }
    let down = false;
    const iv = setInterval(async () => {
      try { await fetch("/api/ping", { cache: "no-store" }); if (down) { clearInterval(iv); location.reload(); } }
      catch (_) { down = true; }
    }, 800);
    setTimeout(() => { clearInterval(iv); location.reload(); }, 15000);
  };
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

const T = () => (S.settings && S.settings.tasks) || { join: false, crop: true, resize: true, fps: true };
const cropOn = () => !!T().crop;
const joinOn = () => !!T().join;
const anyTask = () => { const t = T(); return !!(t.join || t.crop || t.resize || t.fps); };
const onlyJoin = () => { const t = T(); return !!t.join && !(t.crop || t.resize || t.fps); };
// joined videos ("<name>.join") are shown by their name and number of parts
const dname = (f) => f.label ? `${f.label} (${(f.parts || []).length} parts joined)` : f.name;
const ficon = (f) => f.parts ? "🔗" : f.kind === "video" ? "🎞" : "🖼";

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

// ---------------------------------------------------------------- "How it's done" notes
// Plain-language description of exactly what happens to the pixels and frames (matches media.py).
const fmtN = (x) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1));
function currentSourceBox() {
  // size of the picture that goes into the resize step: the crop box, or the whole frame
  if (!S.info || !S.W) return null;
  const roi = cropOn() ? roiFromPoints(S.shape, S.pts) : null;
  if (!roi || roi.shape === "full") return [S.W, S.H];
  if (roi.shape === "circle") return [2 * roi.r, 2 * roi.r];
  const xs = roi.shape === "polygon" ? roi.pts.map((p) => p[0]) : [roi.x0, roi.x1];
  const ys = roi.shape === "polygon" ? roi.pts.map((p) => p[1]) : [roi.y0, roi.y1];
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}
function plannedSize(w, h, s) {
  if (s.resize_mode === "percent") return [w * s.percent / 100, h * s.percent / 100];
  if (s.resize_mode === "exact") {
    if (s.exact_fit === "stretch") return [s.out_w, s.out_h];
    const k = s.exact_fit === "fill" ? Math.max(s.out_w / w, s.out_h / h) : Math.min(s.out_w / w, s.out_h / h);
    return [w * k, h * k];
  }
  let k = Math.min(s.out_w / w, s.out_h / h);
  if (!s.allow_upscale) k = Math.min(k, 1);
  return [w * k, h * k];
}
const HT = (t) => `<b class="ht">How it's done</b>${t}`;
function explain() {
  const s = S.settings; if (!s) return;
  const t = s.tasks, isVideo = S.info && S.info.kind === "video";
  // crop
  const outside = s.background === "transparent" ? "transparent" : `filled with ${esc(s.background)}`;
  $("#howCrop").innerHTML = HT(`Pixels inside the area are <b>copied exactly</b> – not resampled, not smoothed. Only the outline of a
    circle or polygon is softened over about 1 pixel, so it isn't jagged. Everything outside is ${outside}.`);
  // resize
  const box = currentSourceBox();
  let r = "";
  if (box) {
    const [w, h] = box, [sw, sh] = plannedSize(w, h, s), kx = w / sw, ky = h / sh;
    const ex = `${Math.round(w)} × ${Math.round(h)} → ${Math.round(sw)} × ${Math.round(sh)} px`;
    if (Math.abs(sw - w) < 1 && Math.abs(sh - h) < 1) r = `This file keeps its size (${ex}): pixels are copied unchanged.`;
    else if (sw * sh <= w * h) r = `<b>Area averaging</b>: each new pixel is the plain average of the original pixels it covers –
      here about ${fmtN(kx)} × ${fmtN(ky)} = ${fmtN(kx * ky)} original pixels per new pixel (${ex}). No sharpening, no extra
      smoothing, no detail is invented; fine detail smaller than one new pixel is averaged away.`;
    else r = `<b>Bicubic interpolation</b>: the picture is enlarged (${ex}); each new pixel is estimated from the 4 × 4 nearest
      original pixels. It gets bigger but gains no real detail, so it looks slightly soft.`;
    if (s.resize_mode === "exact" && s.exact_fit === "fill") r += " The parts that stick out of the frame are cut off.";
    if (s.resize_mode === "exact" && s.exact_fit === "stretch" && Math.abs(kx - ky) > 0.01)
      r += ` Width and height are scaled differently (÷${fmtN(kx)} and ÷${fmtN(ky)}), so shapes are distorted.`;
    if (s.resize_mode === "exact" && s.exact_fit === "pad") r += " Empty sides become borders in the background colour.";
  } else {
    r = `Shrinking: <b>area averaging</b> – each new pixel is the plain average of the original pixels it covers (no sharpening,
      nothing invented). Enlarging: <b>bicubic interpolation</b> from the 4 × 4 nearest pixels.`;
  }
  $("#howResize").innerHTML = HT(r + " Images and videos are treated the same way.");
  // frame rate
  let f;
  const src = isVideo ? S.info.fps : null, tgt = +s.fps || +$("#s_fps").value || 10;
  if (src && tgt && tgt >= src - 0.01) f = `This video already has ${fmtN(src)} fps – its frames are kept as they are.`;
  else {
    const ratio = src && tgt ? src / tgt : null;
    f = `Frames are only <b>picked, never blended or interpolated</b>: for every 1/${fmtN(tgt)} s, the original frame closest to that
      moment is kept and the others are dropped` + (ratio ? ` – here about 1 of every ${fmtN(ratio)} frames (${fmtN(src)} → ${fmtN(tgt)} fps)` : "") +
      `. Kept frames are not changed and the video lasts exactly as long as before.`;
    if (ratio && Math.abs(ratio - Math.round(ratio)) > 0.05)
      f += ` Because ${fmtN(src)} ÷ ${fmtN(tgt)} isn't a whole number, the gap between kept frames alternates (e.g. ${Math.floor(ratio)}, ${Math.ceil(ratio)}, ${Math.floor(ratio)}…) so the timing stays right.`;
    if (!isVideo) f += " (Select a video to see its numbers.)";
  }
  $("#howFps").innerHTML = HT(f);
  // saving
  const tr = s.background === "transparent";
  const vid = tr ? (s.transparent_video_format === "mov"
      ? "Videos are saved as <b>ProRes 4444 (.mov)</b>: practically lossless, full colour, transparency kept (big files)."
      : "Videos are saved as <b>VP9 (.webm)</b>: compressed (slight loss), transparency kept.")
    : `Videos are re-encoded once as <b>H.264 (MP4)</b> at quality ${s.crf}: a slight compression loss (hard to see at 20 or
       lower) and colour stored at half resolution (4:2:0, as in almost every video).`;
  const fmt = s.image_format === "same" ? "in their original type" : "as " + s.image_format.toUpperCase();
  const lossy = ["jpg", "webp"].includes(s.image_format) ? ` – slightly lossy (quality ${s.jpeg_quality})`
    : s.image_format === "same" ? " (PNG/TIFF lossless, JPEG/WebP at quality " + s.jpeg_quality + ")" : " – lossless";
  if (onlyJoin()) {
    $("#howSave").innerHTML = HT(`Only joining: the compressed video data of the parts is <b>copied one after the other</b>, nothing is
      decoded or re-encoded – every frame is bit-for-bit the original, same size, same frame rate, same quality, same file type.
      ${s.audio ? "Sound is kept (copied too)." : "Sound is removed."} Your original files are never touched.`);
    return;
  }
  $("#howSave").innerHTML = HT(`${vid} ${s.audio ? "Sound is kept (re-encoded)." : "Sound is removed."} Images are saved ${fmt}${lossy}.
    Nothing else is changed: no colour correction, no denoising, no sharpening. Your original files are never touched.`);
}

function updateStepHint() {
  const sel = S.files.filter((f) => S.checked.has(f.name)), n = sel.length, drawn = sel.filter((f) => f.roi).length;
  $("#stepIcon").textContent = "✏️";
  $("#editorTitle").textContent = n && drawn === n ? "All areas drawn – press Next ▶"
    : S.settings && S.settings.same_area ? "Draw the area once – it is used for all files" : "Draw the area to keep on each file";
  $("#drawProgress").textContent = n ? `${drawn} of ${n} drawn` : "";
  $("#drawProgress").classList.toggle("alldone", n > 0 && drawn === n);
}
function updateStatus(roi = roiFromPoints(S.shape, S.pts)) {
  explain();
  if (S.step === "draw") updateSaveBtn();
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
  if (!$("#home").classList.contains("hidden") || S.step !== "draw") return;
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
  if (!anyTask()) { toast("First pick what you want to do (Join, Crop, Resize or Frame rate).", true); return; }
  if (!(await leaveFile())) return;
  try {
    const d = await api("/api/folder", { path });
    S.folder = d.path; S.files = d.files; S.outputDir = d.output_dir; S.nextFree = d.next_free_output;
    $("#folderName").textContent = baseName(d.path); $("#folderPill").title = d.path + " – change folder (Home)";
    S.checked = new Set(S.files.map((f) => f.name));
    S.allowMissing = false; S.step = stepList()[0]; S.lastRun = null; S.lastResult = null; S.join = null;
    $("#jobs").innerHTML = ""; $("#afterRun").classList.add("hidden");
    hideHome();
    S.cur = -1; S.prevRoi = [...S.files].reverse().find((f) => f.roi)?.roi || null;
    $("#folderPath").value = d.path;
    fillRecent(d.recent);
    renderFiles(); renderRunSummary();
    if (joinOn()) await loadJoins();
    const first = S.files.findIndex((f) => !f.roi);
    if (S.files.length) { $("#emptyMsg").classList.add("hidden"); openFile(first >= 0 ? first : 0); }
    else { S.img = null; draw(); $("#emptyMsg").classList.remove("hidden"); $("#emptyMsg p").innerHTML = onlyJoin() ? "<b>No joined videos yet.</b>" : "<b>No videos or images</b> in this folder."; }
  } catch (e) { toast(e.message, true); }
}
async function refreshFiles() {
  if (!S.folder) return;
  try {
    const d = await api("/api/folder", { path: S.folder });
    const byName = Object.fromEntries(d.files.map((f) => [f.name, f]));
    const same = d.files.length === S.files.length && S.files.every((f) => byName[f.name]);
    if (!same) {          // joined videos added/removed or Join switched on/off: new list, keep the choices made
      const old = new Set(S.files.map((f) => f.name)), curName = S.files[S.cur] && S.files[S.cur].name;
      S.files = d.files;
      S.checked = new Set(S.files.map((f) => f.name).filter((n) => S.checked.has(n) || !old.has(n)));
      const ci = S.files.findIndex((f) => f.name === curName);
      if (ci < 0) { S.cur = -1; S.img = null; S.info = null; } else S.cur = ci;
    }
    S.files.forEach((f) => { const g = byName[f.name]; if (g) Object.assign(f, g); });
    S.outputDir = d.output_dir; S.nextFree = d.next_free_output; renderFiles(); renderRunSummary();
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

const selectedFiles = () => S.files.filter((f) => S.checked.has(f.name));
function visibleFiles() {
  return S.files.map((f, i) => [f, i]).filter(([f]) => S.filter === "all" || S.filter === f.kind ||
    (S.filter === "done" && f.done) || (S.filter === "new" && !f.done));
}
function renderFiles() {
  // step 1: which files
  $("#fileTable").innerHTML = visibleFiles().map(([f, i]) => {
    const on = S.checked.has(f.name);
    return `<div class="frow ${on ? "" : "off"}" data-i="${i}">
      <input type="checkbox" ${on ? "checked" : ""} title="Use this file">
      <span>${ficon(f)}</span>
      <span class="fn" title="${esc(f.parts ? f.parts.join(" + ") : f.name)}">${esc(dname(f))}</span>
      <span class="badges">${f.roi && cropOn() ? `<span class="badge roi">area drawn</span>` : ""}${f.done ? `<span class="badge prev" title="${esc(f.output || "")}">done before · ${esc(f.done_info || "")}</span>` : ""}</span>
      <span class="fs">${fmtBytes(f.bytes)}</span></div>`;
  }).join("") || '<p class="muted">No files match.</p>';
  $$("#fileTable .frow").forEach((row) => (row.onclick = () => {
    const f = S.files[+row.dataset.i];
    S.checked.has(f.name) ? S.checked.delete(f.name) : S.checked.add(f.name);
    renderFiles(); renderRunSummary();
  }));
  const sel = selectedFiles(), done = S.files.filter((f) => f.done);
  $("#fileSummary").textContent = S.folder ? `${S.files.length} file${S.files.length === 1 ? "" : "s"} in “${baseName(S.folder)}” · ${sel.length} selected` : "No folder open";
  $("#chkAll").checked = S.files.length > 0 && S.files.every((f) => S.checked.has(f.name));
  $("#doneNote").classList.toggle("hidden", !done.length);
  $("#doneNote").innerHTML = done.length ? `<b>${done.length} of these file${done.length === 1 ? " has" : "s have"} been processed before</b>
    (results in “${esc(baseName(S.outputDir))}”). That's fine: at the last step you choose whether to skip them,
    process them again, or save everything in a new folder.` : "";
  // step 2: the selected files, to draw on
  $("#fileList").innerHTML = S.files.map((f, i) => [f, i]).filter(([f]) => S.checked.has(f.name)).map(([f, i]) => `
    <li data-i="${i}" class="${i === S.cur ? "active" : ""}">
      <span>${f.roi ? "✅" : "⬜️"}</span><span>${ficon(f)}</span>
      <span class="fname" title="${esc(f.parts ? f.parts.join(" + ") : f.name)}">${esc(f.label || f.name)}</span><span></span>
      <span class="fsub">${f.roi ? (f.roi.shape === "full" ? "whole picture" : f.roi.shape) : "no area yet"}</span>
    </li>`).join("");
  $$("#fileList li").forEach((li) => (li.onclick = () => openFile(+li.dataset.i)));
  const drawn = sel.filter((f) => f.roi).length;
  $("#drawSummary").textContent = sel.length ? `${drawn} of ${sel.length} drawn` : "";
  updateStepHint(); updateNav();
}
$("#chkAll").onchange = (e) => {
  visibleFiles().forEach(([f]) => (e.target.checked ? S.checked.add(f.name) : S.checked.delete(f.name)));
  renderFiles(); renderRunSummary();
};
$("#fileFilter").onchange = (e) => { S.filter = e.target.value; renderFiles(); };

// ============================================================================ steps: one thing at a time
const STEP_NAME = { join: "Join videos", files: "Files", draw: "Draw areas", settings: "Settings", process: "Review & process", done: "Done" };
const stepList = () => [...(joinOn() ? ["join"] : []), "files", ...(cropOn() ? ["draw"] : []), "settings", "process", "done"];
function missingAreas() { return cropOn() ? selectedFiles().filter((f) => !f.roi) : []; }
function stepProblem(step) {
  // why you can't go past this step yet ("" = fine)
  if (step === "join") {
    if (!S.join) return "Loading…";
    if (!S.join.groups.length) return onlyJoin() ? "Make at least one group of videos to join." : "";
    const half = S.join.groups.find((g) => g.parts.length < 2);
    if (half) return `Add at least 2 videos to “${esc(half.name || "the new group")}” (or remove it).`;
    const bad = S.join.groups.find((g) => g.problems && g.problems.length);
    if (bad) return `“${esc(bad.name)}” can't be joined: ${esc(bad.problems.join(", "))}.`;
  }
  if (step === "files" && !selectedFiles().length) return onlyJoin() ? "Select at least one joined video." : "Select at least one file.";
  if (step === "draw") {
    const m = missingAreas().length;
    if (m && !S.allowMissing) return `${m} file${m === 1 ? "" : "s"} still without an area.`;
  }
  if (step === "process" && !S.lastResult) return "Press Process first.";   // "Done" exists only after a run
  return "";
}
function reachable(step) {
  const L = stepList();
  for (const s of L.slice(0, L.indexOf(step))) if (stepProblem(s)) return false;
  return true;
}
function renderStepper() {
  const L = stepList(), cur = L.indexOf(S.step);
  $("#stepper").innerHTML = L.map((k, i) => (i ? '<span class="stepline"></span>' : "") +
    `<button class="step ${k === S.step ? "cur" : i < cur ? "ok" : ""}" data-step="${k}" ${reachable(k) ? "" : "disabled"}>
      <span class="num">${i < cur ? "✓" : i + 1}</span>${STEP_NAME[k]}</button>`).join("");
  $$("#stepper .step").forEach((b) => (b.onclick = () => goStep(b.dataset.step)));
}
function updateNav() {
  if (!S.step) return;
  const L = stepList(), i = L.indexOf(S.step), next = L[i + 1];
  $("#btnBack").style.visibility = i > 0 ? "visible" : "hidden";
  // on Review the action is Process (the step moves on by itself); Done is the end
  $("#btnNext").classList.toggle("hidden", !next || S.step === "process");
  const prob = stepProblem(S.step);
  $("#btnNext").disabled = !!prob;
  // drawing areas: the bottom "Next" only appears (highlighted) once every file has its area
  const drawStep = S.step === "draw";
  if (drawStep && prob) $("#btnNext").classList.add("hidden");
  $("#btnNext").classList.toggle("ready", drawStep && !prob);
  if (drawStep) updateSaveBtn();
  if (next) $("#btnNext").textContent = `Next: ${STEP_NAME[next]} ▶`;
  let note = prob;
  if (S.step === "draw" && prob) {
    const keep = S.settings.no_roi === "full" ? "processed whole (no crop)" : "skipped";
    note = `${prob} <button class="linklike" id="btnAllowMissing">continue anyway – they'll be ${keep}</button>`;
  } else if (S.step === "draw" && missingAreas().length) {
    note = `${missingAreas().length} file(s) without area will be ${S.settings.no_roi === "full" ? "processed whole" : "skipped"}.`;
  } else if (S.step === "files" && !prob) note = `${selectedFiles().length} file${selectedFiles().length === 1 ? "" : "s"} selected`;
  else if (S.step === "join" && !prob) note = S.join.groups.length
    ? `${S.join.groups.length} video${S.join.groups.length === 1 ? "" : "s"} will be joined` : "No groups – nothing will be joined.";
  $("#stepNote").innerHTML = note;
  const b = $("#btnAllowMissing");
  if (b) b.onclick = () => { S.allowMissing = true; updateNav(); renderStepper(); };
  renderStepper();
}
function goStep(step) {
  const L = stepList();
  if (!L.includes(step)) step = L[0];
  if (!reachable(step)) return;
  if (S.step === "process" && step !== "process" && !S.polling) {   // leaving the results of the last run
    $("#jobs").innerHTML = ""; $("#afterRun").classList.add("hidden");
  }
  S.step = step;
  $$(".pane").forEach((p) => p.classList.toggle("on", p.dataset.pane === step));
  if (step === "draw") {
    const f = S.files[S.cur];
    if (!f || !S.checked.has(f.name)) {           // open the first selected file that still needs an area
      const i = S.files.findIndex((g) => S.checked.has(g.name) && !g.roi);
      const j = i >= 0 ? i : S.files.findIndex((g) => S.checked.has(g.name));
      if (j >= 0) openFile(j);
    }
    requestAnimationFrame(() => { resizeCanvas(); fitView(); });
  }
  if (step === "process") renderReview();
  if (step === "join") (S.join ? renderJoin() : loadJoins());
  if (step === "done") renderDone();
  updateNav();
}
$("#btnBack").onclick = () => { const L = stepList(); goStep(L[Math.max(0, L.indexOf(S.step) - 1)]); };
$("#btnNext").onclick = async () => {
  if (S.step === "draw" && S.dirty && roiFromPoints(S.shape, S.pts) && !(await saveRoi())) return;
  const L = stepList(); goStep(L[L.indexOf(S.step) + 1]);
};

async function leaveFile() {
  if (S.cur < 0 || !S.dirty || !cropOn()) return true;
  const roi = roiFromPoints(S.shape, S.pts);
  if (!roi) return true;
  if (confirm(`Save the area you drew on "${dname(S.files[S.cur])}" before leaving it?`)) return await saveRoi();
  return true;
}

// ============================================================================ step: join split recordings
// S.join = { videos: [{name, duration, size, fps, codec, created}], groups: [{name, parts, problems}], suggestions, sel }
async function loadJoins() {
  if (!S.folder) return;
  try {
    const d = await api("/api/joins?" + qs({ folder: S.folder }));
    S.join = { videos: d.videos, groups: d.groups, suggestions: d.suggestions, unreadable: d.unreadable, sel: 0 };
    // first time in this folder: use the suggestions straight away (they can be changed or removed)
    if (!d.saved && !d.groups.length && d.suggestions.length) {
      S.join.groups = d.suggestions.map((g) => ({ name: g.name, parts: [...g.parts], why: g.why }));
      await saveJoins();
      toast(`✨ Found ${d.suggestions.length} split recording${d.suggestions.length === 1 ? "" : "s"} – check the groups.`, false, 5000);
    }
  } catch (e) { toast(e.message, true); S.join = { videos: [], groups: [], suggestions: [], sel: 0 }; }
  if (S.step === "join") renderJoin();
  updateNav();
}
let joinTimer;
async function saveJoins(later = false) {
  clearTimeout(joinTimer);
  if (later) { joinTimer = setTimeout(() => saveJoins(), 500); return; }
  const J = S.join; if (!J) return;
  try {
    const full = J.groups.filter((g) => g.parts.length >= 2);
    const d = await api("/api/joins", { folder: S.folder, groups: full.map((g) => ({ name: g.name, parts: g.parts })) });
    d.groups.forEach((g, k) => { if (full[k]) full[k].problems = g.problems; });
    await refreshFiles();
  } catch (e) { toast(e.message, true); }
  if (S.step === "join") renderJoin();
  updateNav();
}
const vidInfo = (n) => (S.join.videos || []).find((v) => v.name === n) || {};
const fmtDur = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
const fmtCreated = (c) => { if (!c) return ""; const d = new Date(c); return isNaN(d) ? "" : d.toLocaleString([], { dateStyle: "short", timeStyle: "medium" }); };
function uniqueGroupName(base, skip) {
  const taken = new Set(S.join.groups.filter((g) => g !== skip).map((g) => g.name.toLowerCase()));
  let n = base, k = 2;
  while (taken.has(n.toLowerCase())) n = `${base}_${k++}`;
  return n;
}
function renderJoin() {
  const J = S.join; if (!J) return;
  const groupOf = {};
  J.groups.forEach((g, gi) => g.parts.forEach((n) => (groupOf[n] = gi)));
  J.sel = Math.min(J.sel, J.groups.length - 1);
  $("#joinGroups").innerHTML = J.groups.length ? J.groups.map((g, gi) => {
    const tot = g.parts.reduce((a, n) => a + (vidInfo(n).duration || 0), 0);
    const warn = g.parts.length < 2 ? "add at least one more video" : (g.problems || []).join(", ");
    let start = 0;
    return `<div class="jgroup ${gi === J.sel ? "sel" : ""} ${warn ? "bad" : ""}" data-g="${gi}">
      <div class="jghead"><span>🔗</span><input type="text" value="${esc(g.name)}" data-g="${gi}" title="Name of the joined video" spellcheck="false">
        <button class="ghost small" data-del="${gi}" title="Remove this group (the videos stay separate)">🗑</button></div>
      ${g.parts.map((n, k) => { const v = vidInfo(n), st = start; start += v.duration || 0;
        return `<div class="jpart"><span class="pn">${k + 1}</span><span class="pnm" title="${esc(n)}">${esc(n)}</span>
          <span class="pt" title="starts at ${fmtDur(st)} in the joined video">${fmtDur(st)} → ${fmtDur(start)}</span>
          <span class="pb"><button data-mv="${gi}:${k}:-1" ${k ? "" : "disabled"} title="Earlier">↑</button><button data-mv="${gi}:${k}:1" ${k < g.parts.length - 1 ? "" : "disabled"} title="Later">↓</button><button data-rm="${gi}:${k}" title="Take out of the group">✕</button></span></div>`; }).join("")}
      <div class="jgfoot"><span>${g.parts.length} parts · ${fmtDur(tot)} in total</span>${g.why ? `<span>suggested from ${esc(g.why)}</span>` : ""}
        ${warn ? `<span class="warn">⚠ ${esc(warn)}</span>` : ""}</div></div>`;
  }).join("") : `<div class="jempty"><b>No groups yet.</b><br>Press <b>✨ Suggest groups</b>, or <b>＋ New group</b> and add videos from the list.
      ${onlyJoin() ? "" : "<br><small>Without groups nothing is joined – that's fine too.</small>"}</div>`;
  $("#joinVids").innerHTML = (J.videos || []).map((v) => {
    const gi = groupOf[v.name], meta = [fmtDur(v.duration), v.size ? v.size.join("×") : "", v.fps ? (+v.fps).toFixed(2).replace(/\.?0+$/, "") + " fps" : "", fmtCreated(v.created)].filter(Boolean).join(" · ");
    return `<div class="jvid ${gi !== undefined ? "used" : ""}"><span class="vn" title="${esc(v.name)}">${esc(v.name)}<small>${meta}${gi !== undefined ? ` · in “${esc(J.groups[gi].name)}”` : ""}</small></span>
      <button data-add="${esc(v.name)}" ${gi === J.sel && J.groups.length ? "disabled" : ""} title="Add to the selected group">＋</button></div>`;
  }).join("") || '<p class="small muted">No videos in this folder.</p>';
  $("#joinVidsHint").textContent = J.groups.length ? `＋ adds a video to “${J.groups[J.sel].name || "the selected group"}”.` : "＋ starts a new group with that video.";
  const nv = (J.videos || []).length;
  $("#joinNote").classList.toggle("hidden", !(J.unreadable && J.unreadable.length));
  $("#joinNote").innerHTML = J.unreadable && J.unreadable.length ? `Could not read: ${J.unreadable.map(esc).join(", ")}` : "";
  $("#joinSub").innerHTML = `Each group becomes <b>one video</b>: its parts are played one after the other, in this order. ` +
    (onlyJoin() ? "Only joining: nothing is re-encoded." : "Then it is treated like any other video (one area, one result).") +
    (nv ? ` <span class="muted">${nv} video${nv === 1 ? "" : "s"} in the folder.</span>` : "");
  // events
  $$("#joinGroups .jgroup").forEach((el) => (el.onclick = (e) => { if (e.target.closest("button,input")) return; J.sel = +el.dataset.g; renderJoin(); }));
  $$("#joinGroups input[data-g]").forEach((inp) => {
    inp.onfocus = () => { if (J.sel !== +inp.dataset.g) { J.sel = +inp.dataset.g; $$("#joinGroups .jgroup").forEach((x) => x.classList.toggle("sel", +x.dataset.g === J.sel)); } };
    inp.oninput = () => { const g = J.groups[+inp.dataset.g]; g.name = inp.value.trim().replace(/[\\/:*?"<>|]+/g, "_"); saveJoins(true); };
    inp.onchange = () => { const g = J.groups[+inp.dataset.g]; g.name = uniqueGroupName(g.name || "joined", g); saveJoins(); };
  });
  $$("[data-del]").forEach((b) => (b.onclick = () => { J.groups.splice(+b.dataset.del, 1); J.sel = Math.max(0, J.sel - 1); saveJoins(); renderJoin(); }));
  $$("[data-mv]").forEach((b) => (b.onclick = () => {
    const [gi, k, d] = b.dataset.mv.split(":").map(Number), P = J.groups[gi].parts;
    [P[k], P[k + d]] = [P[k + d], P[k]]; delete J.groups[gi].why; saveJoins(); renderJoin();
  }));
  $$("[data-rm]").forEach((b) => (b.onclick = () => {
    const [gi, k] = b.dataset.rm.split(":").map(Number);
    J.groups[gi].parts.splice(k, 1); delete J.groups[gi].why;
    if (!J.groups[gi].parts.length) J.groups.splice(gi, 1);
    saveJoins(); renderJoin();
  }));
  $$("[data-add]").forEach((b) => (b.onclick = () => joinAdd(b.dataset.add)));
}
function joinAdd(name) {
  const J = S.join;
  J.groups.forEach((g) => (g.parts = g.parts.filter((n) => n !== name)));
  J.groups = J.groups.filter((g, gi) => g.parts.length || gi === J.sel);
  if (!J.groups.length) { J.groups.push({ name: "", parts: [] }); J.sel = 0; }
  const g = J.groups[Math.min(J.sel, J.groups.length - 1)];
  g.parts.push(name); delete g.why;
  if (!g.name) g.name = uniqueGroupName(name.replace(/\.[^.]+$/, "") + "_joined", g);
  saveJoins(); renderJoin();
}
$("#btnJoinNew").onclick = () => {
  const J = S.join; if (!J) return;
  const empty = J.groups.findIndex((g) => !g.parts.length);
  if (empty >= 0) J.sel = empty; else { J.groups.push({ name: "", parts: [] }); J.sel = J.groups.length - 1; }
  renderJoin(); toast("Now add the videos with ＋, in the order they were recorded.");
};
$("#btnJoinSuggest").onclick = async () => {
  await loadJoinsOnly();
  const J = S.join, sug = J.suggestions || [];
  if (!sug.length) return toast("No split recordings found from the names or recording times. Make a group by hand: ＋ New group.", false, 6000);
  const key = (gs) => JSON.stringify(gs.filter((g) => g.parts.length).map((g) => g.parts));
  if (key(J.groups) === key(sug)) return toast("The groups already match the suggestions.");
  if (J.groups.some((g) => g.parts.length) && !confirm(`Replace your groups with the ${sug.length} suggested one${sug.length === 1 ? "" : "s"}?`)) return;
  J.groups = sug.map((g) => ({ name: g.name, parts: [...g.parts], why: g.why })); J.sel = 0;
  await saveJoins(); renderJoin();
};
async function loadJoinsOnly() {   // fresh suggestions (files may have been added), keeping the groups as they are
  try { const d = await api("/api/joins?" + qs({ folder: S.folder })); S.join.videos = d.videos; S.join.suggestions = d.suggestions; }
  catch (e) { toast(e.message, true); }
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
  $("#fileTitle").innerHTML = `<b>${esc(dname(f))}</b> · ${meta} · ${fmtBytes(f.bytes)} <span class="muted">(${i + 1}/${S.files.length})</span>`;
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
  const part = (S.info.parts || []).filter((p) => p.start <= t + 1e-6).pop();
  $("#frameLabel").textContent = `${S.frameIdx + 1}/${n} · ${fmtTime(t)} / ${fmtTime(S.info.duration || 0)}` +
    (part ? ` · part ${S.info.parts.indexOf(part) + 1}: ${part.name}` : "") + (S.fullRes ? " · full res" : "");
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
    if (S.settings.same_area && cropOn()) await applySameArea(f.name, true);
    renderFiles(); renderRunSummary(); draw();
    return true;
  } catch (e) { toast(e.message, true); return false; }
}
// ---------------------------------------------------------------- one area for all files (fixed camera)
async function applySameArea(fromName, quiet = false) {
  const names = selectedFiles().map((f) => f.name);
  try {
    const d = await api("/api/roi/copy", { folder: S.folder, name: fromName, targets: "all", names });
    await refreshFiles();
    S.sizeSkipped = d.skipped || [];
    const msg = `Area of “${esc(fromName)}” used for ${d.copied.length + 1} file${d.copied.length ? "s" : ""}.` +
      (S.sizeSkipped.length ? ` <b>${S.sizeSkipped.length} file${S.sizeSkipped.length === 1 ? " has" : "s have"} a different size</b> – give ${S.sizeSkipped.length === 1 ? "it its" : "them their"} own area (⬜️ on the left).` : "");
    if (!quiet || S.sizeSkipped.length) toast(msg, false, 7000);
    updateAreaMode();
  } catch (e) { toast(e.message, true); }
}
function updateAreaMode() {
  const same = !!(S.settings && S.settings.same_area);
  $$("input[name=areamode]").forEach((r) => (r.checked = r.value === (same ? "same" : "each")));
  updateSaveBtn();
  const sk = (S.sizeSkipped || []).filter((n) => S.checked.has(n));
  $("#areaModeNote").innerHTML = same ? (sk.length ? `${sk.length} file(s) of another size need their own area`
                                                   : "draw once – every file of the same size gets it") : "";
}
$$("input[name=areamode]").forEach((r) => (r.onchange = async () => {
  const same = r.value === "same";
  await saveSettings({ same_area: same });
  updateAreaMode(); updateStepHint();
  if (!same || S.cur < 0) return;
  const f = S.files[S.cur];
  const valid = roiFromPoints(S.shape, S.pts);
  if (!valid && !f.roi) { toast("Now draw the area once – saving it gives it to every file."); return; }
  const others = selectedFiles().filter((g) => g.name !== f.name && g.roi).length;
  if (others && !confirm(`Give the area of “${f.name}” to all selected files? ${others} file(s) that already have their own area will get this one instead.`)) return;
  if (S.dirty && valid) await saveRoi();            // saving applies it to all
  else await applySameArea(f.name);
}));

// The button under the picture always shows the one useful thing to do on this file:
//   drawing not finished -> disabled · drawn, not saved -> "Save area (· next file)" · saved -> "Next file without area"
//   · all files have an area -> hidden (the bottom "Next: Settings" takes over)
function nextMissingIndex() {
  let k = S.files.findIndex((g, n) => n > S.cur && S.checked.has(g.name) && !g.roi);
  if (k < 0) k = S.files.findIndex((g, n) => n !== S.cur && S.checked.has(g.name) && !g.roi);
  return k;
}
function saveBtnState() {
  const f = S.files[S.cur];
  if (!f || !cropOn()) return { mode: "hidden" };
  const valid = !!roiFromPoints(S.shape, S.pts);
  const unsaved = S.dirty && valid;
  const othersMissing = selectedFiles().filter((g) => g.name !== f.name && !g.roi).length;
  const same = !!S.settings.same_area;
  if (unsaved) {
    if (same) return { mode: "save", label: "✔ Use for all files" + (othersMissing ? " ▶" : "") };
    return { mode: "save", label: othersMissing ? "✔ Save area · next file ▶" : "✔ Save area" };
  }
  if (!f.roi) return { mode: "disabled", label: S.shape === "full" ? "✔ Use the whole picture" : "Draw the area first" };
  if (othersMissing) return { mode: "next", label: "Next file without area ▶" };
  return { mode: "hidden" };
}
function updateSaveBtn() {
  const st = saveBtnState(), b = $("#btnSaveNext");
  b.classList.toggle("hidden", st.mode === "hidden");
  // "Whole" needs no points: allow saving it directly
  const full = S.shape === "full" && S.files[S.cur] && !S.files[S.cur].roi;
  b.disabled = st.mode === "disabled" && !full;
  if (st.label) b.innerHTML = st.label;
}
async function saveAndNext() {
  if (S.cur < 0 || !cropOn()) return;
  const st = saveBtnState(), f = S.files[S.cur];
  const full = S.shape === "full" && !f.roi;
  if (st.mode === "hidden") { if (!stepProblem("draw")) $("#btnNext").click(); return; }
  if (st.mode === "disabled" && !full) { toast(`${S.shape}: ${HINT[S.shape]} first.`); return; }
  if (st.mode === "save" || full) { if (!(await saveRoi())) return; }
  const k = nextMissingIndex();
  if (k >= 0) openFile(k);
  else { updateSaveBtn(); updateNav(); toast("✔ Every file has its area – press <b>Next: Settings ▶</b>.", false, 5000); }
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
const CHK = ["uniform", "audio", "hwaccel", "allow_upscale"];   // (redoing earlier results is chosen at the Review step)
const colorToHex = (c) => { const x = document.createElement("canvas").getContext("2d"); x.fillStyle = "#000"; x.fillStyle = c; return x.fillStyle; };

function fillSettings(s) {
  NUM.forEach((k) => ($("#s_" + k).value = s[k]));
  SEL.forEach((k) => ($("#s_" + k).value = s[k]));
  CHK.forEach((k) => ($("#s_" + k).checked = !!s[k]));
  $(`input[name=frame][value=${s.uniform ? "same" : "area"}]`).checked = true;
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
  explain();
}
function collectSettings() {
  const s = {};
  NUM.forEach((k) => (s[k] = +$("#s_" + k).value));
  SEL.forEach((k) => (s[k] = $("#s_" + k).value));
  CHK.forEach((k) => (s[k] = $("#s_" + k).checked));
  if (cropOn()) s.uniform = $("input[name=frame]:checked").value === "same";
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
$$("[id^=s_], input[name=bg], input[name=resize_mode], input[name=frame], #bgColor").forEach((el) => {
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
  if (t.join) parts.push("join");
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
  updateNav();
  if (S.step === "process" && !S.polling) renderReview();
}
function planFiles() {
  // which selected files will really be processed (crop: those with an area, unless "whole picture")
  const s = S.settings, sel = selectedFiles();
  return !s.tasks.crop || s.no_roi === "full" ? sel : sel.filter((f) => f.roi);
}
function renderReview() {
  const s = S.settings, t = s.tasks, use = planFiles();
  const nv = use.filter((f) => f.kind === "video").length, ni = use.length - nv;
  const lines = [], nj = use.filter((f) => f.parts).length;
  lines.push(["📁", `${use.length} file${use.length === 1 ? "" : "s"} (${nv} video${nv === 1 ? "" : "s"}, ${ni} image${ni === 1 ? "" : "s"})`,
    `from “${esc(baseName(S.folder))}”` + (selectedFiles().length > use.length ? ` · ${selectedFiles().length - use.length} without area skipped` : "")]);
  if (t.join) lines.push(["🔗", nj ? `Join ${nj} split recording${nj === 1 ? "" : "s"}` : "Join: no joined videos selected",
    (onlyJoin() ? "parts copied one after the other – nothing re-encoded, pictures unchanged" : "parts played one after the other, then the steps below run on the whole video") +
    (nj ? " · " + use.filter((f) => f.parts).map((f) => `${esc(f.label)} = ${f.parts.length} parts`).join(", ") : "")]);
  if (t.fps) lines.push(["⏱", `Frame rate → ${s.fps} fps`, "frames are picked (the one closest to every 1/" + s.fps + " s), never blended" + (nv ? "" : " · no videos selected, nothing to change")]);
  if (t.crop) lines.push(["✂️", "Crop to the areas you drew", "pixels inside copied exactly · outside " + (s.background === "transparent" ? "transparent" : esc(s.background))]);
  if (t.resize) lines.push(["⤡", s.resize_mode === "percent" ? `Resize to ${s.percent} %` : s.resize_mode === "exact" ? `Resize to exactly ${s.out_w} × ${s.out_h} px` : `Resize to fit in ${s.out_w} × ${s.out_h} px`,
    "shrinking: area averaging · enlarging: bicubic" + (s.resize_mode === "exact" ? ` · ${({ pad: "borders added", fill: "edges cut", stretch: "stretched" })[s.exact_fit]}` : "")]);
  const fmt = onlyJoin() ? "same format as the parts (no re-encoding)" : s.background === "transparent" ? (s.transparent_video_format === "mov" ? "videos .mov (ProRes)" : "videos .webm") : `videos MP4 (H.264, quality ${s.crf})`;
  lines.push(["💾", `Save to “${esc(baseName(S.outputDir))}”`, `${fmt}${ni ? ` · images ${s.image_format === "same" ? "same type" : s.image_format.toUpperCase()}` : ""}${nv && s.audio ? " · sound kept" : ""}`]);
  $("#review").innerHTML = lines.map(([ic, b, sm], i) => `<div class="rline"><span class="rn">${i ? i : ic}</span><div><b>${b}</b><small>${sm}</small></div></div>`).join("");
  // files that already have a result
  const prev = use.filter((f) => f.done);
  const box = $("#existingBox");
  box.classList.toggle("hidden", !prev.length);
  if (prev.length) {
    const choice = S.existing || "skip";
    box.innerHTML = `<h3>⚠️ ${prev.length} of these file${prev.length === 1 ? " was" : "s were"} already processed before</h3>
      <ul>${prev.slice(0, 50).map((f) => `<li>${esc(dname(f))} → ${esc(f.output || "")} <span class="muted">(${esc(f.done_info || "")})</span></li>`).join("")}</ul>
      <label><input type="radio" name="existing" value="skip" ${choice === "skip" ? "checked" : ""}><span><b>Skip them</b> – ${use.length - prev.length ? `only process the ${use.length - prev.length} new file${use.length - prev.length === 1 ? "" : "s"}` : "nothing new to process"}
        <small>The earlier results stay as they are.</small></span></label>
      <label><input type="radio" name="existing" value="replace" ${choice === "replace" ? "checked" : ""}><span><b>Process them again</b> and replace the earlier results
        <small>Useful if you changed an area or a setting.</small></span></label>
      <label><input type="radio" name="existing" value="new" ${choice === "new" ? "checked" : ""}><span><b>Save everything in a new folder</b>: “${esc(baseName(S.nextFree || ""))}”
        <small>Keeps the earlier results and makes a complete new set next to them.</small></span></label>`;
    $$("input[name=existing]").forEach((r) => (r.onchange = () => { S.existing = r.value; renderReview(); }));
  }
  const n = prev.length && (S.existing || "skip") === "skip" ? use.length - prev.length : use.length;
  $("#btnProcess").textContent = n ? `▶ Process ${n} file${n === 1 ? "" : "s"}` : "Nothing new to process";
  $("#btnProcess").disabled = !n || !!S.polling;
  $("#runSummary").textContent = !n && use.length ? "All selected files were done before – choose “Process them again” or “new folder” above." : "";
}

// ---------------------------------------------------------------- step 5: done
function renderDone() {
  const r = S.lastResult; if (!r) return;
  const c = (st) => r.jobs.filter((j) => j.status === st).length;
  const out = (r.batch && r.batch.output_dir) || S.outputDir;
  const nd = c("done"), nf = c("failed"), ns = c("skipped"), nc = c("cancelled");
  const title = nf || nc ? (nd ? "Finished, with problems" : "Nothing was made") : "All done";
  const sub = [`${nd} new result${nd === 1 ? "" : "s"} in “${esc(baseName(out))}”`];
  if (ns) sub.push(`${ns} kept from before`);
  if (nf) sub.push(`<b style="color:var(--danger)">${nf} failed</b>`);
  if (nc) sub.push(`${nc} stopped`);
  if (r.took) sub.push(r.took.replace(/^ in /, "took "));
  const label = { done: "✔ new result", skipped: "kept from before", failed: "✖ failed", cancelled: "stopped", queued: "not started" };
  $("#doneBox").innerHTML = `
    <div class="donehero ${nf || nc ? "warn" : ""}"><div class="big">${nf || nc ? "⚠️" : "✔"}</div>
      <div><h2>${title}</h2><p>${sub.join(" · ")}</p>
      <p class="small">${esc(out)}</p></div></div>
    <div class="doneactions">
      <button class="primary big" id="dnShow">📂 Show results</button>
      <button class="big" id="dnAnother">Process another folder</button>
      <button class="ghost" id="dnAgain">Change settings &amp; run again</button>
    </div>
    <div class="donelist">${r.jobs.map((j) => `<div class="drow ${j.status}">
      <span>${ficon(j)}</span><span class="dn">${esc(j.label || j.name)}${j.parts ? ` <small class="muted">(${j.parts.length} parts)</small>` : ""} → ${esc(j.output)}</span>
      <span class="ds">${label[j.status] || j.status}${j.status === "failed" ? ": " + esc(j.text || "") : ""}</span></div>`).join("")}</div>
    <p class="small muted" style="margin-top:12px">The crop, scale and methods used for each file are saved in
      <code>processing_params.json</code> in the results folder.</p>`;
  $("#dnShow").onclick = () => api("/api/reveal", { path: out }).catch((e) => toast(e.message, true));
  $("#dnAnother").onclick = showHome;
  $("#dnAgain").onclick = () => goStep("settings");
}

// ============================================================================ processing
$("#btnProcess").onclick = async () => {
  if (S.dirty && roiFromPoints(S.shape, S.pts) && confirm("Save the area you are drawing first?")) await saveRoi();
  try {
    const names = S.files.filter((f) => S.checked.has(f.name)).map((f) => f.name);
    const d = await api("/api/process", { folder: S.folder, names, existing: S.existing || "skip" });
    S.lastRun = d.batch; S.lastResult = null; $("#afterRun").classList.add("hidden");
    document.body.classList.add("running");
    renderJobs(d.jobs, true);
    startPolling();
  } catch (e) { toast(e.message, true, 6000); }
};
$("#btnCancel").onclick = async () => { await api("/api/cancel", {}); toast("Cancelling…"); };
$("#btnRevealOut").onclick = async () => {
  const dir = (S.lastRun && S.lastRun.output_dir) || S.outputDir;
  if (!dir) return toast("Open a folder first.");
  api("/api/reveal", { path: dir }).catch((e) => toast(e.message, true));
};

function renderJobs(jobs, busy) {
  const now = Date.now() / 1000;
  $("#jobs").innerHTML = jobs.map((j) => {
    let eta = "";
    if (j.status === "running" && j.started && j.progress > 0.02) eta = ` · ${fmtTime((now - j.started) * (1 - j.progress) / j.progress)} left`;
    const pct = Math.round((j.progress || 0) * 100);
    const label = { queued: "waiting", running: `${pct}%`, done: "✔ done", failed: "✖ failed", skipped: "skipped", cancelled: "cancelled" }[j.status];
    return `<div class="job ${j.status}">
      <div class="jl"><span class="jn" title="${esc(j.label || j.name)} → ${esc(j.output)}">${ficon(j)} ${esc(j.label || j.name)}</span><span>${label}</span></div>
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
        // (the Done step shows the summary – no extra pop-up)
        await refreshFiles();
        document.body.classList.remove("running");
        S.lastResult = { jobs: d.jobs, batch: d.batch, took };
        S.existing = null; $("#btnProcess").disabled = false;
        goStep("done");
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
  const t = T(), names = { join: "Join", crop: "Crop", resize: "Resize", fps: "Frame rate" };
  $("#taskChips").innerHTML = Object.keys(names).filter((k) => t[k]).map((k) => `<span class="chip">${names[k]}</span>`).join("") ||
    '<span class="chip off">nothing</span>';
}
function applyTasks() {
  const t = T(), s = S.settings;
  document.body.classList.toggle("nocrop", !t.crop);
  $("#cardCrop").classList.toggle("hidden", !t.crop);
  $("#cardResize").classList.toggle("hidden", !t.resize);
  $("#cardFps").classList.toggle("hidden", !t.fps);
  const exact = t.resize && s.resize_mode === "exact", fit = t.resize && s.resize_mode === "fit";
  document.body.classList.toggle("joinonly", onlyJoin());
  // the size of the results: with Crop it's chosen in the Crop card ("just the area" / "same frame"); without Crop the
  // same-size option sits in Resize; exact size implies it. Just the area and no Resize = no size to set at all.
  $("#fsFrame").classList.toggle("hidden", !t.crop || exact);
  $("#uniformRow").classList.toggle("hidden", t.crop || !t.resize || exact);
  $("#uniformTxt").textContent = fit ? `Every result exactly ${s.out_w} × ${s.out_h} (borders added)` : "Every result the same size (of the biggest one)";
  $("#sizeLbl").textContent = exact ? "Size of every result" : fit && s.uniform ? "Frame size (every result)" : "Maximum size";
  $("#frameNote").textContent = !t.crop || exact ? "" : s.uniform
    ? (fit ? `Every result is ${s.out_w} × ${s.out_h} px, the area centred.` : "Every result gets the size of the biggest area, the area centred.")
    : t.resize ? "Each result is just its area, shrunk to the size set in Resize – no borders, sizes can differ."
    : "Each result is just its area at its original pixels – no borders, no size to set.";
  // the background choice lives in the Crop card; without crop it moves to "Save to" (for borders)
  const bg = $("#fsBackground");
  if (t.crop && bg.parentElement.id !== "cardCrop") $("#cardCrop h3").after(bg);
  if (!t.crop && bg.parentElement.id !== "bgHolder") $("#bgHolder").appendChild(bg);
  bg.classList.toggle("hidden", !(t.crop || exact || (t.resize && s.uniform)));
  $("#transpOpts").classList.toggle("hidden", s.background !== "transparent");

  $("#drawInfo").dataset.help = t.crop ? "draw" : "preview";
  updateAreaMode();
  $("#settingsSub").textContent = "Done in this order: " + ["join", "fps", "crop", "resize"].filter((k) => t[k])
    .map((k) => ({ join: "join", fps: "frame rate", crop: "crop", resize: "resize" }[k])).concat(["save"]).join(" → ");
  renderChips(); renderFiles(); renderRunSummary(); draw();
}
function renderHome() {
  const t = T();
  $$(".task[data-task]").forEach((b) => b.classList.toggle("on", !!t[b.dataset.task]));
  const any = anyTask();
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
  applyTasks();
  goStep(stepList().includes(S.step) ? S.step : stepList()[0]);
}
$$(".task[data-task]").forEach((b) => (b.onclick = async () => {
  const k = b.dataset.task;
  await saveSettings({ tasks: { ...T(), [k]: !T()[k] } }); renderHome();
}));
$("#btnHome").onclick = $("#taskChips").onclick = $("#folderPill").onclick = showHome;
$("#btnContinue").onclick = async () => {
  if (!anyTask()) return;
  if (S.folder) await refreshFiles();
  if (joinOn() && S.folder && !S.join) await loadJoins();
  hideHome();
};
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
    S.sys.shortcut = true; $("#iconText").textContent = "(✔ created)";
    toast("✔ App icon created. " + esc(d.hint), false, 12000);
  } catch (e) { toast(e.message, true, 8000); }
  $("#btnMakeIcon").disabled = false;
};

// ============================================================================ settings window
async function renderSettingsModal() {
  $("#setVersion").textContent = S.sys.version;
  $("#s_update_check").checked = !!S.settings.update_check;
  $("#s_update_auto").checked = !!S.settings.update_auto;
  const st = await api("/api/app-status").catch(() => null);
  if (!st) return;
  $("#autostart").checked = !!st.autostart;
  const mac = /Mac/.test(navigator.platform);
  if (st.installed) {
    $("#appStatus").innerHTML = `<b>✔ CropKit is installed as an app.</b> Use it from ${mac ? "Applications / Launchpad – and keep it in the Dock (right-click its Dock icon → Options → Keep in Dock)" : "the Start menu – right-click its taskbar icon → Pin to taskbar"}.`;
    $("#btnInstallApp").classList.add("hidden");
  } else {
    $("#btnInstallApp").classList.remove("hidden");
    if (!st.browser) $("#installRes").textContent = "Needs Chrome, Edge or Brave.";
  }
  if (S.sys.shortcut || st.launcher) $("#iconText").textContent = "(✔ created)";
}
function openSettingsModal() { renderSettingsModal(); $("#settingsModal").classList.remove("hidden"); }
$("#btnSettings").onclick = openSettingsModal;
$$("[data-open=settings]").forEach((b) => (b.onclick = openSettingsModal));
$("#btnSetCheck").onclick = () => { closeModals(); openUpdates(); };

// ---------------------------------------------------------------- install as an app (PWA)
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; drawInstallBox(); });
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  const mac = /Mac/.test(navigator.platform);
  $("#installBox").innerHTML = `<p><b>✔ CropKit is installed.</b></p><ol class="small">
    <li>${mac ? "It is in your <b>Applications</b> folder (also Launchpad and Spotlight). While it is open, right-click its Dock icon → <i>Options</i> → <b>Keep in Dock</b>."
               : "It is in the <b>Start menu</b>. While it is open, right-click its taskbar icon → <b>Pin to taskbar</b>."}</li>
    <li>From now on, open CropKit with that icon. Your browser won't open with it any more.</li>
    <li>You can close this browser tab.</li></ol>`;
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => { /* not essential */ });
function drawInstallBox() {
  const box = $("#installBox"); if (!box) return;
  if (installPrompt) {
    box.innerHTML = '<p><button class="go big" id="btnDoInstall">⬇ Install CropKit</button></p>';
    $("#btnDoInstall").onclick = async () => { installPrompt.prompt(); await installPrompt.userChoice.catch(() => null); };
  } else if (!box.innerHTML.includes("✔")) {
    box.innerHTML = `<p class="small">Use your browser's install option:</p><ul class="small">
      <li><b>Chrome / Brave</b>: the install icon ⊕ at the right of the address bar, or menu ⋮ → <i>Cast, save and share</i> → <b>Install page as app…</b></li>
      <li><b>Edge</b>: menu … → <i>Apps</i> → <b>Install this site as an app</b></li></ul>`;
  }
}
$("#btnInstallApp").onclick = async () => {
  if (installPrompt) { installPrompt.prompt(); return; }
  try {
    const d = await api("/api/install-app", {});
    $("#installRes").textContent = `CropKit opened in ${d.browser || "your browser"} – click “Install CropKit” there.`;
  } catch (e) { toast(e.message, true); }
};
$("#autostart").onchange = async (e) => {
  try {
    const d = await api("/api/autostart", { on: e.target.checked }); e.target.checked = d.autostart;
    toast(d.autostart ? "CropKit will start in the background when you log in, so the app opens instantly." : "CropKit won't start by itself any more.");
  } catch (err) { e.target.checked = !e.target.checked; toast(err.message, true); }
};
if (location.hash === "#install-app") {
  history.replaceState(null, "", "/");
  drawInstallBox(); $("#installModal").classList.remove("hidden");
  setTimeout(drawInstallBox, 1500);
}

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
