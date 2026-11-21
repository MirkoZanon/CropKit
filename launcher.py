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
