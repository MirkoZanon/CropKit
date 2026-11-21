/* Texts for the (i) bubbles and the Help window. */
window.INFO = {
  task_crop: `<p>Keep only part of the picture: a <b>circle</b>, <b>rectangle</b>, <b>square</b> or any <b>polygon</b> you draw
    on each file. Everything outside becomes black, a colour of your choice, or transparent.</p>
    <p>Example: cut a video down to the arena an animal moves in.</p>`,
  task_resize: `<p>Change the size of the pictures: <b>fit inside a box</b> (e.g. max 1280 × 720), an <b>exact size</b>,
    or a <b>percentage</b> (e.g. 50 %). Smaller = lighter files and faster analysis (downsampling); bigger is possible too.</p>`,
  task_fps: `<p>Videos only: keep fewer frames per second (60 fps → 10 fps keeps every 6th frame). The video lasts just as long,
    the file is much smaller, and tracking runs much faster.</p>`,
  order: `<p>Whatever you choose, CropKit always works in this order, in a single pass:</p>
    <p><b>① drop frames</b> first – every later step only touches the frames you keep (fastest);<br>
    <b>② crop</b> on the original pixels – the area is exactly what you drew;<br>
    <b>③ resize</b> only what's left – no time spent on pixels that are thrown away, best quality;<br>
    <b>④ background / border</b> – fill outside the area and pad to a common size;<br>
    <b>⑤ save</b> – encoded once (no quality loss from saving several times).</p>`,
  preview: `<p>Crop is off, so there is nothing to draw: this is just a preview of each file (scroll to zoom, drag to move).</p>
    <p>To crop, go back <b>Home</b> (logo at the top left) and tick <b>Crop</b>.</p>`,
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
  settings: `<p>How the new files are made. Only the settings for what you chose on the <b>Home</b> screen are shown.
    Settings are remembered between sessions.</p><p>Recipes on the Home screen fill in good settings for common uses.</p>`,
  output_dir: `<p>Folder for the new files. Leave it <b>empty</b> to use a folder called <code>cropped</code> inside the folder you opened.</p>
    <p>New files keep the original name (only the extension may change). The original files are never modified.</p>`,
  size_box: `<p>The picture (or the cropped area) is scaled to <b>fit inside</b> this box, keeping its proportions:
    e.g. 3840 × 2160 in a 1280 × 720 box becomes 1280 × 720, a 2000 × 2000 crop becomes 720 × 720.</p>
    <p>Use a <b>square</b> box (e.g. 720 × 720) for circles and squares. For tracking an animal 480–1080 px is plenty.</p>`,
  size_exact: `<p>Every output is <b>exactly</b> this size. If the proportions differ you choose: add borders, fill the frame
    (cutting the edges) or stretch.</p>`,
  size_percent: `<p>Width and height are multiplied by this percentage: 50 % = half (a quarter of the pixels), 200 % = double.</p>`,
  allow_upscale: `<p>Off (default): pictures already smaller than the box are left as they are.
    On: they are enlarged to fill the box.</p>`,
  exact_fit: `<p><b>Add borders</b>: the whole picture is kept and centred; the empty sides get the background colour.</p>
    <p><b>Fill the frame</b>: the picture is enlarged until the frame is full; what sticks out is cut off.</p>
    <p><b>Stretch</b>: squeezed to the exact size – proportions change (circles become ovals).</p>`,
  uniform: `<p><b>On</b>: every output has exactly the same size; the picture is centred and the rest filled with the background.
    <b>Needed for DeepLabCut</b> and handy for comparing files.</p>
    <p><b>Off</b>: each file is only as big as its own picture (e.g. <b>just the crop</b>, nice for presentations).</p>`,
  scale_mode: `<p><b>Each ROI fills the frame</b>: every area is scaled as big as possible. If the arena has the same real size in all
    videos, 1 pixel = the same distance in all outputs (one px → cm factor).</p>
    <p><b>Same zoom for every file</b>: all files are shrunk by the same factor, so areas that look smaller in the camera stay smaller.</p>`,
  background: `<p>What fills the space outside the area (and the border when outputs have the same size).</p>
    <p><b>Black</b> is best for tracking. <b>Transparent</b> = no background at all, for slides or video editing.
    MP4 and JPEG can't store transparency, so transparent videos become <b>.mov</b> or <b>.webm</b> and images <b>.png</b>.</p>`,
  transparent_format: `<p><b>.mov (ProRes 4444)</b>: opens in Keynote, Final Cut, Premiere, After Effects, DaVinci. Large files, top quality.</p>
    <p><b>.webm (VP9)</b>: for web pages and browsers; small files. Not supported by Keynote.</p>`,
  fps: `<p>Frames per second of the new videos. Extra frames are simply dropped (e.g. 60 → 10 keeps every 6th frame);
    videos that already have fewer frames are not changed.</p><p>For position tracking 10–15 fps is usually enough.</p>`,
  crf: `<p>MP4 quality (x264 "CRF"): <b>lower = better quality, bigger files</b>. 18 is visually lossless, 20 is a good default,
    23–26 gives small files.</p>`,
  audio: `<p>Copy the sound track into the new videos. Off by default (not needed for tracking).</p>`,
  image_format: `<p>File type of the new images. <b>PNG / TIFF</b> are lossless, <b>JPEG / WebP</b> are small.</p>
    <p>With a transparent background JPEG is replaced by PNG automatically.</p>`,
  no_roi: `<p>What to do with files you didn't draw an area for: <b>skip</b> them, or process the <b>whole frame</b>
    (no crop, only the other steps).</p>`,
  hwaccel: `<p>Uses the computer's video chip to read the (huge) input videos – much faster. If it doesn't work on your computer
    CropKit switches to normal decoding by itself.</p>`,
  parallel: `<p>How many videos are processed at the same time. 2–3 is usually fastest; more can slow things down.</p>`,
  preset: `<p>MP4 encoding speed. Faster = slightly bigger files. <b>veryfast</b> is a good balance.</p>`,
  preview_n: `<p>How many preview frames the slider has for each video (spread from start to end). Fewer = loads faster.</p>`,
  overwrite: `<p>Off: files that already exist in the output folder are skipped (so you can add new videos and run again).
    On: they are made again.</p>`,
  update_check: `<p>CropKit asks GitHub (anonymously) about twice a day whether a newer version exists.
    When there is one, a yellow <b>⬆ Update</b> button appears at the top.</p>`,
  update_auto: `<p>When a new version exists, it is installed by itself the next time you start CropKit
    (a backup of the old version is kept in <code>~/.cropkit/backups</code>).</p>
    <p>If your CropKit folder is a <b>git clone</b>, the start file already updates it with <code>git pull</code>.</p>`,
  process: `<p>Makes the new files for all <b>ticked</b> files that have an area (or all ticked files if
    "Files without ROI" is set to whole frame).</p><p>One bar per file shows progress, speed and time left.
    You can keep drawing areas while it runs.</p>`,
};

window.HELP = [
  ["Quick start", `
    <p>CropKit <b>crops</b>, <b>resizes</b> and changes the <b>frame rate</b> of videos and images – any one of these, or several
    together – and saves them all in the same format: e.g. ready for <b>DeepLabCut</b>, smaller files to share, or clean clips
    for a <b>presentation</b>.</p>
    <ol>
      <li><b>Home</b> (click the CropKit logo): tick what you want to do – <b>Crop</b>, <b>Resize</b>, <b>Frame rate</b> – or pick a
        <b>recipe</b>. Press <b>Continue</b>.</li>
      <li><b>Open folder</b> (top) – the folder with your videos and/or images. They appear on the left.</li>
      <li>If you crop: <b>draw the area to keep</b> on each file and press <b>Save &amp; next</b>. If the camera didn't move,
        draw once and use <b>⇉ Copy to other files</b>.</li>
      <li>Check the <b>settings</b> on the right (only those you need are shown).</li>
      <li>Press <b>▶ Process</b>. New files go to <code>cropped</code> inside your folder (or the output folder you chose).</li>
    </ol>
    <p class="tip">Your originals are never changed. Areas you draw are saved in <code>rois.json</code> next to your files, so you can
    stop and continue later, or process the same files again with other settings.</p>
    <p>Every setting has an <span class="info">i</span> button with a short explanation.</p>`],
  ["What to do & in which order", `
    <table>
      <tr><th>Task</th><th>What it does</th></tr>
      <tr><td>✂️ Crop</td><td>Keep an area (circle, rectangle, square, polygon); outside = colour or transparent.</td></tr>
      <tr><td>⤡ Resize</td><td>Fit in a box, exact size (borders / fill / stretch) or percentage. Smaller = downsampling.</td></tr>
      <tr><td>⏱ Frame rate</td><td>Videos: keep fewer frames per second.</td></tr>
    </table>
    <p>Combine them freely. CropKit always applies them in one pass, in this order:</p>
    <p><b>① drop frames → ② crop → ③ resize → ④ background / border → ⑤ save</b></p>
    <ul>
      <li><b>Frames first</b>: every later step only touches the frames you keep – the biggest speed-up.</li>
      <li><b>Crop before resize</b>: the area is exact in the original pixels, and no time or quality is spent resizing
        pixels that are thrown away.</li>
      <li><b>Saved once</b>: no quality loss from saving the file several times.</li>
    </ul>
    <h3>Recipes</h3>
    <ul>
      <li><b>DeepLabCut</b>: crop the arena, black outside, all 720 × 720, 10 fps, MP4.</li>
      <li><b>Clip for slides</b>: crop, transparent outside, max 1920 × 1080, original frame rate (.mov / .png).</li>
      <li><b>Smaller videos</b>: max 1280 × 720, 30 fps.</li>
      <li><b>Only frame rate</b>: 10 fps, picture unchanged.</li>
      <li><b>Half size</b>: all images and videos at 50 %.</li>
    </ul>`],
  ["App icon", `
    <p>On the Home screen, <b>Create app icon</b> makes CropKit a normal app on your computer:</p>
    <ul>
      <li><b>Mac</b>: <code>CropKit</code> in your Applications folder (and on the Desktop). Drag it onto the Dock to keep it there;
        Spotlight finds it too (⌘ Space → CropKit).</li>
      <li><b>Windows</b>: on the Desktop and in the Start menu (right-click → Pin to taskbar).</li>
      <li><b>Linux</b>: in the applications menu.</li>
    </ul>
    <p>The icon starts CropKit in the background – no Terminal window – and opens its window. If CropKit is already running it
    just opens the window. Stop it with <b>⏻ Quit</b>. The first start after installing (or when new libraries are needed)
    still opens a Terminal window once, to set things up.</p>
    <p>If you move the CropKit folder, create the icon again.</p>`],
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
  ["Settings", `
    <table>
      <tr><td><b>Output folder</b></td><td>Empty = <code>cropped</code> inside the opened folder. Same file names; extension may change.</td></tr>
      <tr><td><b>Resize: fit inside a box</b></td><td>Scaled to fit in W × H, keeping proportions (optionally enlarging small ones).</td></tr>
      <tr><td><b>Resize: exact size</b></td><td>Exactly W × H: add borders, fill (cut edges) or stretch.</td></tr>
      <tr><td><b>Resize: percentage</b></td><td>50 % = half width and height.</td></tr>
      <tr><td><b>All outputs the same size</b></td><td>On: identical frame size, area centred (DeepLabCut). Off: just the crop.</td></tr>
      <tr><td><b>Scaling between files</b></td><td>"Each ROI fills the frame" = same pixels per cm if the arena has the same real size.</td></tr>
      <tr><td><b>Background</b></td><td>Black / white / any colour / transparent (videos → .mov or .webm, images → .png).</td></tr>
      <tr><td><b>Frame rate</b></td><td>Frames per second of the videos (frames are dropped).</td></tr>
      <tr><td><b>Quality</b></td><td>Lower number = better quality, bigger files (18–22 recommended).</td></tr>
      <tr><td><b>Files without area</b></td><td>Skip, or process the whole frame.</td></tr>
    </table>`],
  ["DeepLabCut tips", `
    <ul>
      <li>Use the <b>DeepLabCut</b> recipe on the Home screen: crop the arena, black outside, every video 720 × 720, MP4 (H.264), 10 fps.</li>
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
      <li><b>Nothing happens on ▶ Process</b>: check the files are ticked and – if you crop – have an area (green "area" badge),
        or set "Files without area" to whole frame.</li>
      <li><b>Outputs are skipped</b>: they already exist; tick <b>Overwrite</b> in Advanced.</li>
      <li><b>CropKit window closed</b>: CropKit keeps running in the Terminal window; open
        <code>http://127.0.0.1:5056</code> again, or double-click start.command. <b>⏻ Quit</b> stops it.</li>
    </ul>`],
  ["Updates", `
    <p>CropKit updates itself from its GitHub page.</p>
    <ul>
      <li>When a new version exists, a yellow <b>⬆ Update</b> button appears at the top. Click it, then
        <b>Install update</b> and <b>Restart</b> – your settings and drawn areas are kept.</li>
      <li>Click the <b>version number</b> (top right) to check now and to switch automatic checking / installing on or off.</li>
      <li>By default new versions are installed automatically when CropKit starts.</li>
      <li>Before every update a backup of the old version is saved in <code>~/.cropkit/backups</code>.</li>
      <li>If the CropKit folder is a <b>git clone</b>, the update runs <code>git pull</code> (and so does the start file).</li>
    </ul>`],
  ["System check", `<div id="syscheck">loading…</div>`],
];
