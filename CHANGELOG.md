# Changelog

## 1.8.0
- New last step **5 · Done**: when processing ends, CropKit moves there by itself – a summary (new results, kept, failed
  with the reason, time) and **Show results**, **Process another folder**, **Change settings & run again**.
- While processing, the Review step shows only the progress and **Stop** (no Process button, no "processed before"
  warning), so it no longer looks like something still has to be done.

## 1.7.2
- *Settings* step: cleaner layout – one full-width row per task in the order they are applied (Frame rate → Crop →
  Resize → Save to), settings on the left and *How it's done* on the right.

## 1.7.1
- *Draw areas*: the button under the picture always shows the one useful action – disabled until the area is complete,
  **Save area · next file** when there is something to save, **Next file without area** when this file is done, and it
  disappears when every file has its area. Only then does **Next: Settings ▶** appear (highlighted). Enter does the same.

## 1.7.0
- **Same area for all files** (top of the *Draw areas* step): when the camera didn't move, draw the area once and every
  selected file of the same pixel size gets it. Changing it later updates all of them. Files of another size are listed and
  keep their own area.

## 1.6.0
- **Step by step**: after choosing a folder CropKit guides you one step at a time – **Files → Draw areas → Settings →
  Review & process** – with Back / Next. Each step shows only what it needs; *Process* is only at the end, and *Next* unlocks
  when the step is complete (e.g. every file has an area – or choose *continue anyway*).
- **Files processed before** are marked *done before* (with when and how they were made). At the review step you choose:
  skip them, process them again (replace), or save everything in a **new folder** (`cropped_2`, …).
- The review step lists exactly what will happen, in the order it is done.

## 1.5.0
- **"How it's done"** notes in every Result card, live for the file you are looking at: exactly what happens to the pixels
  and frames (e.g. "about 1 of every 6 frames is kept (60 → 10 fps), never blended", "each new pixel is the average of
  3 × 3 original pixels"). Full explanation in Help → *What happens to your pictures*.
- Images and videos are now resized with exactly the same methods: **area averaging** when shrinking, **bicubic** when
  enlarging (images used Lanczos before). Files that keep their size are not resampled at all.
- `processing_params.json` also records the resampling method and the frame selection used for each file.
- All action buttons are blue.

## 1.4.1
- Fix: after an update, an older CropKit still running in the background (started by the app icon) kept answering, so new
  buttons failed with "404 Not Found". Starting CropKit now replaces an older running version automatically, and the window
  shows a **Restart CropKit** button if it ever talks to an outdated one.

## 1.4.0
- **Install CropKit as a real app** (⚙ Settings → *Install CropKit as an app*, with Chrome, Edge or Brave): its own icon in the
  Dock / taskbar, its own window and *Quit* in its menu – and your browser no longer opens together with CropKit.
- Once installed, CropKit always opens in that app (also from start.command and the start icon).
- If CropKit isn't running when you open the app, the app shows a **Start CropKit** button.
- New option: **start CropKit in the background when you log in**, so the app opens instantly.

## 1.3.0
- **Simpler, cleaner look** (in the style of PaperShelf).
- **Home**: first what to do (Crop / Resize / Frame rate, or a recipe), then your folder – recent folders are one click away.
- **Workspace**: files on the left, the picture in the middle with a line that always says what to do next
  (e.g. "3 of 4 drawn"), and on the right one **Result** card per thing you chose with only its main setting.
  Details are under *More options*.
- **⚙ Settings** window for the app icon, updates and technical options (speed, redoing finished files).

## 1.2.0
- **Home screen**: choose what to do – **Crop**, **Resize**, **Frame rate**, or any combination – or start from a recipe
  (DeepLabCut, Clip for slides, Smaller videos, Only frame rate, Half size). Only the steps and settings you need are shown.
- **Resize** is now a task of its own: fit inside a box (optionally enlarging), exact size (add borders / fill the frame /
  stretch) or a percentage. Works without cropping too.
- Everything is done in one pass in the best order: drop frames → crop → resize → background / border → save.
- **App icon**: Home → *Create app icon* makes CropKit a normal app (Applications / Dock on Mac, Desktop / Start menu on
  Windows) that starts without the Terminal window. Existing icons are refreshed after updates.
- New CropKit icon.

## 1.1.0
- **Updates from inside the app**: a yellow **⬆ Update** button appears when a new version is on GitHub;
  one click installs it (a backup of the old version is kept in `~/.cropkit/backups`) and restarts CropKit.
- New versions can also be installed automatically when CropKit starts (on by default; click the version
  number at the top right to change this).
- Folders that are a git clone are updated with `git pull`.
- Every new version is published automatically as a GitHub release (when `VERSION` changes).

## 1.0.0
First version.
- Crop videos and images to a circle, rectangle, square, polygon or the whole frame.
- Downsample resolution (fit into W × H or keep original) and frame rate.
- Background outside the area: any colour or transparent (.mov ProRes 4444 / .webm VP9 / .png).
- All outputs the same size (ROI centred) or just the crop.
- Fast video preview (keyframes, background loading) and fast processing (Mac hardware decoding,
  several videos in parallel).
- Quick setups: DeepLabCut, Presentation, Only downsample.
- Built-in help, (i) explanations next to every setting, system check.
