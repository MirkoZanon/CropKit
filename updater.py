"""In-app updates: check the public GitHub repository for a newer version and install it.

How it works
------------
* The app's version is in ``VERSION``; the repository to check is in ``update.json``
  (``{"repo": "owner/name"}``). A copy that is itself a git clone can also use its ``origin`` remote.
* "Check for updates" asks GitHub for the latest *release* of that repository. If the repository has no
  releases yet, the ``VERSION`` file on its main branch is used instead.
* "Install" downloads the new version (a zip from github.com), checks it, keeps a backup of the current
  app files in ``~/.cropkit/backups``, replaces the app files and restarts the app.
  If the app folder is a git clone, ``git pull`` is used instead.
* Settings live in ``~/.cropkit`` and your ROIs next to your videos – an update never touches them.

Privacy: the check is an anonymous request to GitHub, like opening the repository page in a browser.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import zipfile
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import requests

APP_DIR = Path(__file__).resolve().parent
APP_NAME = "CropKit"
API = "https://api.github.com"
RAW = "https://raw.githubusercontent.com"
ALLOWED_HOSTS = {"api.github.com", "github.com", "codeload.github.com", "objects.githubusercontent.com",
                 "release-assets.githubusercontent.com", "raw.githubusercontent.com"}
MAX_ZIP = 60 * 1024 * 1024
KEEP = {".venv", "venv", ".git", "__pycache__", ".DS_Store", "Thumbs.db", "backups"}   # never replaced or removed
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
PLACEHOLDER = "YOUR-GITHUB-NAME"


class UpdateError(Exception):
    """Shown to the user as is."""


PROGRESS: dict = {}   # what a running install is doing (for the progress bar)


def _progress(stage: str, done: int | None = None, total: int | None = None):
    PROGRESS.update(stage=stage, done=done, total=total, t=time.time())


# --------------------------------------------------------------------------- versions
def read_version(folder: Path = APP_DIR) -> str:
    try:
        return (folder / "VERSION").read_text(encoding="utf-8").strip() or "0"
    except OSError:
        return "0"


def parse_version(v: str) -> tuple:
    nums = re.findall(r"\d+", (v or "").split("-")[0].split("+")[0])
    return tuple(int(n) for n in nums[:4]) or (0,)


def is_newer(a: str, b: str) -> bool:
    """True when version a is newer than version b."""
    pa, pb = parse_version(a), parse_version(b)
    n = max(len(pa), len(pb))
    return pa + (0,) * (n - len(pa)) > pb + (0,) * (n - len(pb))


# --------------------------------------------------------------------------- configuration
def is_git_checkout(folder: Path = APP_DIR) -> bool:
    return (folder / ".git").exists()


def _git_remote_repo(folder: Path = APP_DIR) -> str:
    try:
        cfg = (folder / ".git" / "config").read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""
    m = re.search(r'\[remote "origin"\][^\[]*?url\s*=\s*(\S+)', cfg)
    if not m:
        return ""
    m2 = re.search(r"github\.com[:/]([^/\s]+/[^/\s]+?)(?:\.git)?/?$", m.group(1))
    return m2.group(1) if m2 else ""


def config(folder: Path = APP_DIR) -> dict:
    try:
        data = json.loads((folder / "update.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    repo = (data.get("repo") or "").strip().strip("/")
    if repo.startswith("https://github.com/"):
        repo = repo[len("https://github.com/"):].removesuffix(".git").strip("/")
    if not REPO_RE.match(repo) or PLACEHOLDER in repo:
        repo = _git_remote_repo(folder)
    return {"repo": repo, "branch": (data.get("branch") or "main").strip() or "main",
            "asset_prefix": data.get("asset_prefix") or APP_NAME}


# --------------------------------------------------------------------------- HTTP
def _get(url, *, accept="application/vnd.github+json", timeout=20, stream=False):
    if (urlparse(url).hostname or "") not in ALLOWED_HOSTS:
        raise UpdateError("Updates can only be downloaded from GitHub.")
    try:
        r = requests.get(url, headers={"Accept": accept, "User-Agent": f"{APP_NAME}-updater"},
                         timeout=timeout, allow_redirects=True, stream=stream)
    except requests.exceptions.RequestException as exc:
        raise UpdateError(f"Could not reach GitHub ({exc.__class__.__name__}). Check your internet connection.") from exc
    if (urlparse(r.url).hostname or "") not in ALLOWED_HOSTS:
        raise UpdateError("The download was redirected outside GitHub – stopped for safety.")
    if r.status_code == 403 and "rate limit" in (r.text or "").lower():
        raise UpdateError("GitHub limits anonymous checks to 60 per hour – try again later.")
    return r


# --------------------------------------------------------------------------- check
def _from_branch(out, cfg, timeout):
    repo = cfg["repo"]
    v = _get(f"{RAW}/{repo}/{cfg['branch']}/VERSION", accept="text/plain", timeout=timeout)
    if v.status_code != 200:
        raise UpdateError(f"Couldn't find the {APP_NAME} repository “{repo}” on GitHub. "
                          "It must be public; check the name in update.json.")
    notes = ""
    c = _get(f"{RAW}/{repo}/{cfg['branch']}/CHANGELOG.md", accept="text/plain", timeout=timeout)
    latest = v.text.strip()
    if c.status_code == 200:   # the "## <version>" section of the changelog
        m = re.search(rf"^##\s+{re.escape(latest)}\s*$(.*?)(?=^##\s|\Z)", c.text, re.M | re.S)
        notes = m.group(1).strip() if m else ""
    out.update(latest=latest, notes=notes[:6000], page=f"https://github.com/{repo}", published=None,
               source="branch", download=f"https://github.com/{repo}/archive/refs/heads/{cfg['branch']}.zip")


def check(cfg: dict | None = None, current: str | None = None, timeout: int = 20) -> dict:
    cfg = cfg or config()
    current = current or read_version()
    out = {"current": current, "repo": cfg["repo"], "configured": bool(cfg["repo"]),
           "git": is_git_checkout(), "available": False}
    if not cfg["repo"]:
        return out
    repo = cfg["repo"]
    r = _get(f"{API}/repos/{repo}/releases/latest", timeout=timeout)
    if r.status_code == 200:
        rel = r.json()
        latest = (rel.get("tag_name") or rel.get("name") or "").lstrip("vV")
        download = rel.get("zipball_url") or f"https://github.com/{repo}/archive/refs/tags/{rel.get('tag_name')}.zip"
        for a in rel.get("assets") or []:   # a ready-made zip attached to the release is preferred
            name = a.get("name") or ""
            if name.lower().endswith(".zip") and name.lower().startswith(cfg["asset_prefix"].lower()):
                download = a.get("browser_download_url") or download
                break
        out.update(latest=latest, notes=(rel.get("body") or "").strip()[:6000], page=rel.get("html_url"),
                   published=rel.get("published_at"), source="release", download=download)
    elif r.status_code in (403, 404):
        # 404: no release yet. 403: the API is blocked/limited – the raw VERSION file still works.
        _from_branch(out, cfg, timeout)
    else:
        raise UpdateError(f"GitHub answered with an error ({r.status_code}). Try again later.")
    out["available"] = is_newer(out["latest"], current)
    return out


# --------------------------------------------------------------------------- install
def download(url: str) -> bytes:
    r = _get(url, accept="application/octet-stream", timeout=120, stream=True)
    if r.status_code != 200:
        raise UpdateError(f"The download failed (GitHub answered {r.status_code}).")
    try:
        total = int(r.headers.get("Content-Length") or 0) or None
    except ValueError:
        total = None
    buf = io.BytesIO()
    _progress("download", 0, total)
    for chunk in r.iter_content(64 * 1024):
        buf.write(chunk)
        _progress("download", buf.tell(), total)
        if buf.tell() > MAX_ZIP:
            raise UpdateError("The download is unexpectedly large – stopped.")
    return buf.getvalue()


def _extract(data: bytes, dest: Path) -> Path:
    """Safely unpack the zip and return the folder that contains app.py."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise UpdateError("That file is not a valid zip archive.") from exc
    root = dest.resolve()
    for info in zf.infolist():
        name = info.filename
        target = (dest / name).resolve()
        if name.startswith(("/", "\\")) or ".." in Path(name).parts or not str(target).startswith(str(root)):
            raise UpdateError("The archive contains unsafe paths – stopped.")
        if stat.S_ISLNK(info.external_attr >> 16):
            continue  # never unpack symbolic links
        if info.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, open(target, "wb") as out:
            shutil.copyfileobj(src, out)
    cands = sorted((p.parent for p in dest.rglob("app.py") if (p.parent / "VERSION").exists()),
                   key=lambda p: len(p.parts))
    if not cands or not (cands[0] / "static" / "index.html").exists() or not (cands[0] / "media.py").exists():
        raise UpdateError(f"This archive doesn't look like a {APP_NAME} version (app.py, media.py or static/ missing).")
    return cands[0]


def _app_files(folder: Path):
    for p in sorted(folder.rglob("*")):
        rel = p.relative_to(folder)
        if any(part in KEEP or part.endswith(".pyc") for part in rel.parts):
            continue
        if p.is_file() and not p.is_symlink():
            yield rel


def backup(backup_dir: Path, version: str, folder: Path = APP_DIR) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    path = backup_dir / f"app-{version}-{datetime.now():%Y%m%d-%H%M%S}.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in _app_files(folder):
            z.write(folder / rel, Path(APP_NAME) / rel)
    olds = sorted(backup_dir.glob("app-*.zip"), key=lambda p: p.stat().st_mtime)
    for old in olds[:-5]:  # keep the last five
        try:
            old.unlink()
        except OSError:
            pass
    return path


def _digest(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _replace(tmp: Path, dest: Path, tries: int = 25):
    """os.replace, patient on Windows (an antivirus may lock a just-written file for a moment)."""
    for i in range(tries):
        try:
            os.replace(tmp, dest)
            return
        except PermissionError:
            if i == tries - 1:
                raise UpdateError(f"Windows didn't let {APP_NAME} replace {dest.name} (the file is in use – "
                                  "maybe by an antivirus scan). Try again in a minute.")
            time.sleep(0.4)


def _replace_files(src: Path, dst: Path) -> list[str]:
    changed = []
    files = list(_app_files(src))
    for i, rel in enumerate(files):
        _progress("files", i, len(files))
        s, d = src / rel, dst / rel
        if d.exists() and d.is_file() and _digest(s) == _digest(d):
            continue
        d.parent.mkdir(parents=True, exist_ok=True)
        tmp = d.with_name(d.name + ".cropkit-tmp")
        shutil.copyfile(s, tmp)
        if rel.suffix in (".command", ".sh") or rel.name == "app.py":
            tmp.chmod(0o755)
        _replace(tmp, d)
        changed.append(rel.as_posix())
    return changed


def _install_requirements(folder: Path, before: bytes | None) -> str:
    req = folder / "requirements.txt"
    if not req.exists() or req.read_bytes() == before:
        return ""
    _progress("libraries")
    r = subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "-r", str(req)],
                       capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        return ("New libraries could not be installed now; they will be installed the next time you start "
                f"{APP_NAME} with the start file. " + (r.stderr or "")[-300:])
    marker = folder / ".venv" / "requirements.installed"
    if marker.parent.is_dir():
        shutil.copyfile(req, marker)
    return ""


def install_zip(data: bytes, backup_dir: Path, *, folder: Path = APP_DIR, allow_same=False) -> dict:
    current = read_version(folder)
    req_before = (folder / "requirements.txt").read_bytes() if (folder / "requirements.txt").exists() else None
    with tempfile.TemporaryDirectory(prefix="cropkit-update-") as tmp:
        _progress("unpack")
        src = _extract(data, Path(tmp))
        new = read_version(src)
        if not is_newer(new, current) and not (allow_same and new == current):
            raise UpdateError(f"This is version {new}; you already have {current}. Nothing to do.")
        _progress("backup")
        bk = backup(backup_dir, current, folder)
        changed = _replace_files(src, folder)
    warn = _install_requirements(folder, req_before)
    return {"installed": new, "previous": current, "changed": changed, "backup": str(bk), "warning": warn}


def install_git(backup_dir: Path, folder: Path = APP_DIR) -> dict:
    current = read_version(folder)
    if not shutil.which("git"):
        raise UpdateError("This app folder is a git copy but git isn't available – run “git pull” yourself.")
    req_before = (folder / "requirements.txt").read_bytes() if (folder / "requirements.txt").exists() else None
    _progress("backup")
    bk = backup(backup_dir, current, folder)
    _progress("git")
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    r = subprocess.run(["git", "pull", "--ff-only"], cwd=folder, capture_output=True, text=True, env=env, timeout=180)
    if r.returncode != 0:
        msg = (r.stderr or r.stdout or "").strip()
        if "local changes" in msg or "would be overwritten" in msg or "diverg" in msg or "not possible to fast-forward" in msg:
            msg = ("this copy has its own changes. Commit or discard them (e.g. in VS Code → Source Control), "
                   "then try again.")
        raise UpdateError(f"git pull failed: {msg[-400:]}")
    warn = _install_requirements(folder, req_before)
    return {"installed": read_version(folder), "previous": current, "changed": [], "backup": str(bk),
            "warning": warn, "git": True}


def install(info: dict, backup_dir: Path) -> dict:
    """Install the version described by check()."""
    if info.get("git"):
        return install_git(backup_dir)
    if not info.get("download"):
        raise UpdateError("Nothing to download – check for updates first.")
    return install_zip(download(info["download"]), backup_dir)


# --------------------------------------------------------------------------- restart
def restart_command(argv=None, browser=False) -> list[str]:
    args = [a for a in (argv if argv is not None else sys.argv[1:]) if a != "--no-browser"]
    return [sys.executable, str(APP_DIR / "app.py"), *args] + ([] if browser else ["--no-browser"])


def spawn_detached(argv=None, browser=False) -> bool:
    """Windows: start the new version as its own process that waits until this one has freed the port."""
    cmd = restart_command(argv, browser)
    exe = Path(sys.executable)
    pyw = exe.with_name("pythonw.exe")
    if pyw.exists():
        cmd[0] = str(pyw)
    flags = getattr(subprocess, "DETACHED_PROCESS", 0x8) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200)
    env = dict(os.environ, CROPKIT_WAIT_PORT="1")
    try:
        subprocess.Popen(cmd, cwd=str(APP_DIR), env=env, creationflags=flags, close_fds=True,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except OSError as exc:
        print(f"  Could not start the new version by itself: {exc}")
        return False


def relaunch(argv=None, browser=False):
    """Start the (new) app in place of this one (after the web server has stopped, or before it started)."""
    cmd = restart_command(argv, browser)
    sys.stdout.flush()
    time.sleep(0.3)
    os.environ["CROPKIT_WAIT_PORT"] = "1"
    if os.name == "nt":
        sys.exit(subprocess.call(cmd))
    os.execv(sys.executable, cmd)
