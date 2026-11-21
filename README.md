# CropKit

Crop **videos and images** to the part you care about, make them smaller (**resolution** and **frame rate**)
and save them all in **one common format**: ready for tracking with [DeepLabCut](https://github.com/DeepLabCut/DeepLabCut),
or as clean clips and pictures for a **presentation**.

It runs **on your own computer** (Mac, Windows or Linux). The browser is only its window: nothing is uploaded anywhere.

- Draw the area to keep: **circle**, **rectangle**, **square**, **polygon** (any shape) or the **whole frame**.
- Outside the area: **black**, **white**, any **colour** or **transparent**.
- All outputs **the same size** with the area centred (DeepLabCut), or **just the crop**.
- Fast: preview frames load in the background; videos are processed in one ffmpeg pass,
  with the Mac's hardware decoder and several videos in parallel.
- Your original files are **never modified**.

Built-in help: click **? Help** in the app, or any **(i)** button next to a setting.

---

## Contents
1. [Install](#1-install)
2. [Start and stop](#2-start-and-stop)
3. [How to use it](#3-how-to-use-it)
4. [Settings](#4-settings)
5. [Output files](#5-output-files)
6. [DeepLabCut](#6-deeplabcut)
7. [Troubleshooting](#7-troubleshooting)
8. [For developers](#8-for-developers)

---

## 1. Install

You need **Python 3.10 or newer**. Everything else is installed automatically the first time.

### Mac
1. **Python**: open the Terminal app and type `python3 --version`. If it says `Python 3.10` or higher you're done;
   otherwise install it from <https://www.python.org/downloads/>.
2. **Get CropKit**: on GitHub click **Code → Download ZIP** and unzip it somewhere permanent
   (e.g. `Documents/CropKit`), or clone it: `git clone https://github.com/<your-name>/CropKit.git`.
3. **Double-click `start.command`.** The first time macOS may say it "can't be opened because it is from an
   unidentified developer": right-click the file → **Open** → **Open** (only needed once).
4. The first start takes about a minute (it installs what it needs). Then CropKit opens in its own window.

### Windows
1. **Python**: install it from <https://www.python.org/downloads/> and tick **"Add python.exe to PATH"**.
2. **Get CropKit** (Download ZIP and unzip, or `git clone`).
3. **Double-click `start.bat`.** If SmartScreen warns you: *More info* → *Run anyway*.

### Video support (ffmpeg)
CropKit installs its own copy of ffmpeg (`imageio-ffmpeg`), so videos work out of the box. If you have ffmpeg
installed yourself (e.g. `brew install ffmpeg`), CropKit uses that one instead – it is usually faster on a Mac
because it supports the hardware video decoder. Check in **Help → System check**.

## 2. Start and stop

- **Start**: double-click `start.command` (Mac) / `start.bat` (Windows). CropKit opens in a Chrome / Edge / Brave
  "app window" if one of them is installed, otherwise in your default browser, at <http://127.0.0.1:5056>.
- **Stop**: click **⏻ Quit** in the app, or close the Terminal window.
- If you close only the window, CropKit keeps running: double-click the start file again (it just reopens the window).
- If the folder is a `git clone`, the start file updates CropKit automatically (`git pull`).

## 3. How to use it

1. **Open folder** – the folder with your videos and/or images. They are listed on the left.
2. **Draw the area to keep** on each file, then **Save & next** (<kbd>Enter</kbd>):

   | Shape | How |
   |---|---|
   | ◯ Circle | click 3 or more points on the edge (more = more precise) |
   | ▭ Rectangle / □ Square | click 2 opposite corners (click again to move the nearest corner) |
   | ⬠ Polygon | click the corners in order around the area |
   | ⛶ Whole frame | nothing to draw – only resize / reduce frame rate |

   - Drag a point to move it · drag the picture to move around · mouse wheel / pinch to zoom · <kbd>F</kbd> = fit.
   - For videos, the slider shows preview frames from start to end (<kbd>←</kbd> <kbd>→</kbd>); **🔍 Full resolution** loads the
     current moment at full size.
   - Camera didn't move? Draw once, then **⇉ Copy to other files**.
3. **Output settings** on the right – or press a **Quick setup** button: *DeepLabCut*, *Presentation*, *Only downsample*.
4. **▶ Process**. One progress bar per file (%, time left, speed). New files go to `cropped/` inside your folder
   (or the output folder you chose).

The areas you draw are saved in `rois.json` next to your files, so you can stop and continue later,
or process the same files again with different settings.

## 4. Settings

| Setting | What it does |
|---|---|
| Output folder | Empty = `cropped` inside the opened folder. |
| Fit into W × H | The crop is scaled to fit inside this box (proportions kept). |
| Keep original resolution | No scaling. |
| All outputs the same size | On: identical frame size, area centred, border = background. Off: just the crop. |
| Scaling between files | *Each ROI fills the frame* (same px/cm if the arena has the same real size) or *same zoom for every file*. |
| Background | black / white / any colour / transparent. |
| Transparent videos saved as | `.mov` ProRes 4444 (Keynote, Final Cut, Premiere…) or `.webm` VP9 (web). |
| Frame rate | Frames per second of the videos (extra frames are dropped). *Keep original* = unchanged. |
| Quality | x264 CRF: lower = better & bigger (18–22 recommended). |
| Keep sound | Copy the audio track. |
| Images: save as | same as original / PNG / JPEG / WebP / TIFF (transparent → PNG instead of JPEG). |
| Files without ROI | skip them, or process the whole frame (only downsample). |
| Advanced | hardware decoding, videos in parallel, encoding speed, preview frames, overwrite existing outputs. |

Settings are remembered in `~/.cropkit/settings.json`.

## 5. Output files

In the output folder:
- one file per input, **same name** (extension may change: `.mp4` for videos, `.mov`/`.webm` if transparent,
  images as chosen);
- `processing_params.json` – for every file: the area, crop origin and size, scale and offset in the output;
- `_logs/` – ffmpeg logs of the videos (look here if one fails).

## 6. DeepLabCut

- Use the **DeepLabCut** quick setup: black outside, all outputs 720 × 720 (ROI centred), 10 fps, MP4 H.264.
- With *each ROI fills the frame*, if the arena has the same real size in all videos, one **pixel → cm** factor works for all.
- Back to original coordinates (values in `processing_params.json`):
  `x_original = (x_output − roi_offset_out_px[0]) / scale_out_per_in[0] + crop_origin_in_px[0]` (y with index 1).
- Frame *i* of an output video is at *i* / fps seconds of the original.
- `extras/DLC_video_prep.ipynb` is the same workflow as a Jupyter notebook, for scripting.

## 7. Troubleshooting

- **A video failed** – the reason is shown under its progress bar; the full log is in `_logs/` in the output folder.
- **Videos don't work / "ffmpeg not found"** – see *Help → System check*; install ffmpeg (`brew install ffmpeg`) and restart.
- **The folder dialog doesn't appear** – it may be behind the window; or paste the path in the box at the top.
- **Files are "skipped"** – an output already exists; tick *Advanced → Overwrite existing outputs*.
- **"Port 5056 is used by another program"** – start with `python app.py --port 5057`.

## 8. For developers

```
app.py        Flask server: API, background jobs, settings (port 5056)
media.py      processing engine: ROIs, masks, sizes, ffmpeg (videos) and Pillow (images)
launcher.py   opens the app window (Chrome/Edge/Brave --app, else default browser)
static/       the interface: index.html, app.css, app.js, help.js (texts of Help and (i) buttons)
extras/       Jupyter notebook version
```

Run without the start files: `python -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python app.py`
(`--port N`, `--no-browser`).

The engine can also be used from Python:

```python
import media
roi = media.roi_from_points("circle", [(1000, 1080), (2900, 1080), (1950, 130)], 3840, 2160)
size = media.plan_sizes({"a": roi}, ["a"], 720, 720)["a"]
media.process_video("in.mp4", "out.mp4", roi, size, canvas=(720, 720), fps=10, background="black")
media.process_image("in.jpg", "out.png", roi, size, canvas=None, background="transparent")
```

## Licence
[MIT](LICENSE). Uses [Flask](https://flask.palletsprojects.com), [Pillow](https://python-pillow.org),
[NumPy](https://numpy.org) and [FFmpeg](https://ffmpeg.org) (via [imageio-ffmpeg](https://github.com/imageio/imageio-ffmpeg)).
