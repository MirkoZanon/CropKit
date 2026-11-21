"""CropKit – crop images and videos to a region of interest, downsample them and save them in one
common format. Runs on your computer; the browser is only its window (http://127.0.0.1:5056).

Start:  python app.py            (or double-click start.command / start.bat)
Options: --port N   --no-browser
"""
from __future__ import annotations

import argparse
import io
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory

import media
import updater
import launcher
from launcher import open_ui

APP_DIR = Path(__file__).resolve().parent
VERSION = updater.read_version()
DATA_DIR = Path.home() / ".cropkit"
SETTINGS_FILE = DATA_DIR / "settings.json"
BACKUP_DIR = DATA_DIR / "backups"          # app backups made before each update
LOG_PATH = DATA_DIR / "cropkit.log"         # output when started from the app icon (no Terminal)
DEFAULT_PORT = 5056

DEFAULTS = {
    "tasks": {"crop": True, "resize": True, "fps": True},   # what to do (chosen on the Home screen)
    "output_dir": "",               # "" -> <input folder>/<output_subfolder>
    "output_subfolder": "cropped",
    "resize_mode": "fit",           # "fit" inside out_w x out_h | "exact" out_w x out_h | "percent"
    "out_w": 720, "out_h": 720,
    "percent": 50,
    "exact_fit": "pad",             # exact size: "pad" (borders) | "fill" (cut edges) | "stretch"
    "allow_upscale": False,         # fit: also enlarge pictures smaller than the box
    "uniform": True,                # all outputs the same frame size (ROI centred)
    "scale_mode": "fit",            # "fit" | "same_scale"
    "fps": 10,
    "background": "black",          # colour, or "transparent"
    "transparent_video_format": "mov",
    "image_format": "same",         # same | png | jpg | webp | tif
    "jpeg_quality": 92,
    "crf": 20,
    "preset": "veryfast",
    "audio": False,
    "hwaccel": True,
    "parallel": 2,
    "no_roi": "skip",               # files without ROI: "skip" | "full"
    "overwrite": False,
    "preview_n": 40,
    "default_shape": "circle",
    "recent_folders": [],
    "update_check": True,           # look for new versions on GitHub (once every 12 h)
    "update_auto": True,            # install them automatically when CropKit starts
    "update_cache": {},
    "just_updated": {},
}

app = Flask(__name__, static_folder=str(APP_DIR / "static"), static_url_path="/static")
app.json.sort_keys = False


# ============================================================================ settings
def load_settings() -> dict:
    s = dict(DEFAULTS)
    try:
        old = json.loads(SETTINGS_FILE.read_text())
        if "tasks" not in old and old.get("size_mode") == "original":   # settings of version 1.0/1.1
            old["tasks"] = {"crop": True, "resize": False, "fps": True}
        s.update(old)
    except Exception:
        pass
    s["tasks"] = {**DEFAULTS["tasks"], **(s.get("tasks") or {})}
    return s


def save_settings(s: dict):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = SETTINGS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(s, indent=2))
    os.replace(tmp, SETTINGS_FILE)


def clean_settings(new: dict, old: dict) -> dict:
    """Validate values coming from the page; keep the old value when one is invalid."""
    s = dict(old)
    def num(k, lo, hi, cast=int):
        try:
            v = cast(new[k])
            if lo <= v <= hi:
                s[k] = v
        except (KeyError, TypeError, ValueError):
            pass
    def choice(k, options):
        if new.get(k) in options:
            s[k] = new[k]
    def flag(k):
        if k in new:
            s[k] = bool(new[k])
    num("out_w", 16, 16384); num("out_h", 16, 16384)
    s["out_w"] -= s["out_w"] % 2; s["out_h"] -= s["out_h"] % 2
    num("fps", 0, 240, float)
    num("percent", 1, 1000, float)
    num("jpeg_quality", 10, 100); num("crf", 0, 51); num("parallel", 1, 8); num("preview_n", 5, 200)
    choice("resize_mode", ("fit", "exact", "percent")); choice("exact_fit", ("pad", "fill", "stretch"))
    choice("scale_mode", ("fit", "same_scale"))
    if isinstance(new.get("tasks"), dict):
        s["tasks"] = {k: bool(new["tasks"].get(k, s["tasks"].get(k))) for k in ("crop", "resize", "fps")}
    choice("transparent_video_format", ("mov", "webm")); choice("image_format", ("same", "png", "jpg", "webp", "tif"))
    choice("preset", ("ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow"))
    choice("no_roi", ("skip", "full")); choice("default_shape", media.SHAPES)
    for k in ("uniform", "audio", "hwaccel", "overwrite", "update_check", "update_auto", "allow_upscale"):
        flag(k)
    if "background" in new:
        bg = str(new["background"]).strip()
        if bg == "transparent":
            s["background"] = bg
        else:
            try:
                media.parse_color(bg); s["background"] = bg
            except ValueError:
                pass
    if "output_dir" in new:
        s["output_dir"] = str(new["output_dir"]).strip()
    if "output_subfolder" in new and str(new["output_subfolder"]).strip():
        s["output_subfolder"] = str(new["output_subfolder"]).strip().strip("/\\")
    return s


SETTINGS = load_settings()
SETTINGS_LOCK = threading.Lock()


def output_dir_for(folder: Path, s: dict) -> Path:
    return Path(s["output_dir"]).expanduser() if s["output_dir"] else Path(folder) / s["output_subfolder"]


# ============================================================================ helpers
def _folder(arg) -> Path:
    p = Path(str(arg or "")).expanduser()
    if not p.is_dir():
        raise FileNotFoundError(f"Folder not found: {p}")
    return p


def _file(folder, name) -> Path:
    f = _folder(folder) / name
    if not f.is_file() or f.parent.resolve() != _folder(folder).resolve():
        raise FileNotFoundError(f"File not found: {name}")
    return f


@app.errorhandler(Exception)
def on_error(e):
    code = 404 if isinstance(e, FileNotFoundError) else getattr(e, "code", 500)
    if not isinstance(code, int):
        code = 500
    return jsonify(error=str(e)), code


def pick_folder_dialog(prompt="Choose a folder") -> str:
    """Native folder dialog, in its own process so it can never freeze the server."""
    if sys.platform == "darwin":
        r = subprocess.run(["osascript", "-e", "activate", "-e",
                            f'POSIX path of (choose folder with prompt "{prompt}")'],
                           capture_output=True, text=True)
        return r.stdout.strip().rstrip("/") if r.returncode == 0 else ""
    code = ("import tkinter as tk; from tkinter import filedialog; r = tk.Tk(); r.withdraw(); "
            "r.attributes('-topmost', True); "
            f"print(filedialog.askdirectory(title={prompt!r})); r.destroy()")
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, **media._no_window())
    return r.stdout.strip()


def reveal(path: Path):
    path = Path(path)
    if sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    elif os.name == "nt":
        os.startfile(str(path))  # noqa: S606
    else:
        subprocess.Popen(["xdg-open", str(path)])


# ============================================================================ routes: basics
@app.get("/")
def index():
    return send_from_directory(APP_DIR / "static", "index.html")


@app.get("/api/ping")
def ping():
    return jsonify(app="CropKit", version=VERSION)


@app.get("/api/state")
def state():
    ucfg = updater.config()
    return jsonify(version=VERSION, settings=SETTINGS, update_repo=ucfg["repo"], git_copy=updater.is_git_checkout(),
                   shortcut=launcher.shortcut_exists(), defaults=DEFAULTS, platform=sys.platform,
                   ffmpeg=media.FFMPEG, ffmpeg_version=media.ffmpeg_version(),
                   video_exts=sorted(media.VIDEO_EXTS), image_exts=sorted(media.IMAGE_EXTS),
                   python=sys.version.split()[0])


@app.post("/api/settings")
def set_settings():
    global SETTINGS
    with SETTINGS_LOCK:
        SETTINGS = clean_settings(request.get_json(force=True) or {}, SETTINGS)
        save_settings(SETTINGS)
    return jsonify(settings=SETTINGS)


@app.post("/api/settings/reset")
def reset_settings():
    global SETTINGS
    with SETTINGS_LOCK:
        recent = SETTINGS.get("recent_folders", [])
        SETTINGS = dict(DEFAULTS, recent_folders=recent, update_cache=SETTINGS.get("update_cache", {}))
        save_settings(SETTINGS)
    return jsonify(settings=SETTINGS)


@app.post("/api/pick-folder")
def pick_folder():
    prompt = (request.get_json(silent=True) or {}).get("prompt", "Choose a folder")
    return jsonify(path=pick_folder_dialog(prompt))


@app.post("/api/reveal")
def reveal_route():
    p = Path((request.get_json(force=True) or {}).get("path", "")).expanduser()
    if not p.exists():
        raise FileNotFoundError(f"{p} does not exist (yet)")
    reveal(p)
    return jsonify(ok=True)


@app.post("/api/shortcut")
def make_shortcut():
    """Create the CropKit app icon (Mac: Applications + Desktop; Windows: Desktop + Start menu)."""
    port = int(request.host.rsplit(":", 1)[-1]) if ":" in (request.host or "") else DEFAULT_PORT
    desktop = (request.get_json(silent=True) or {}).get("desktop", True) is not False
    try:
        res = launcher.create_shortcut(port, LOG_PATH, VERSION, desktop=desktop)
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        raise RuntimeError(f"The icon could not be created: {exc}") from exc
    return jsonify(res)


# ---------------------------------------------------------------------------- installable app (PWA)
SW_JS = r"""// CropKit service worker: only shows a "CropKit isn't running" page when the installed app is opened
// while CropKit is stopped. Nothing is cached: the app always loads fresh from this computer.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
const OFFLINE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CropKit</title><style>
body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#f3f4f6;color:#1d2330;
font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}
.box{max-width:430px;padding:24px}h1{font-size:20px;margin:10px 0 8px}p{color:#6b7280;margin:6px 0 18px}
a.btn{display:inline-block;background:#2f6fde;color:#fff;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:10px}
.small{font-size:12.5px}</style></head><body><div class="box"><div style="font-size:42px">✂️</div>
<h1>CropKit isn't running</h1><p>CropKit just needs to be started on this computer.</p>
<a class="btn" href="cropkit://start">▶ Start CropKit</a>
<p class="small">If the button does nothing: double-click <b>start.command</b> (Mac) or <b>start.bat</b> (Windows) in the
CropKit folder. This window opens CropKit as soon as it is running.</p></div>
<script>setInterval(()=>fetch('/api/ping',{cache:'no-store'}).then(r=>{if(r.ok)location.reload()}).catch(()=>{}),2000)</script>
</body></html>`;
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, {headers: {'Content-Type': 'text/html; charset=utf-8'}})));
});
"""


@app.get("/sw.js")
def service_worker():
    return Response(SW_JS, mimetype="text/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/manifest.webmanifest")
def web_manifest():
    data = {"name": "CropKit", "short_name": "CropKit", "id": "/", "start_url": "/", "scope": "/",
            "display": "standalone", "launch_handler": {"client_mode": ["focus-existing", "auto"]},
            "background_color": "#f3f4f6", "theme_color": "#f3f4f6",
            "description": "Crop, resize and change the frame rate of videos and images",
            "icons": [{"src": f"/static/icons/icon-{n}.png?v={VERSION}", "sizes": f"{n}x{n}", "type": "image/png",
                       "purpose": "any"} for n in (192, 512)]}
    return Response(json.dumps(data), mimetype="application/manifest+json", headers={"Cache-Control": "no-cache"})


def _port_of_request() -> int:
    return int(request.host.rsplit(":", 1)[-1]) if ":" in (request.host or "") else DEFAULT_PORT


@app.get("/api/app-status")
def app_status():
    b = launcher.app_browser()
    return jsonify(installed=launcher.installed_app(), autostart=launcher.autostart_enabled(),
                   launcher=launcher.shortcut_exists(), browser=b and Path(str(b)).stem)


@app.post("/api/install-app")
def install_app():
    """Prepare everything for the installed app, then open CropKit in a normal browser tab, where the
    browser offers to install it ("Install CropKit")."""
    port = _port_of_request()
    try:   # the hidden helper that starts CropKit when the installed app is opened while CropKit is stopped
        launcher.create_shortcut(port, LOG_PATH, VERSION, desktop=False, reveal=False)
    except Exception:  # noqa: BLE001 - not essential for installing
        pass
    used = launcher.open_in_browser_tab(f"http://127.0.0.1:{port}/#install-app")
    return jsonify(ok=True, browser=used)


@app.post("/api/autostart")
def autostart():
    on = bool((request.get_json(silent=True) or {}).get("on"))
    try:
        res = launcher.set_autostart(on, _port_of_request(), LOG_PATH)
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError(f"Could not change it: {exc}") from exc
    return jsonify(autostart=res)


@app.post("/api/quit")
def quit_app():
    cancel_all()
    threading.Timer(0.3, lambda: os._exit(0)).start()
    return jsonify(ok=True)


# ============================================================================ routes: folder & files
def file_list(folder: Path):
    rois = media.load_rois(folder)
    out_dir = output_dir_for(folder, SETTINGS)
    files = []
    for p in media.list_media(folder):
        kind = media.media_kind(p)
        ext = media.output_ext(kind, p.name, SETTINGS)
        files.append(dict(name=p.name, kind=kind, bytes=p.stat().st_size,
                          roi=rois.get(p.name), done=(out_dir / (p.stem + ext)).exists()))
    return files, rois


@app.post("/api/folder")
def open_folder():
    global SETTINGS
    folder = _folder((request.get_json(force=True) or {}).get("path"))
    files, _ = file_list(folder)
    with SETTINGS_LOCK:
        rec = [str(folder)] + [r for r in SETTINGS.get("recent_folders", []) if r != str(folder)]
        SETTINGS["recent_folders"] = rec[:8]
        save_settings(SETTINGS)
    return jsonify(path=str(folder), files=files, output_dir=str(output_dir_for(folder, SETTINGS)),
                   recent=SETTINGS["recent_folders"])


@app.get("/api/info")
def info():
    f = _file(request.args.get("folder"), request.args.get("name"))
    i = dict(media.media_info(f))
    if i["kind"] == "video":
        n = int(SETTINGS.get("preview_n", 40))
        dur = i.get("duration") or 0
        end = max(dur - 1.0, 0.0)                       # stay clear of the very last frame
        i["times"] = [round(end * k / max(n - 1, 1), 3) for k in range(n)] if dur > 1 else [0.0]
    return jsonify(i)


_FRAME_CACHE: "OrderedDict[tuple, bytes]" = OrderedDict()
_FRAME_LOCK = threading.Lock()


@app.get("/api/frame")
def frame():
    f = _file(request.args.get("folder"), request.args.get("name"))
    t = float(request.args.get("t", 0) or 0)
    w = int(request.args.get("w", 0) or 0)            # 0 = full resolution
    fast = request.args.get("fast", "1") == "1"
    key = (str(f), f.stat().st_mtime, round(t, 3), w, fast)
    with _FRAME_LOCK:
        data = _FRAME_CACHE.get(key)
        if data is not None:
            _FRAME_CACHE.move_to_end(key)
    if data is None:
        im = media.grab_frame(f, t, width=w or None, fast=fast)
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=88 if w else 93)
        data = buf.getvalue()
        with _FRAME_LOCK:
            _FRAME_CACHE[key] = data
            while len(_FRAME_CACHE) > 400:
                _FRAME_CACHE.popitem(last=False)
    return Response(data, mimetype="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


# ============================================================================ routes: ROIs
_ROI_LOCK = threading.Lock()


@app.post("/api/roi")
def set_roi():
    """Body: {folder, name, shape, points} -> computed ROI saved in <folder>/rois.json.
    shape null -> ROI removed."""
    d = request.get_json(force=True) or {}
    f = _file(d.get("folder"), d.get("name"))
    folder = f.parent
    with _ROI_LOCK:
        rois = media.load_rois(folder)
        if not d.get("shape"):
            rois.pop(f.name, None)
            roi = None
        else:
            W, H = media.media_info(f)["size"]
            roi = media.roi_from_points(d["shape"], d.get("points") or [], W, H)
            if roi is None:
                raise ValueError("Not enough points for this shape.")
            if d["shape"] != "full":
                roi["points"] = [[round(float(x), 2), round(float(y), 2)] for x, y in d["points"]]
            rois[f.name] = roi
        media.save_rois(folder, rois)
    return jsonify(roi=roi)


@app.post("/api/roi/copy")
def copy_roi():
    """Copy one file's ROI to other files. Body: {folder, name, targets: "missing"|"all"}"""
    d = request.get_json(force=True) or {}
    f = _file(d.get("folder"), d.get("name"))
    folder = f.parent
    with _ROI_LOCK:
        rois = media.load_rois(folder)
        src = rois.get(f.name)
        if not src:
            raise ValueError("This file has no saved ROI yet.")
        copied, skipped = [], []
        for p in media.list_media(folder):
            if p.name == f.name or (d.get("targets") != "all" and p.name in rois):
                continue
            try:
                W, H = media.media_info(p)["size"]
            except Exception:
                skipped.append(p.name); continue
            if (W, H) != (src["W"], src["H"]):
                skipped.append(p.name); continue
            rois[p.name] = dict(src)
            copied.append(p.name)
        media.save_rois(folder, rois)
    return jsonify(copied=copied, skipped=skipped)


# ============================================================================ processing jobs
class Runner:
    def __init__(self):
        self.lock = threading.Lock()
        self.jobs: list[dict] = []
        self.cancel = threading.Event()
        self.procs: set = set()
        self.batch = None

    def busy(self):
        return any(j["status"] in ("queued", "running") for j in self.jobs)


RUN = Runner()


def cancel_all():
    RUN.cancel.set()
    for p in list(RUN.procs):
        try:
            p.kill()
        except Exception:
            pass


def _job_update(job, **kw):
    with RUN.lock:
        job.update(kw)


def _run_job(job, s, folder: Path, out_dir: Path):
    if RUN.cancel.is_set():
        _job_update(job, status="cancelled"); return
    _job_update(job, status="running", started=time.time(), text="starting")
    src = folder / job["name"]
    dst = out_dir / job["output"]
    try:
        if job["kind"] == "image":
            media.process_image(src, dst, job["roi"], tuple(job["size"]), job["canvas"], s["background"],
                                s["jpeg_quality"], post=job["post"])
            _job_update(job, status="done", progress=1.0, text="done", finished=time.time())
            return
        def prog(frac, text):
            _job_update(job, progress=round(frac, 4), text=text)
        ok, mode, err = media.process_video(
            src, dst, job["roi"], tuple(job["size"]), job["canvas"], job["fps"], s["background"],
            s["crf"], s["preset"], s["hwaccel"], s["audio"], work_dir=out_dir / "_logs",
            log_path=out_dir / "_logs" / (src.stem + ".log"), progress=prog, cancel=RUN.cancel, procs=RUN.procs,
            post=job["post"])
        if ok:
            _job_update(job, status="done", progress=1.0, text=f"done · {mode}", finished=time.time())
        elif RUN.cancel.is_set():
            _job_update(job, status="cancelled", text="cancelled")
        else:
            _job_update(job, status="failed", text=err or "failed", finished=time.time())
    except Exception as e:  # noqa: BLE001
        _job_update(job, status="failed", text=str(e)[:300], finished=time.time())


def _write_params(folder, out_dir, jobs, s):
    p = out_dir / "processing_params.json"
    try:
        params = json.loads(p.read_text()) if p.exists() else {}
    except Exception:
        params = {}
    params.setdefault("files", {})
    for j in jobs:
        if j["status"] != "done":
            continue
        x0, y0, w, h = media.crop_box(j["roi"])
        sw, sh = j["size"]
        fw, fh = j["post"] or j["size"]
        cw, ch = j["canvas"] or (fw, fh)
        # where pixel (0,0) of the scaled crop lands in the output (negative when "fill" cut the edges)
        ox = (cw - fw) // 2 - (sw - fw) // 2
        oy = (ch - fh) // 2 - (sh - fh) // 2
        params["files"][j["name"]] = dict(
            output=j["output"], tasks=s["tasks"], roi=j["roi"], crop_origin_in_px=[x0, y0], crop_size_in_px=[w, h],
            roi_size_out_px=[sw, sh], scale_out_per_in=[sw / w, sh / h],
            roi_offset_out_px=[ox, oy], output_size=[cw, ch],
            fps=j["fps"] if j["kind"] == "video" else None, background=s["background"],
            processed=time.strftime("%Y-%m-%d %H:%M:%S"))
    params["how_to_map_back"] = ("x_original = (x_output - roi_offset_out_px[0]) / scale_out_per_in[0] + "
                                 "crop_origin_in_px[0]   (same for y with index 1)")
    p.write_text(json.dumps(params, indent=2))


@app.post("/api/process")
def process():
    d = request.get_json(force=True) or {}
    folder = _folder(d.get("folder"))
    if RUN.busy():
        raise RuntimeError("Already processing – wait for it to finish or cancel it.")
    s = dict(SETTINGS)
    if s["background"] != "transparent":
        media.parse_color(s["background"])
    out_dir = output_dir_for(folder, s)
    if out_dir.resolve() == folder.resolve():
        raise ValueError("The output folder must be different from the input folder.")
    tasks = s["tasks"]
    if not any(tasks.values()):
        raise ValueError("Choose at least one thing to do on the Home screen (crop, resize or frame rate).")
    names = d.get("names")
    rois = media.load_rois(folder) if tasks["crop"] else {}
    all_files = {p.name: p for p in media.list_media(folder)}
    names = [n for n in (names if names is not None else all_files) if n in all_files]
    plan_rois, skipped = {}, []
    for n in names:
        roi = rois.get(n)
        if roi is None and (not tasks["crop"] or s["no_roi"] == "full"):
            W, H = media.media_info(all_files[n])["size"]
            roi = media.roi_from_points("full", [], W, H)
        if roi is None:
            skipped.append(n); continue
        plan_rois[n] = roi
    if not plan_rois:
        raise ValueError("Nothing to process: none of the selected files has an area drawn "
                         "(draw one, or set 'Files without area' to 'whole frame').")
    if any(media.media_kind(n) == "video" for n in plan_rois) and not media.FFMPEG:
        raise RuntimeError("ffmpeg is needed for videos but was not found (see Help → System check).")
    plan = media.plan_outputs(plan_rois, list(plan_rois), {**s, "resize": tasks["resize"]})
    fps = (s["fps"] or None) if tasks["fps"] else None
    out_dir.mkdir(parents=True, exist_ok=True)
    jobs = []
    for n, roi in plan_rois.items():
        kind = media.media_kind(n)
        output = Path(n).stem + media.output_ext(kind, n, s)
        pl = plan[n]
        job = dict(id=uuid.uuid4().hex[:8], name=n, kind=kind, output=output, roi=roi, size=list(pl["size"]),
                   post=list(pl["post"]) if pl["post"] else None, canvas=list(pl["canvas"]) if pl["canvas"] else None,
                   fps=fps if kind == "video" else None, status="queued", progress=0.0, text="waiting")
        if (out_dir / output).exists() and not s["overwrite"]:
            job.update(status="skipped", progress=1.0, text="already exists (turn on 'Overwrite' to redo)")
        jobs.append(job)
    with RUN.lock:
        RUN.jobs = jobs
        RUN.cancel.clear()
        RUN.batch = dict(folder=str(folder), output_dir=str(out_dir), started=time.time(), skipped_no_roi=skipped)

    def go():
        todo = [j for j in jobs if j["status"] == "queued"]
        # images are quick: do them first, then the videos in parallel
        todo.sort(key=lambda j: j["kind"] != "image")
        with ThreadPoolExecutor(max_workers=max(1, int(s["parallel"]))) as ex:
            list(ex.map(lambda j: _run_job(j, s, folder, out_dir), todo))
        _write_params(folder, out_dir, jobs, s)
        with RUN.lock:
            RUN.batch["finished"] = time.time()
    threading.Thread(target=go, daemon=True).start()
    return jsonify(jobs=jobs, batch=RUN.batch)


@app.get("/api/jobs")
def jobs():
    with RUN.lock:
        return jsonify(jobs=[{k: v for k, v in j.items() if k != "roi"} for j in RUN.jobs],
                       batch=RUN.batch, busy=RUN.busy())


@app.post("/api/cancel")
def cancel():
    cancel_all()
    with RUN.lock:
        for j in RUN.jobs:
            if j["status"] == "queued":
                j.update(status="cancelled", text="cancelled")
    return jsonify(ok=True)


# ============================================================================ updates (see updater.py)
UPDATE_CACHE_HOURS = 12
SERVER = {"srv": None, "restart": False}
UPDATE_JOB = {"running": False, "result": None, "error": None}


def _set(**kw):
    with SETTINGS_LOCK:
        SETTINGS.update(kw)
        save_settings(SETTINGS)


@app.get("/api/update/check")
def update_check():
    """Ask GitHub whether a newer version exists. Cached for 12 hours unless ?force=1."""
    force = request.args.get("force") == "1"
    if not force and request.args.get("auto") == "1" and not SETTINGS.get("update_check"):
        return jsonify(skipped=True, current=VERSION)
    cached = SETTINGS.get("update_cache") or {}
    if not force and cached.get("current") == VERSION and time.time() - cached.get("ts", 0) < UPDATE_CACHE_HOURS * 3600:
        return jsonify({**cached, "cached_result": True})
    try:
        info = updater.check(current=VERSION)
    except updater.UpdateError as exc:
        return jsonify(error=str(exc)), 502
    info["ts"] = time.time()
    _set(update_cache=info)
    return jsonify(info)


def _remember_update(res, notes=""):
    _set(just_updated={"version": res.get("installed"), "previous": res.get("previous"),
                       "notes": notes or "", "warning": res.get("warning", "")}, update_cache={})


def _update_job(info):
    try:
        res = updater.install(info, BACKUP_DIR)
        _remember_update(res, info.get("notes", ""))
        res["restart"] = res.get("installed") != VERSION or bool(res.get("git"))
        UPDATE_JOB["result"] = res
    except updater.UpdateError as exc:
        UPDATE_JOB["error"] = str(exc)
    except Exception as exc:  # noqa: BLE001 - shown in the Updates window
        UPDATE_JOB["error"] = f"The update failed: {exc}"
    finally:
        updater._progress("done")
        UPDATE_JOB["running"] = False


@app.post("/api/update/install")
def update_install():
    """Install the newest version in the background; the page follows /api/update/progress."""
    if UPDATE_JOB["running"]:
        return jsonify(started=True, already=True)
    if RUN.busy():
        raise RuntimeError("Files are being processed – wait for them to finish (or cancel) before updating.")
    try:
        info = updater.check(current=VERSION)
    except updater.UpdateError as exc:
        return jsonify(error=str(exc)), 502
    if not info.get("available"):
        return jsonify(error=f"You already have the latest version ({VERSION})."), 400
    updater.PROGRESS.clear()
    updater._progress("start")
    UPDATE_JOB.update(running=True, result=None, error=None, latest=info.get("latest"))
    threading.Thread(target=_update_job, args=(info,), daemon=True).start()
    return jsonify(started=True, latest=info.get("latest"))


@app.get("/api/update/progress")
def update_progress():
    return jsonify(running=UPDATE_JOB["running"], result=UPDATE_JOB["result"], error=UPDATE_JOB["error"],
                   latest=UPDATE_JOB.get("latest"), **{k: v for k, v in updater.PROGRESS.items() if k != "t"})


@app.post("/api/update/seen")
def update_seen():
    _set(just_updated={})
    return jsonify(ok=True)


@app.post("/api/update/restart")
def update_restart():
    if SERVER["srv"] is None:
        raise RuntimeError("Restart CropKit yourself: close its Terminal window and open the start file again.")
    cancel_all()
    SERVER["restart"] = True
    threading.Timer(0.6, SERVER["srv"].shutdown).start()
    return jsonify(ok=True)


def startup_update(open_browser: bool):
    """Install a new version before the app starts, when "Install updates automatically" is on.
    Quick and silent when offline; never blocks the start for more than a few seconds.
    Git copies are updated by the start file (git pull) instead."""
    if updater.is_git_checkout() or not (SETTINGS.get("update_auto") and SETTINGS.get("update_check")):
        return
    cached = SETTINGS.get("update_cache") or {}
    if cached.get("current") == VERSION and not cached.get("available") and time.time() - cached.get("ts", 0) < 6 * 3600:
        return
    try:
        info = updater.check(current=VERSION, timeout=6)
        info["ts"] = time.time()
        _set(update_cache=info)
        if not info.get("available"):
            return
        print(f"  Installing CropKit {info['latest']} (you had {VERSION})...")
        res = updater.install(info, BACKUP_DIR)
        _remember_update(res, info.get("notes", ""))
    except Exception as exc:  # noqa: BLE001 - an update problem must never stop the app from starting
        print(f"  (Update check skipped: {exc})")
        return
    print("  Done - starting the new version.\n")
    updater.relaunch(browser=open_browser)


# ============================================================================ start
def already_running(port) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=1) as r:
            return json.loads(r.read()).get("app") == "CropKit"
    except Exception:
        return False


def port_free(port) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def main():
    ap = argparse.ArgumentParser(description="CropKit")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args()
    url = f"http://127.0.0.1:{a.port}"
    if os.environ.pop("CROPKIT_WAIT_PORT", ""):     # started by an update: the old version is still closing
        for _ in range(150):
            if port_free(a.port):
                break
            time.sleep(0.2)
    if already_running(a.port):
        print(f"CropKit is already running - opening {url}")
        if not a.no_browser:
            open_ui(url)
        return
    if not port_free(a.port):
        sys.exit(f"Port {a.port} is used by another program. Start with: python app.py --port {a.port + 1}")
    startup_update(open_browser=not a.no_browser)
    print(f"\n  CropKit {VERSION} is running – {url}")
    print(f"  ffmpeg: {media.FFMPEG or 'NOT FOUND (videos will not work)'}")
    print("  Close this window (or use Quit in the app) to stop CropKit.\n")
    import logging
    logging.getLogger("werkzeug").setLevel(logging.WARNING)      # no line per request in the terminal
    if not a.no_browser:
        threading.Timer(0.8, lambda: open_ui(url)).start()

    def _refresh_icons():
        try:
            launcher.refresh_launchers(a.port, LOG_PATH, VERSION)
        except Exception:  # noqa: BLE001 - never stop the app for an icon
            pass
    threading.Thread(target=_refresh_icons, daemon=True).start()
    from werkzeug.serving import make_server
    srv = make_server("127.0.0.1", a.port, app, threaded=True)
    SERVER["srv"] = srv
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        return
    finally:
        srv.server_close()
    if SERVER["restart"]:
        print("\n  Restarting CropKit with the new version...\n")
        if os.name == "nt" and updater.spawn_detached():
            print("  CropKit restarted in the background with the new version – you can close this window.\n")
            sys.stdout.flush()
            os._exit(0)
        updater.relaunch()       # the open window reconnects by itself
    print("\n  CropKit has stopped. You can close this window.\n")


if __name__ == "__main__":
    main()
