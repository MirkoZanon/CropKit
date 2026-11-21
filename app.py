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
from launcher import open_ui

APP_DIR = Path(__file__).resolve().parent
VERSION = (APP_DIR / "VERSION").read_text().strip() if (APP_DIR / "VERSION").exists() else "dev"
DATA_DIR = Path.home() / ".cropkit"
SETTINGS_FILE = DATA_DIR / "settings.json"
DEFAULT_PORT = 5056

DEFAULTS = {
    "output_dir": "",               # "" -> <input folder>/<output_subfolder>
    "output_subfolder": "cropped",
    "size_mode": "box",             # "box" = fit into out_w x out_h, "original" = keep resolution
    "out_w": 720, "out_h": 720,
    "uniform": True,                # all outputs the same frame size (ROI centred)
    "scale_mode": "fit",            # "fit" | "same_scale"
    "fps": 10,                      # 0 = keep original
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
}

app = Flask(__name__, static_folder=str(APP_DIR / "static"), static_url_path="/static")
app.json.sort_keys = False


# ============================================================================ settings
def load_settings() -> dict:
    s = dict(DEFAULTS)
    try:
        s.update(json.loads(SETTINGS_FILE.read_text()))
    except Exception:
        pass
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
    num("jpeg_quality", 10, 100); num("crf", 0, 51); num("parallel", 1, 8); num("preview_n", 5, 200)
    choice("size_mode", ("box", "original")); choice("scale_mode", ("fit", "same_scale"))
    choice("transparent_video_format", ("mov", "webm")); choice("image_format", ("same", "png", "jpg", "webp", "tif"))
    choice("preset", ("ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow"))
    choice("no_roi", ("skip", "full")); choice("default_shape", media.SHAPES)
    for k in ("uniform", "audio", "hwaccel", "overwrite"):
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
    return jsonify(version=VERSION, settings=SETTINGS, defaults=DEFAULTS, platform=sys.platform,
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
        SETTINGS = dict(DEFAULTS, recent_folders=recent)
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
            media.process_image(src, dst, job["roi"], tuple(job["size"]), job["canvas"], s["background"], s["jpeg_quality"])
            _job_update(job, status="done", progress=1.0, text="done", finished=time.time())
            return
        def prog(frac, text):
            _job_update(job, progress=round(frac, 4), text=text)
        ok, mode, err = media.process_video(
            src, dst, job["roi"], tuple(job["size"]), job["canvas"], s["fps"] or None, s["background"],
            s["crf"], s["preset"], s["hwaccel"], s["audio"], work_dir=out_dir / "_logs",
            log_path=out_dir / "_logs" / (src.stem + ".log"), progress=prog, cancel=RUN.cancel, procs=RUN.procs)
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
        cw, ch = j["canvas"] or j["size"]
        params["files"][j["name"]] = dict(
            output=j["output"], roi=j["roi"], crop_origin_in_px=[x0, y0], crop_size_in_px=[w, h],
            roi_size_out_px=[sw, sh], scale_out_per_in=[sw / w, sh / h],
            roi_offset_out_px=[(cw - sw) // 2, (ch - sh) // 2], output_size=[cw, ch],
            fps=(s["fps"] or None) if j["kind"] == "video" else None, background=s["background"],
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
    names = d.get("names")
    rois = media.load_rois(folder)
    all_files = {p.name: p for p in media.list_media(folder)}
    names = [n for n in (names if names is not None else all_files) if n in all_files]
    plan, skipped = {}, []
    for n in names:
        roi = rois.get(n)
        if roi is None and s["no_roi"] == "full":
            W, H = media.media_info(all_files[n])["size"]
            roi = media.roi_from_points("full", [], W, H)
        if roi is None:
            skipped.append(n); continue
        plan[n] = roi
    if not plan:
        raise ValueError("Nothing to process: none of the selected files has an ROI "
                         "(draw one, or set 'Files without ROI' to 'full frame').")
    if any(media.media_kind(n) == "video" for n in plan) and not media.FFMPEG:
        raise RuntimeError("ffmpeg is needed for videos but was not found (see Help → System check).")
    sizes = media.plan_sizes(plan, list(plan), s["out_w"], s["out_h"], s["size_mode"], s["scale_mode"])
    canvas = media.uniform_canvas(sizes, s["out_w"], s["out_h"], s["size_mode"]) if s["uniform"] else None
    out_dir.mkdir(parents=True, exist_ok=True)
    jobs = []
    for n, roi in plan.items():
        kind = media.media_kind(n)
        output = Path(n).stem + media.output_ext(kind, n, s)
        job = dict(id=uuid.uuid4().hex[:8], name=n, kind=kind, output=output, roi=roi, size=list(sizes[n]),
                   canvas=list(canvas) if canvas else None, status="queued", progress=0.0, text="waiting")
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
    if already_running(a.port):
        print(f"CropKit is already running - opening {url}")
        if not a.no_browser:
            open_ui(url)
        return
    if not port_free(a.port):
        sys.exit(f"Port {a.port} is used by another program. Start with: python app.py --port {a.port + 1}")
    print(f"CropKit {VERSION} – {url}")
    print(f"ffmpeg: {media.FFMPEG or 'NOT FOUND (videos will not work)'}")
    print("Close this window (or use Quit in the app) to stop CropKit.")
    import logging
    logging.getLogger("werkzeug").setLevel(logging.WARNING)      # no line per request in the terminal
    if not a.no_browser:
        threading.Timer(0.8, lambda: open_ui(url)).start()
    app.run(host="127.0.0.1", port=a.port, threaded=True, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
