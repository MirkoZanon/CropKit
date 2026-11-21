/* Texts for the (i) bubbles and the Help window. */
window.INFO = {
  files: `<p>All videos and images in the open folder.</p>
    <p><b>Click</b> a file to draw its area. The <b>checkbox</b> decides whether it is processed.</p>
    <p><span style="color:#7ee2a5">ROI</span> = area drawn · <span style="color:#9cc0ff">done</span> = an output file already exists.</p>`,
  draw: `<p>Draw the part of the picture you want to <b>keep</b>. Everything outside it becomes the background colour (or transparent).</p>
    <p><b>Click</b> to place points · <b>drag a point</b> to move it · <b>drag the picture</b> to move around ·
    <b>scroll / pinch</b> to zoom.</p><p>Then press <b>Save &amp; next</b> (or <kbd>Enter</kbd>).</p>`,
  shapes: `<p><b>◯ Circle</b> – click 3 or more points on the edge (more points = more precise).</p>
    <p><b>▭ Rectangle / □ Square</b> – click 2 opposite corners. Click again to move the nearest corner.</p>
    <p><b>⬠ Polygon</b> – click the corners in order around the area; it closes by itself.</p>
    <p><b>⛶ Whole frame</b> – no crop, the file is only resized / its frame rate reduced.</p>`,
  frames: `<p>For videos the slider shows small <b>preview frames</b> from start to end, so you can check the camera or arena didn't move.
    Your points stay when you change frame.</p><p><b>🔍 Full resolution</b> loads this moment at full size, for precise points.</p>
    <p>Keys: <kbd>←</kbd> <kbd>→</kbd></p>`,
  settings: `<p>How the new files are made. Settings are remembered between sessions.</p>
    <p>The <b>Quick setup</b> buttons fill in good settings for common uses.</p>`,
  output_dir: `<p>Folder for the new files. Leave it <b>empty</b> to use a folder called <code>cropped</code> inside the folder you opened.</p>
    <p>New files keep the original name (only the extension may change). The original files are never modified.</p>`,
  size_box: `<p>The cropped area is scaled to <b>fit inside</b> this size (keeping its proportions).</p>
    <p>Use a <b>square</b> (e.g. 720 × 720) for circles and squares, a wide size (e.g. 1280 × 720) for wide rectangles.</p>
    <p>For tracking an animal, 480–1080 px is plenty and makes files and DeepLabCut much faster.</p>`,
  size_original: `<p>No resizing: the crop keeps the pixels of the original file.</p>`,
  uniform: `<p><b>On</b>: every output has exactly the same size; the area is centred and the rest filled with the background.
    <b>Needed for DeepLabCut</b> and handy for comparing files.</p>
    <p><b>Off</b>: <b>just the crop</b> – each file is only as big as its area. Nice for presentations.</p>`,
  scale_mode: `<p><b>Each ROI fills the frame</b>: every area is scaled as big as possible. If the arena has the same real size in all
    videos, 1 pixel = the same distance in all outputs (one px → cm factor).</p>
    <p><b>Same zoom for every file</b>: all files are shrunk by the same factor, so areas that look smaller in the camera stay smaller.</p>`,
  background: `<p>What fills the space outside the area (and the border when outputs have the same size).</p>
    <p><b>Black</b> is best for tracking. <b>Transparent</b> = no background at all, for slides or video editing.
    MP4 and JPEG can't store transparency, so transparent videos become <b>.mov</b> or <b>.webm</b> and images <b>.png</b>.</p>`,
  transparent_format: `<p><b>.mov (ProRes 4444)</b>: opens in Keynote, Final Cut, Premiere, After Effects, DaVinci. Large files, top quality.</p>
    <p><b>.webm (VP9)</b>: for web pages and browsers; small files. Not supported by Keynote.</p>`,
  fps: `<p>Frames per second of the new videos. Extra frames are simply dropped (e.g. 60 → 10 keeps every 6th frame).</p>
    <p>For position tracking 10–15 fps is usually enough. <b>Keep original</b> = no change.</p>`,
  crf: `<p>MP4 quality (x264 "CRF"): <b>lower = better quality, bigger files</b>. 18 is visually lossless, 20 is a good default,
    23–26 gives small files.</p>`,
  audio: `<p>Copy the sound track into the new videos. Off by default (not needed for tracking).</p>`,
  image_format: `<p>File type of the new images. <b>PNG / TIFF</b> are lossless, <b>JPEG / WebP</b> are small.</p>
    <p>With a transparent background JPEG is replaced by PNG automatically.</p>`,
  no_roi: `<p>What to do with files you didn't draw an area for: <b>skip</b> them, or process the <b>whole frame</b>
    (only resize / frame rate). Use the second one to just downsample a folder.</p>`,
  hwaccel: `<p>Uses the computer's video chip to read the (huge) input videos – much faster. If it doesn't work on your computer
    CropKit switches to normal decoding by itself.</p>`,
  parallel: `<p>How many videos are processed at the same time. 2–3 is usually fastest; more can slow things down.</p>`,
  preset: `<p>MP4 encoding speed. Faster = slightly bigger files. <b>veryfast</b> is a good balance.</p>`,
  preview_n: `<p>How many preview frames the slider has for each video (spread from start to end). Fewer = loads faster.</p>`,
  overwrite: `<p>Off: files that already exist in the output folder are skipped (so you can add new videos and run again).
    On: they are made again.</p>`,
  process: `<p>Makes the new files for all <b>ticked</b> files that have an area (or all ticked files if
    "Files without ROI" is set to whole frame).</p><p>One bar per file shows progress, speed and time left.
    You can keep drawing areas while it runs.</p>`,
};

window.HELP = [
  ["Quick start", `
    <p>CropKit cuts your videos and images down to the part you care about, makes them smaller (resolution and frame rate)
    and saves them all in the same format – e.g. ready for <b>DeepLabCut</b>, or as clean clips for a <b>presentation</b>.</p>
    <ol>
      <li><b>Open folder</b> (top left) – the folder with your videos and/or images. They appear in the list on the left.</li>
      <li><b>Draw the area to keep</b> on the first file: choose a shape (circle, rectangle, square, polygon), click on the picture,
        then press <b>Save &amp; next</b>. Repeat for every file. If the camera didn't move, draw it once and use
        <b>⇉ Copy to other files</b>.</li>
      <li><b>Output settings</b> (right) – or just press a <b>Quick setup</b> button (DeepLabCut / Presentation / Only downsample).</li>
      <li>Press <b>▶ Process</b>. The new files go to the output folder (by default <code>cropped</code> inside your folder).</li>
    </ol>
    <p class="tip">Your originals are never changed. The areas you draw are saved in <code>rois.json</code> next to your files,
    so you can close CropKit and continue later, or process the same files again with other settings.</p>
    <p>Every setting has an <span class="info">i</span> button with a short explanation.</p>`],
  ["Drawing the area", `
    <table>
      <tr><th>Shape</th><th>How</th></tr>
      <tr><td>◯ Circle</td><td>Click <b>3 or more points on the edge</b>, spread around it. The circle is fitted through them; more points = more precise.</td></tr>
      <tr><td>▭ Rectangle</td><td>Click <b>2 opposite corners</b>. Clicking again moves the nearest corner.</td></tr>
      <tr><td>□ Square</td><td>Like rectangle; the side is the longer of the two distances.</td></tr>
      <tr><td>⬠ Polygon</td><td>Click the <b>corners in order</b> around the area (any shape: triangle, L-shape, maze…).</td></tr>
      <tr><td>⛶ Whole frame</td><td>No crop – only resize / reduce frame rate.</td></tr>
    </table>
    <h3>Moving around</h3>
    <ul>
      <li><b>Zoom</b>: mouse wheel or trackpad pinch (zooms where the pointer is). <b>⤢ Fit</b> (<kbd>F</kbd>) shows the whole picture.</li>
      <li><b>Move the picture</b>: drag it.</li>
      <li><b>Move a point</b>: drag the point. <b>Undo</b> (<kbd>Backspace</kbd>) removes the last one, <b>Clear</b> all.</li>
      <li>Everything outside the area is darkened, so you see exactly what will be kept.</li>
    </ul>
    <h3>Videos</h3>
    <p>The slider under the picture shows preview frames from start to end (<kbd>←</kbd> <kbd>→</kbd>): check the area is right during
    the whole video. Points stay when you change frame, so you can click part of an edge on one frame and the rest on another.
    <b>🔍 Full resolution</b> loads the current moment at full size for precise points.</p>
    <h3>Saving</h3>
    <ul>
      <li><b>Save &amp; next</b> (<kbd>Enter</kbd>) saves the area and opens the next file.</li>
      <li><b>⧉ Use previous</b> copies the area of the last file you saved, to adjust it.</li>
      <li><b>⇉ Copy to other files</b> gives this area to other files of the same size.</li>
      <li><b>Remove ROI</b> deletes the saved area of this file.</li>
    </ul>`],
  ["Output settings", `
    <table>
      <tr><td><b>Output folder</b></td><td>Empty = <code>cropped</code> inside the opened folder. Same file names; extension may change.</td></tr>
      <tr><td><b>Fit into W × H</b></td><td>The crop is scaled to fit in this box, keeping proportions.</td></tr>
      <tr><td><b>Keep original resolution</b></td><td>No scaling.</td></tr>
      <tr><td><b>All outputs the same size</b></td><td>On: identical frame size, area centred (DeepLabCut). Off: just the crop.</td></tr>
      <tr><td><b>Scaling between files</b></td><td>"Each ROI fills the frame" = same pixels per cm if the arena has the same real size.</td></tr>
      <tr><td><b>Background</b></td><td>Black / white / any colour / transparent (videos → .mov or .webm, images → .png).</td></tr>
      <tr><td><b>Frame rate</b></td><td>Frames per second of the videos (frames are dropped). 0 / keep original = unchanged.</td></tr>
      <tr><td><b>Quality</b></td><td>Lower number = better quality, bigger files (18–22 recommended).</td></tr>
      <tr><td><b>Files without ROI</b></td><td>Skip, or process the whole frame (only downsample).</td></tr>
    </table>
    <h3>Quick setups</h3>
    <ul>
      <li><b>DeepLabCut</b>: black background, all outputs 720 × 720, 10 fps, MP4.</li>
      <li><b>Presentation</b>: transparent background, just the crop (max 1920 × 1080), original frame rate, .mov.</li>
      <li><b>Only downsample</b>: whole frame for files without an area, max 1280 × 720, original frame rate.</li>
    </ul>`],
  ["DeepLabCut tips", `
    <ul>
      <li>Use the <b>DeepLabCut</b> quick setup: black outside the arena, every video the same size, MP4 (H.264), 10 fps.</li>
      <li>With "each ROI fills the frame", if your arena has the same real size in all videos, <b>one px → cm factor</b> works for all.</li>
      <li><code>processing_params.json</code> in the output folder stores, for every file, the crop and the scale, so you can map
        DeepLabCut coordinates back to the original video:<br>
        <code>x_original = (x_output − roi_offset_out_px[0]) / scale_out_per_in[0] + crop_origin_in_px[0]</code> (same for y with [1]).</li>
      <li>Time: frame <i>i</i> of a new video is at <i>i</i> / fps seconds in the original.</li>
    </ul>`],
  ["Speed", `
    <ul>
      <li>Videos are processed by <b>ffmpeg</b> in a single pass. On a Mac the video chip decodes the input
        (<b>gpu</b> mode); only the frames you keep are copied out, which is much faster for 4K 60 fps recordings.</li>
      <li>Each bar shows <b>× real time</b> (e.g. 3× = a 3-minute video takes 1 minute) and the decoding mode
        (<b>gpu</b> → <b>hw</b> → <b>cpu</b>; CropKit falls back automatically if one doesn't work).</li>
      <li><b>Videos at the same time</b> (Advanced): 2–3 is usually fastest.</li>
      <li>Preview frames are small keyframes that load in the background; fewer preview frames (Advanced) = faster loading.</li>
    </ul>`],
  ["Troubleshooting", `
    <ul>
      <li><b>A video failed</b>: the bar shows the reason; the full ffmpeg log is in <code>_logs/</code> inside the output folder.</li>
      <li><b>"ffmpeg not found"</b>: install it (Mac: <code>brew install ffmpeg</code>) and restart CropKit. CropKit also
        installs a built-in copy (imageio-ffmpeg) automatically.</li>
      <li><b>The folder dialog doesn't appear</b>: it may be behind the window – or paste the path in the box at the top.</li>
      <li><b>Nothing happens on ▶ Process</b>: check the files are ticked and have an area (green "ROI" badge), or set
        "Files without ROI" to whole frame.</li>
      <li><b>Outputs are skipped</b>: they already exist; tick <b>Overwrite</b> in Advanced.</li>
      <li><b>CropKit window closed</b>: CropKit keeps running in the Terminal window; open
        <code>http://127.0.0.1:5056</code> again, or double-click start.command. <b>⏻ Quit</b> stops it.</li>
    </ul>`],
  ["System check", `<div id="syscheck">loading…</div>`],
];
