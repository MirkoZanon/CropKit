# Changelog

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
