# CropKit

<img src="static/icons/icon-512.png" width="96" align="right" alt="CropKit icon">

**Crop**, **resize** and change the **frame rate** of **videos and images** – one of these, or any combination – and save
them all in **one common format**: ready for tracking with [DeepLabCut](https://github.com/DeepLabCut/DeepLabCut),
smaller files to share, or clean clips and pictures for a **presentation**.

It runs **on your own computer** (Mac, Windows or Linux). The browser is only its window: nothing is uploaded anywhere.

- A **Home screen** where you pick what to do (Crop / Resize / Frame rate) or a ready-made recipe.
- Draw the area to keep: **circle**, **rectangle**, **square**, **polygon** (any shape) or the **whole frame**.
- Resize: fit inside a box, exact size (borders / fill / stretch) or a percentage.
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
8. [Updating](#8-updating)
9. [For developers](#9-for-developers)
10. [Publishing a new version (maintainers)](#10-publishing-a-new-version-maintainers)

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

- **App icon (recommended)**: after the first start, open **⚙ Settings** (top right) → **Create app icon**. On a Mac CropKit then
  appears in your Applications folder (and on the Desktop): drag it onto the Dock. On Windows it is on the Desktop and in
  the Start menu. The icon starts CropKit without a Terminal window.
- **Start file**: double-click `start.command` (Mac) / `start.bat` (Windows). CropKit opens in a Chrome / Edge / Brave
  "app window" if one of them is installed, otherwise in your default browser, at <http://127.0.0.1:5056>.
- **Stop**: click **⏻ Quit** in the app, or close the Terminal window.
- If you close only the window, CropKit keeps running: double-click the start file again (it just reopens the window).
- If the folder is a `git clone`, the start file updates CropKit automatically (`git pull`).

## 3. How to use it

1. **Home** – click what you want to do: **✂️ Crop**, **⤡ Resize**, **⏱ Frame rate** (any combination), or a recipe.
2. **Choose your folder** (Open folder, or a recent folder). You land in the workspace: files on the left, the picture in
   the middle (the line above it always says what to do next), the **Result** on the right.
   Click the CropKit logo to go back Home.
3. If you crop: **draw the area to keep** on each file, then **Save & next** (<kbd>Enter</kbd>):

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
4. **Result** on the right – one card per thing you chose, with its main setting; details under *More options*.
   Technical options (speed, redoing finished files, app icon, updates) are in **⚙ Settings**.
5. **▶ Process**. One progress bar per file (%, time left, speed). New files go to `cropped/` inside your folder
   (or the output folder you chose).

The areas you draw are saved in `rois.json` next to your files, so you can stop and continue later,
or process the same files again with different settings.

**Order of the steps.** Whatever you combine, CropKit works in one pass in this order:
**drop frames → crop → resize → background / border → save** – frames first (every later step only touches the frames you
keep), crop before resize (exact area, no work on pixels that are thrown away), and the file is encoded only once.

**Recipes:** *DeepLabCut* (crop arena, 720 × 720, 10 fps) · *Clip for slides* (crop, transparent outside) ·
*Smaller videos* (max 1280 × 720, 30 fps) · *Only frame rate* (10 fps) · *Half size* (50 %).

## 4. Settings

| Setting | What it does |
|---|---|
| Output folder | Empty = `cropped` inside the opened folder. |
| Resize: fit inside a box | Scaled to fit inside W × H (proportions kept); optionally also enlarges smaller pictures. |
| Resize: exact size | Exactly W × H – add borders, fill the frame (cut the edges) or stretch. |
| Resize: percentage | e.g. 50 % = half width and height. |
| All outputs the same size | On: identical frame size, area centred, border = background. Off: just the crop. |
| Scaling between files | *Each ROI fills the frame* (same px/cm if the arena has the same real size) or *same zoom for every file*. |
| Background | black / white / any colour / transparent. |
| Transparent videos saved as | `.mov` ProRes 4444 (Keynote, Final Cut, Premiere…) or `.webm` VP9 (web). |
| Frame rate | Frames per second of the videos (extra frames are dropped). |
| Quality | x264 CRF: lower = better & bigger (18–22 recommended). |
| Keep sound | Copy the audio track. |
| Images: save as | same as original / PNG / JPEG / WebP / TIFF (transparent → PNG instead of JPEG). |
| Files without area | (crop) skip them, or process the whole frame. |
| ⚙ Settings | app icon, updates, hardware decoding, videos in parallel, encoding speed, preview frames, redo finished files. |

Settings are remembered in `~/.cropkit/settings.json`.

## 5. Output files

In the output folder:
- one file per input, **same name** (extension may change: `.mp4` for videos, `.mov`/`.webm` if transparent,
  images as chosen);
- `processing_params.json` – for every file: the area, crop origin and size, scale and offset in the output;
- `_logs/` – ffmpeg logs of the videos (look here if one fails).

## 6. DeepLabCut

- Use the **DeepLabCut** recipe on the Home screen: crop the arena, black outside, all outputs 720 × 720, 10 fps, MP4 H.264.
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

## 8. Updating

CropKit updates itself from this GitHub page:
- When a new version exists, a yellow **⬆ Update** button appears at the top: **Install update** → **Restart**.
  Your settings and drawn areas are kept; a backup of the old version goes to `~/.cropkit/backups`.
- By default new versions are also installed **automatically when CropKit starts**. Click the version number
  (top right) to check now or to turn this off.
- If your CropKit folder is a `git clone`, updating runs `git pull` (the start file does this too).

## 9. For developers

```
app.py        Flask server: API, background jobs, settings, updates (port 5056)
updater.py    checks GitHub for new versions and installs them (update.json = which repository)
media.py      processing engine: ROIs, masks, sizes, ffmpeg (videos) and Pillow (images)
launcher.py   opens the app window (Chrome/Edge/Brave --app) and creates the app icon (static/icons/)
static/       the interface: index.html, app.css, app.js, help.js (texts of Help and (i) buttons)
extras/       Jupyter notebook version
```

Run without the start files: `python -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python app.py`
(`--port N`, `--no-browser`).

The engine can also be used from Python:

```python
import media
roi = media.roi_from_points("circle", [(1000, 1080), (2900, 1080), (1950, 130)], 3840, 2160)
p = media.plan_outputs({"a": roi}, ["a"], dict(resize=True, resize_mode="fit", out_w=720, out_h=720))["a"]
media.process_video("in.mp4", "out.mp4", roi, p["size"], p["canvas"], fps=10, background="black", post=p["post"])
media.process_image("in.jpg", "out.png", roi, p["size"], p["canvas"], background="transparent", post=p["post"])
```

## 10. Publishing a new version (maintainers)

1. Make the changes, then raise the number in `VERSION` (e.g. `1.1.0` → `1.2.0`) and add a `## 1.2.0` section
   at the top of `CHANGELOG.md` (it becomes the "What's new" text shown in the app).
2. `git add -A && git commit -m "CropKit 1.2.0" && git push`
3. The GitHub Action in `.github/workflows/release.yml` creates the release `v1.2.0` with a zip by itself
   (see the *Actions* tab). Every installed CropKit then shows the Update button.

## Licence
[MIT](LICENSE). Uses [Flask](https://flask.palletsprojects.com), [Pillow](https://python-pillow.org),
[NumPy](https://numpy.org) and [FFmpeg](https://ffmpeg.org) (via [imageio-ffmpeg](https://github.com/imageio/imageio-ffmpeg)).
