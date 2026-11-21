"""CropKit processing engine: crop images and videos to a region of interest (ROI), mask the outside,
downsample (size and frame rate) and save them in one common format.

Videos are processed by ffmpeg in a single pass; images by Pillow.
All ROI coordinates are in pixels of the ORIGINAL file (after rotation metadata is applied).
"""
from __future__ import annotations

import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import threading
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageColor, ImageDraw, ImageOps

VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".m4v", ".mpg", ".mpeg", ".wmv", ".webm", ".mts", ".m2ts"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}
SHAPES = ("circle", "rectangle", "square", "polygon", "full")
OUTPUT_SUFFIX_IGNORE = (".partial",)


# ============================================================================ ffmpeg
def find_ffmpeg() -> str | None:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    for p in ("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"):   # Finder-started apps lack PATH
        if os.path.exists(p):
            return p
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


FFMPEG = find_ffmpeg()


def _need_ffmpeg():
    if not FFMPEG:
        raise RuntimeError("ffmpeg not found. Install it (Mac: `brew install ffmpeg`) or run "
                           "`pip install imageio-ffmpeg` in the app's environment.")


def ffmpeg_version() -> str:
    if not FFMPEG:
        return "not found"
    try:
        out = subprocess.run([FFMPEG, "-version"], capture_output=True, text=True).stdout
        return out.splitlines()[0] if out else "unknown"
    except Exception as e:
        return f"error: {e}"


def _no_window():
    """subprocess flags: never pop up a console window on Windows."""
    return {"creationflags": 0x08000000} if os.name == "nt" else {}


# ============================================================================ files
def media_kind(path) -> str | None:
    ext = Path(path).suffix.lower()
    if ext in VIDEO_EXTS:
        return "video"
    if ext in IMAGE_EXTS:
        return "image"
    return None


def list_media(folder) -> list[Path]:
    folder = Path(folder)
    return sorted([p for p in folder.iterdir()
                   if p.is_file() and not p.name.startswith(".") and media_kind(p)
                   and not any(s in p.name for s in OUTPUT_SUFFIX_IGNORE)],
                  key=lambda p: p.name.lower())


_INFO_CACHE: dict = {}


def video_info(path) -> dict:
    """Duration (s), fps, codec, pixel format and size (rotation applied) parsed from `ffmpeg -i`."""
    _need_ffmpeg()
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", str(path)], capture_output=True, text=True,
                       errors="replace", **_no_window())
    txt = r.stderr
    dur = None
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", txt)
    if m:
        h, mi, s = m.groups()
        dur = int(h) * 3600 + int(mi) * 60 + float(s)
    fps = None
    m = re.search(r"Video:.*?(\d+(?:\.\d+)?)\s*fps", txt)
    if m:
        fps = float(m.group(1))
    codec = pix = None
    m = re.search(r"Video:\s*(\w+)[^,]*,\s*(\w+)", txt)
    if m:
        codec, pix = m.groups()
    size = None
    m = re.search(r"Video:.*?,\s(\d{2,5})x(\d{2,5})", txt)
    if m:
        size = (int(m.group(1)), int(m.group(2)))
        if re.search(r"rotat\w*\D{0,20}-?(90|270)", txt):
            size = size[::-1]
    has_audio = bool(re.search(r"Stream #\d+:\d+.*?: Audio:", txt))
    return {"kind": "video", "duration": dur, "fps": fps, "codec": codec, "pix_fmt": pix,
            "size": size, "audio": has_audio}


def media_info(path) -> dict:
    path = Path(path)
    key = (str(path), path.stat().st_mtime, path.stat().st_size)
    if key in _INFO_CACHE:
        return _INFO_CACHE[key]
    kind = media_kind(path)
    if kind == "video":
        info = video_info(path)
        if not info["size"]:
            f = grab_frame(path, 0)
            info["size"] = (f.width, f.height)
    else:
        with Image.open(path) as im:
            im = ImageOps.exif_transpose(im)
            info = {"kind": "image", "size": im.size, "mode": im.mode, "format": im.format}
    info["bytes"] = path.stat().st_size
    _INFO_CACHE[key] = info
    return info


# ============================================================================ frames
def grab_frame(path, t=0.0, width=None, fast=False, alpha=False) -> Image.Image:
    """One frame of a video (or the image itself) as a PIL image.
    width: scale to this width. fast=True: nearest keyframe at/before t (much faster, no exact time)."""
    if media_kind(path) == "image":
        im = ImageOps.exif_transpose(Image.open(path))
        im = im.convert("RGBA" if alpha else "RGB")
        if width and im.width > width:
            im = im.resize((width, max(1, round(im.height * width / im.width))), Image.LANCZOS)
        return im
    _need_ffmpeg()

    def run(t, hw):
        cmd = [FFMPEG, "-hide_banner", "-loglevel", "error"]
        if hw:
            cmd += ["-hwaccel", "videotoolbox" if sys.platform == "darwin" else "auto"]
        if fast:
            cmd += ["-noaccurate_seek"]
        if alpha and str(path).lower().endswith(".webm"):
            cmd += ["-c:v", "libvpx-vp9"]       # the native VP9 decoder ignores transparency
        cmd += ["-ss", f"{max(t, 0):.3f}", "-i", str(path), "-an", "-frames:v", "1"]
        if width:
            cmd += ["-vf", f"scale={int(width)}:-2:flags={'fast_bilinear' if fast else 'bicubic'}"]
        cmd += ["-f", "image2pipe", "-vcodec", "png" if alpha else "bmp", "-"]
        return subprocess.run(cmd, capture_output=True, **_no_window())

    r = None
    for hw in ((True, False) if fast and not alpha else (False,)):
        r = run(t, hw)
        if r.stdout:
            break
    if not r.stdout:
        r = run(0, False)        # t past the end -> first frame
    if not r.stdout:
        raise RuntimeError(f"Could not read a frame from {Path(path).name}: {r.stderr.decode(errors='replace')[-300:]}")
    return Image.open(io.BytesIO(r.stdout)).convert("RGBA" if alpha else "RGB")


# ============================================================================ ROIs
def fit_circle(pts):
    """Least-squares circle through >=3 points. Returns cx, cy, r."""
    pts = np.asarray(pts, float)
    x, y = pts[:, 0], pts[:, 1]
    A = np.c_[x, y, np.ones_like(x)]
    c, *_ = np.linalg.lstsq(A, x ** 2 + y ** 2, rcond=None)
    cx, cy = c[0] / 2, c[1] / 2
    return float(cx), float(cy), float(math.sqrt(max(c[2] + cx ** 2 + cy ** 2, 0)))


def roi_from_points(shape, pts, W, H) -> dict | None:
    """ROI dict from clicked points (original pixels); None if there are not enough points."""
    pts = [(float(x), float(y)) for x, y in pts]
    if shape == "full":
        roi = {}
    elif shape == "circle" and len(pts) >= 3:
        cx, cy, r = fit_circle(pts)
        roi = dict(cx=cx, cy=cy, r=r)
    elif shape in ("rectangle", "square") and len(pts) >= 2:
        (xa, ya), (xb, yb) = pts[-2:]
        if shape == "square":
            side = max(abs(xb - xa), abs(yb - ya))
            xb = xa + side * (1 if xb >= xa else -1)
            yb = ya + side * (1 if yb >= ya else -1)
        roi = dict(x0=min(xa, xb), y0=min(ya, yb), x1=max(xa, xb), y1=max(ya, yb))
    elif shape == "polygon" and len(pts) >= 3:
        roi = dict(pts=[[round(x, 2), round(y, 2)] for x, y in pts])
    else:
        return None
    roi = {k: (round(v, 2) if isinstance(v, float) else v) for k, v in roi.items()}
    return dict(shape=shape, **roi, W=int(W), H=int(H))


def normalize_roi(roi: dict) -> dict:
    roi = dict(roi)
    roi.setdefault("shape", "circle")           # notebook circles.json had no shape
    if roi["shape"] not in SHAPES:
        raise ValueError(f"unknown shape {roi['shape']}")
    return roi


def roi_bbox(roi):
    s = roi["shape"]
    if s == "full":
        return 0.0, 0.0, float(roi["W"]), float(roi["H"])
    if s == "circle":
        return roi["cx"] - roi["r"], roi["cy"] - roi["r"], roi["cx"] + roi["r"], roi["cy"] + roi["r"]
    if s in ("rectangle", "square"):
        return roi["x0"], roi["y0"], roi["x1"], roi["y1"]
    a = np.array(roi["pts"], float)
    return a[:, 0].min(), a[:, 1].min(), a[:, 0].max(), a[:, 1].max()


def even(n) -> int:
    n = int(round(n))
    return n if n % 2 == 0 else n + 1


def crop_box(roi):
    """Crop rectangle in original pixels (even size/offsets): (x0, y0, w, h); x0/y0 may be < 0."""
    if roi["shape"] == "full":
        W, H = roi["W"], roi["H"]
        return 0, 0, W - W % 2, H - H % 2
    bx0, by0, bx1, by1 = roi_bbox(roi)
    if roi["shape"] == "circle":
        D = even(2 * roi["r"])
        x0, y0, w, h = int(round(roi["cx"] - D / 2)), int(round(roi["cy"] - D / 2)), D, D
    else:
        x0, y0 = int(math.floor(bx0)), int(math.floor(by0))
        w, h = even(bx1 - x0), even(by1 - y0)
    return x0 - x0 % 2, y0 - y0 % 2, max(w, 2), max(h, 2)


def load_rois(folder) -> dict:
    """{file name: roi} from <folder>/rois.json (also reads the notebook's DLC_ready/circles.json)."""
    folder = Path(folder)
    for p in (folder / "rois.json", folder / "DLC_ready" / "rois.json", folder / "DLC_ready" / "circles.json"):
        if p.exists():
            try:
                data = json.loads(p.read_text())
                return {k: normalize_roi(v) for k, v in data.items()}
            except Exception:
                continue
    return {}


def save_rois(folder, rois: dict):
    p = Path(folder) / "rois.json"
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(rois, indent=2))
    os.replace(tmp, p)


# ============================================================================ sizes & masks
def _even_floor(x) -> int:
    return max(2, int(x) // 2 * 2)


def _even_ceil(x) -> int:
    n = int(math.ceil(x - 1e-9))
    return max(2, n + n % 2)


def plan_outputs(rois: dict, names, opts: dict) -> dict:
    """How each file is resized and framed. Returns {name: {"size": (w, h), "post": (w, h) | None,
    "canvas": (w, h) | None}}:
      size   – the crop is scaled to this size (the mask is drawn at this size)
      post   – then the centre is cut to this size ("exact size: fill")
      canvas – then it is centred on a frame of this size, the rest = background

    opts: resize (bool), resize_mode "fit" | "exact" | "percent", out_w, out_h, percent,
          exact_fit "pad" | "fill" | "stretch", allow_upscale (bool), scale_mode "fit" | "same_scale",
          uniform (bool: all outputs the same frame size)."""
    boxes = {n: tuple(crop_box(rois[n])[2:]) for n in names}
    if not boxes:
        return {}
    OW, OH = int(opts.get("out_w", 720)), int(opts.get("out_h", 720))
    OW, OH = OW - OW % 2, OH - OH % 2
    mode = opts.get("resize_mode", "fit") if opts.get("resize", True) else "none"
    plan = {}
    if mode == "none":
        for n, (w, h) in boxes.items():
            plan[n] = dict(size=(w, h), post=None)
    elif mode == "percent":
        k = max(float(opts.get("percent", 50)), 1) / 100
        for n, (w, h) in boxes.items():
            plan[n] = dict(size=(_even_floor(w * k), _even_floor(h * k)), post=None)
    elif mode == "exact":
        how = opts.get("exact_fit", "pad")
        for n, (w, h) in boxes.items():
            if how == "stretch":
                plan[n] = dict(size=(OW, OH), post=None)
            elif how == "fill":
                k = max(OW / w, OH / h)
                plan[n] = dict(size=(max(_even_ceil(w * k), OW), max(_even_ceil(h * k), OH)), post=(OW, OH))
            else:
                k = min(OW / w, OH / h)
                plan[n] = dict(size=(min(_even_floor(w * k), OW), min(_even_floor(h * k), OH)), post=None)
    else:  # fit inside OW x OH
        fit = {n: min(OW / w, OH / h) for n, (w, h) in boxes.items()}
        if not opts.get("allow_upscale", False):
            fit = {n: min(k, 1.0) for n, k in fit.items()}
        if opts.get("scale_mode") == "same_scale":
            kk = min(fit.values())
            fit = {n: kk for n in names}
        for n, (w, h) in boxes.items():
            plan[n] = dict(size=(min(_even_floor(w * fit[n] + 1e-6), OW), min(_even_floor(h * fit[n] + 1e-6), OH)), post=None)
    # frame size
    if mode == "exact":
        canvas = (OW, OH)
    elif opts.get("uniform"):
        if mode == "fit":
            canvas = (OW, OH)
        else:
            canvas = (max(p["size"][0] for p in plan.values()), max(p["size"][1] for p in plan.values()))
    else:
        canvas = None
    for p in plan.values():
        final = p["post"] or p["size"]
        p["canvas"] = canvas if canvas and tuple(canvas) != tuple(final) else None
    return plan


def plan_sizes(rois: dict, names, out_w, out_h, size_mode="box", scale_mode="fit"):
    """Older API (kept for scripts): size of each ROI fitted into out_w x out_h, or original size."""
    plan = plan_outputs(rois, names, dict(resize=size_mode != "original", resize_mode="fit", out_w=out_w,
                                          out_h=out_h, scale_mode=scale_mode, allow_upscale=True))
    return {n: p["size"] for n, p in plan.items()}


def parse_color(c: str):
    return ImageColor.getrgb(c)[:3]


def roi_inside_mask(roi, size, clip_frame=True) -> Image.Image | None:
    """Grayscale mask at the output ROI size: 255 inside the ROI, 0 outside (anti-aliased).
    With clip_frame, parts of the ROI beyond the camera image are 0 too.
    None if nothing needs masking (rectangular ROI fully inside the frame)."""
    sw, sh = size
    x0, y0, w, h = crop_box(roi)
    W, H = roi["W"], roi["H"]
    off_frame = clip_frame and (x0 < 0 or y0 < 0 or x0 + w > W or y0 + h > H)
    if roi["shape"] in ("rectangle", "square", "full") and not off_frame:
        return None
    ss = 4
    kx, ky = sw / w * ss, sh / h * ss
    m = Image.new("L", (sw * ss, sh * ss), 0)
    d = ImageDraw.Draw(m)
    if roi["shape"] == "circle":
        cx, cy, r = (roi["cx"] - x0) * kx, (roi["cy"] - y0) * ky, roi["r"]
        d.ellipse([cx - r * kx, cy - r * ky, cx + r * kx, cy + r * ky], fill=255)
    elif roi["shape"] == "polygon":
        d.polygon([((x - x0) * kx, (y - y0) * ky) for x, y in roi["pts"]], fill=255)
    else:
        d.rectangle([0, 0, sw * ss, sh * ss], fill=255)
    if off_frame:
        valid = Image.new("L", m.size, 0)
        ImageDraw.Draw(valid).rectangle([-x0 * kx, -y0 * ky, (W - x0) * kx - 1, (H - y0) * ky - 1], fill=255)
        m = ImageChops.darker(m, valid)
    return m.resize((sw, sh), Image.LANCZOS)


# ============================================================================ output naming
def output_ext(kind, src, settings) -> str:
    transparent = settings["background"] == "transparent"
    if kind == "video":
        return "." + settings["transparent_video_format"] if transparent else ".mp4"
    fmt = settings["image_format"]
    ext = Path(src).suffix.lower() if fmt == "same" else "." + fmt
    ext = {".jpeg": ".jpg", ".tiff": ".tif"}.get(ext, ext)
    if transparent and ext in (".jpg", ".bmp"):
        ext = ".png"                         # these formats can't store transparency
    return ext


# ============================================================================ images
def process_image(src, dst, roi, size, canvas, background="black", quality=92, post=None):
    """Crop + mask + resize one image with Pillow (post: centre cut after resizing)."""
    im = ImageOps.exif_transpose(Image.open(src)).convert("RGBA")
    x0, y0, w, h = crop_box(roi)
    crop = im.crop((x0, y0, x0 + w, y0 + h))           # beyond the image -> transparent
    crop = crop.convert("RGBa").resize(tuple(size), Image.LANCZOS).convert("RGBA")
    mask = roi_inside_mask(roi, size, clip_frame=False)
    alpha = crop.getchannel("A")
    if mask is not None:
        alpha = ImageChops.darker(alpha, mask)
    crop.putalpha(alpha)
    if post:
        pw, ph = post
        l, t = (crop.width - pw) // 2, (crop.height - ph) // 2
        crop = crop.crop((l, t, l + pw, t + ph))
    final = tuple(post) if post else tuple(size)
    transparent = background == "transparent"
    cw, ch = canvas if canvas else final
    if transparent:
        out = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    else:
        out = Image.new("RGBA", (cw, ch), parse_color(background) + (255,))
    out.alpha_composite(crop, ((cw - final[0]) // 2, (ch - final[1]) // 2))
    ext = Path(dst).suffix.lower()
    tmp = Path(dst).with_name(Path(dst).stem + ".partial" + ext)
    if ext in (".jpg", ".bmp") or not transparent:
        out = out.convert("RGB")
    kw = {}
    if ext == ".jpg":
        kw = dict(quality=int(quality), subsampling=0 if quality >= 90 else 2, optimize=True)
    elif ext == ".webp":
        kw = dict(quality=int(quality), method=4)
    elif ext == ".png":
        kw = dict(optimize=False, compress_level=6)
    elif ext == ".tif":
        kw = dict(compression="tiff_lzw")
    fmt = {".jpg": "JPEG", ".png": "PNG", ".webp": "WEBP", ".tif": "TIFF", ".bmp": "BMP"}[ext]
    out.save(tmp, fmt, **kw)
    os.replace(tmp, dst)
    return True


# ============================================================================ videos
def decode_modes(hwaccel):
    """Decoding strategies, fastest first: (name, ffmpeg input args, filter right after fps)."""
    modes = []
    if hwaccel and sys.platform == "darwin":
        # frames stay in the Apple hardware decoder; only the frames kept by fps= are copied out
        modes.append(("gpu", ["-hwaccel", "videotoolbox", "-hwaccel_output_format", "videotoolbox_vld"], "hwdownload"))
    if hwaccel:
        modes.append(("hw", ["-hwaccel", "auto"], None))
    modes.append(("cpu", [], None))
    return modes


_BEST_MODE: dict = {}


def build_filter(roi, size, canvas, fps, masked, background, after_fps=None, pix_fmt=None, post=None):
    """ffmpeg graph: fps -> [hw download] -> (pad if ROI leaves frame) -> crop -> scale -> [mask] -> [centre cut]
    -> [centre pad]. This order is the fastest: frames are dropped first, everything else works on fewer,
    smaller pictures."""
    W, H = roi["W"], roi["H"]
    x0, y0, w, h = crop_box(roi)
    sw, sh = size
    transparent = background == "transparent"
    rgb = (0, 0, 0) if transparent else parse_color(background)
    hexcol = "0x%02X%02X%02X" % rgb
    p = max(0, -x0, -y0, x0 + w - W, y0 + h - H)
    p += p % 2
    chain = []
    if fps:
        chain.append(f"fps={fps}")
    if after_fps == "hwdownload":
        chain += ["hwdownload", "format=p010le" if pix_fmt and "10" in pix_fmt else "format=nv12"]
    if p > 0:
        chain.append(f"pad=iw+{2 * p}:ih+{2 * p}:{p}:{p}:{hexcol}")
        x0 += p
        y0 += p
    if (x0, y0, w, h) != (0, 0, W, H):
        chain.append(f"crop={w}:{h}:{x0}:{y0}")
    chain += [f"scale={sw}:{sh}:flags=area", "setsar=1", "format=yuv444p" if transparent else "format=yuv420p"]
    fmt = "yuva444p" if transparent else "yuv420p"
    tail = []
    fw, fh = (sw, sh)
    if post and tuple(post) != (sw, sh):
        fw, fh = post
        tail.append(f"crop={fw}:{fh}:{(sw - fw) // 2}:{(sh - fh) // 2}")
    if canvas and tuple(canvas) != (fw, fh):
        cw, ch = canvas
        tail.append(f"pad={cw}:{ch}:{(cw - fw) // 2}:{(ch - fh) // 2}:{'black@0' if transparent else hexcol}")
    tail.append(f"format={fmt}")
    tail = ",".join(tail)
    if transparent:
        if masked:
            return f"[0:v]{','.join(chain)}[v];[1:v]format=gray[m];[v][m]alphamerge,{tail}[out]"
        return f"[0:v]{','.join(chain)},format=yuva444p,{tail}[out]"
    if masked:
        return f"[0:v]{','.join(chain)}[v];[v][1:v]overlay=0:0:format=auto,{tail}[out]"
    return f"[0:v]{','.join(chain)},{tail}[out]"


def encoder_args(ext, crf=20, preset="veryfast", audio=False):
    if ext == ".mov":    # ProRes 4444 with transparency
        v = ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-vendor", "apl0"]
        a = ["-c:a", "aac", "-b:a", "160k"]
    elif ext == ".webm":  # VP9 with transparency
        v = ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-crf", str(min(crf + 10, 63)), "-b:v", "0",
             "-deadline", "good", "-cpu-used", "4", "-row-mt", "1", "-auto-alt-ref", "0"]
        a = ["-c:a", "libopus", "-b:a", "128k"]
    else:
        v = ["-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
        a = ["-c:a", "aac", "-b:a", "160k"]
    return v + (a if audio else ["-an"])


def make_video_mask(roi, size, path, background):
    inside = roi_inside_mask(roi, size, clip_frame=(background == "transparent"))
    if inside is None:
        return None
    if background == "transparent":
        inside.save(path)
    else:
        rgba = Image.new("RGBA", size, parse_color(background) + (0,))
        rgba.putalpha(inside.point(lambda v: 255 - v))
        rgba.save(path)
    return path


def process_video(src, dst, roi, size, canvas, fps=None, background="black", crf=20, preset="veryfast",
                  hwaccel=True, audio=False, work_dir=None, log_path=None, progress=None,
                  cancel: threading.Event | None = None, procs: set | None = None, post=None):
    """Crop + mask + downsample one video with ffmpeg.
    progress(fraction, text) is called while running. Returns (ok, decode_mode, error_text)."""
    _need_ffmpeg()
    work_dir = Path(work_dir or Path(dst).parent)
    work_dir.mkdir(parents=True, exist_ok=True)
    info = media_info(src)
    dur = info["duration"] or 0
    mask = make_video_mask(roi, size, work_dir / f"_mask_{Path(src).stem}.png", background)
    ext = Path(dst).suffix.lower()
    tmp = Path(dst).with_name(Path(dst).stem + ".partial" + ext)
    log_path = Path(log_path or work_dir / (Path(src).stem + ".log"))
    log_path.write_text("")
    keep_audio = audio and info.get("audio")
    out_fps = fps if (fps and (not info["fps"] or fps < info["fps"])) else None

    def run(name, in_args, after_fps):
        graph = build_filter(roi, size, canvas, out_fps, mask is not None, background, after_fps, info["pix_fmt"], post)
        cmd = [FFMPEG, "-y", "-hide_banner", "-nostats", "-progress", "pipe:1", *in_args,
               "-i", str(src), *(["-i", str(mask)] if mask else []), "-filter_complex", graph,
               "-map", "[out]", *(["-map", "0:a:0?"] if keep_audio else []),
               *encoder_args(ext, crf, preset, keep_audio), str(tmp)]
        with open(log_path, "a") as lf:
            lf.write(f"\n===== decoding: {name} =====\n" + " ".join(cmd) + "\n\n")
            lf.flush()
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=lf, text=True, **_no_window())
            if procs is not None:
                procs.add(proc)
            speed = ""
            try:
                for line in proc.stdout:
                    if cancel is not None and cancel.is_set():
                        proc.kill()
                        break
                    key, _, val = line.strip().partition("=")
                    if key == "speed":
                        speed = val.strip()
                    elif key == "out_time_us" and progress:
                        try:
                            t = int(val) / 1e6
                        except ValueError:
                            continue
                        if 0 <= t <= dur + 5:       # ffmpeg reports a placeholder before the 1st frame
                            progress(min(t / dur, 1.0) if dur else 0.0, f"{speed} real-time · {name}".strip(" ·"))
                proc.wait()
            finally:
                if proc.poll() is None:
                    proc.kill()
                if procs is not None:
                    procs.discard(proc)
        return proc.returncode == 0

    modes = decode_modes(hwaccel)
    best = _BEST_MODE.get("mode")
    if best:
        modes = [m for m in modes if m[0] == best] + [m for m in modes if m[0] != best]
    err = "ffmpeg failed"
    for name, in_args, after_fps in modes:
        if cancel is not None and cancel.is_set():
            err = "cancelled"
            break
        if progress:
            progress(0.0, f"starting · {name}")
        if run(name, in_args, after_fps):
            _BEST_MODE["mode"] = name
            os.replace(tmp, dst)
            if mask:
                Path(mask).unlink(missing_ok=True)
            return True, name, ""
        if cancel is not None and cancel.is_set():
            err = "cancelled"
            break
        try:
            tail = [l for l in log_path.read_text(errors="replace").splitlines() if l.strip()][-3:]
            err = " | ".join(tail)[-300:]
        except OSError:
            pass
    if tmp.exists():
        tmp.unlink()
    if mask:
        Path(mask).unlink(missing_ok=True)
    return False, None, err
