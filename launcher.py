"""Open CropKit in its own window: a Chrome / Edge / Brave "app window" (no address bar) if one of
them is installed, otherwise the default browser."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import webbrowser
from pathlib import Path

MAC_BROWSERS = ["Google Chrome", "Microsoft Edge", "Brave Browser", "Chromium", "Vivaldi", "Arc"]
WIN_BROWSERS = [
    r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
    r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
    r"%LocalAppData%\Google\Chrome\Application\chrome.exe",
    r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
    r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
    r"%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe",
]
LINUX_BROWSERS = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"]


def app_browser() -> str | None:
    if sys.platform == "darwin":
        for name in MAC_BROWSERS:
            for base in (Path("/Applications"), Path.home() / "Applications"):
                if (base / f"{name}.app").exists():
                    return name
        return None
    if os.name == "nt":
        for p in WIN_BROWSERS:
            path = os.path.expandvars(p)
            if os.path.exists(path):
                return path
        return None
    for name in LINUX_BROWSERS:
        if shutil.which(name):
            return shutil.which(name)
    return None


def open_ui(url: str):
    b = app_browser()
    try:
        if b and sys.platform == "darwin":
            subprocess.Popen(["open", "-na", b, "--args", f"--app={url}", "--window-size=1500,950"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        if b:
            subprocess.Popen([b, f"--app={url}", "--window-size=1500,950"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
    except OSError:
        pass
    webbrowser.open(url)


# ============================================================================ app icon / shortcut
# A clickable CropKit icon that starts CropKit in the background (no Terminal window) and opens its window:
#   Mac: ~/Applications/CropKit.app (+ a copy on the Desktop) – drag it to the Dock to keep it there
#   Windows: shortcuts on the Desktop and in the Start menu – right-click → Pin to taskbar
#   Linux: an entry in the applications menu
# While running in the background, CropKit is stopped with ⏻ Quit in its window.
import plistlib  # noqa: E402

APP_DIR = Path(__file__).resolve().parent
ICONS = APP_DIR / "static" / "icons"
LSREGISTER = ("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/"
              "Support/lsregister")

MAC_SCRIPT = r"""#!/bin/bash
# CropKit launcher – created by CropKit (Home → Create app icon).
# Starts CropKit in the background (or just opens its window if it is already running).
APP_DIR={app_dir}
PORT={port}
LOG={log}
if [ ! -f "$APP_DIR/app.py" ]; then
  osascript -e 'display alert "CropKit" message "The CropKit folder was moved or deleted. Start it once with start.command in its new place, then create the icon again (Home → Create app icon)."'
  exit 1
fi
cd "$APP_DIR" || exit 1
# first start, or new libraries to install: do it in a Terminal window so you can see it
if [ ! -x .venv/bin/python ] || ! cmp -s requirements.txt .venv/requirements.installed; then
  open -a Terminal "$APP_DIR/start.command"
  exit 0
fi
# a git copy fetches the latest version, like start.command does
if [ -d .git ] && command -v git >/dev/null 2>&1; then
  GIT_TERMINAL_PROMPT=0 git pull --ff-only --quiet >/dev/null 2>&1
  if ! cmp -s requirements.txt .venv/requirements.installed; then open -a Terminal "$APP_DIR/start.command"; exit 0; fi
fi
mkdir -p "$(dirname "$LOG")"
nohup ./.venv/bin/python app.py --port "$PORT" >> "$LOG" 2>&1 &
exit 0
"""


def _q(s) -> str:
    return "'" + str(s).replace("'", "'\"'\"'") + "'"


def _psq(s) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def _mac_bundle(dest: Path, port: int, log: Path, version: str) -> Path:
    """The launcher app. Written in place, so an icon already in the Dock keeps working."""
    app = dest / "CropKit.app"
    (app / "Contents" / "MacOS").mkdir(parents=True, exist_ok=True)
    (app / "Contents" / "Resources").mkdir(parents=True, exist_ok=True)
    script = app / "Contents" / "MacOS" / "CropKit"
    script.write_text(MAC_SCRIPT.format(app_dir=_q(APP_DIR), port=int(port), log=_q(log)), encoding="utf-8")
    script.chmod(0o755)
    shutil.copyfile(ICONS / "CropKit.icns", app / "Contents" / "Resources" / "CropKit.icns")
    with open(app / "Contents" / "Info.plist", "wb") as f:
        plistlib.dump({
            "CFBundleName": "CropKit", "CFBundleDisplayName": "CropKit",
            "CFBundleIdentifier": "io.github.mirkozanon.cropkit.launcher",
            "CFBundleExecutable": "CropKit", "CFBundleIconFile": "CropKit",
            "CFBundlePackageType": "APPL", "CFBundleShortVersionString": version, "CFBundleVersion": version,
            "LSMinimumSystemVersion": "10.13", "NSHighResolutionCapable": True,
        }, f)
    os.utime(app, None)  # Finder refreshes the icon
    if os.path.exists(LSREGISTER):
        subprocess.run([LSREGISTER, "-f", str(app)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
    return app


def _win_shortcuts(port: int) -> list[str]:
    pyw = APP_DIR / ".venv" / "Scripts" / "pythonw.exe"
    target = pyw if pyw.exists() else Path(sys.executable).with_name("pythonw.exe")
    if not target.exists():
        target = Path(sys.executable)
    made = []
    for folder in ("Desktop", "Programs"):
        ps = (
            "$f=[Environment]::GetFolderPath('%s');"
            "$s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $f 'CropKit.lnk'));"
            "$s.TargetPath=%s;$s.Arguments=%s;$s.WorkingDirectory=%s;$s.IconLocation=%s;"
            "$s.Description='CropKit – crop, resize and downsample videos and images';$s.Save();"
            "Write-Output (Join-Path $f 'CropKit.lnk')"
        ) % (folder, _psq(target), _psq(f'"{APP_DIR / "app.py"}" --port {int(port)}'), _psq(APP_DIR),
             _psq(ICONS / "CropKit.ico"))
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                           capture_output=True, text=True, timeout=60)
        if r.returncode == 0 and r.stdout.strip():
            made.append(r.stdout.strip().splitlines()[-1])
    if not made:
        raise OSError("Windows did not allow creating the shortcuts.")
    return made


def _linux_entry(port: int) -> list[str]:
    d = Path.home() / ".local" / "share" / "applications"
    d.mkdir(parents=True, exist_ok=True)
    py = APP_DIR / ".venv" / "bin" / "python"
    entry = d / "cropkit.desktop"
    entry.write_text("[Desktop Entry]\nType=Application\nName=CropKit\n"
                     "Comment=Crop, resize and downsample videos and images\n"
                     f"Exec=\"{py if py.exists() else sys.executable}\" \"{APP_DIR / 'app.py'}\" --port {int(port)}\n"
                     f"Path={APP_DIR}\nIcon={ICONS / 'icon-512.png'}\nTerminal=false\nCategories=Graphics;Video;\n",
                     encoding="utf-8")
    entry.chmod(0o755)
    return [str(entry)]


def shortcut_exists() -> bool:
    if sys.platform == "darwin":
        return (Path.home() / "Applications" / "CropKit.app").exists()
    if os.name == "nt":
        return (Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Desktop" / "CropKit.lnk").exists()
    return (Path.home() / ".local" / "share" / "applications" / "cropkit.desktop").exists()


def create_shortcut(port: int, log: Path, version: str, desktop: bool = True) -> dict:
    """Create the CropKit icon for this computer. Returns {"made": [paths], "hint": text}."""
    if sys.platform == "darwin":
        apps = Path.home() / "Applications"
        apps.mkdir(exist_ok=True)
        made = [str(_mac_bundle(apps, port, log, version))]
        warn = ""
        if desktop:
            try:
                made.append(str(_mac_bundle(Path.home() / "Desktop", port, log, version)))
            except OSError as exc:
                warn = f" (The Desktop copy could not be created: {exc.strerror or exc}.)"
        try:
            subprocess.Popen(["open", "-R", made[0]])
        except OSError:
            pass
        return {"made": made, "hint": "A Finder window shows CropKit in your Applications folder: drag it onto the "
                                      "Dock to keep it there. You can also find it with Spotlight (⌘ Space → CropKit)." + warn}
    if os.name == "nt":
        return {"made": _win_shortcuts(port),
                "hint": "CropKit is on your Desktop and in the Start menu. To keep it in the taskbar: open the Start "
                        "menu, right-click CropKit → Pin to taskbar."}
    return {"made": _linux_entry(port), "hint": "CropKit is now in your applications menu."}


def refresh_launchers(port: int, log: Path, version: str) -> list[str]:
    """After an update: give the Mac launcher icons you already have the new version / icon."""
    done = []
    if sys.platform != "darwin":
        return done
    for dest in (Path.home() / "Applications", Path.home() / "Desktop"):
        app = dest / "CropKit.app"
        script = app / "Contents" / "MacOS" / "CropKit"
        try:
            if script.exists() and "CropKit launcher" in script.read_text(encoding="utf-8", errors="ignore"):
                with open(app / "Contents" / "Info.plist", "rb") as f:
                    old = plistlib.load(f)
                same_icon = (ICONS / "CropKit.icns").read_bytes() == (app / "Contents" / "Resources" / "CropKit.icns").read_bytes()
                if old.get("CFBundleShortVersionString") != version or not same_icon:
                    _mac_bundle(dest, port, log, version)
                    done.append(str(app))
        except (OSError, ValueError, plistlib.InvalidFileException):
            continue
    return done
