from __future__ import annotations

import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

_GITHUB_NAME_RE = r"[A-Za-z0-9_.-]+"
_GITHUB_SSH_RE = re.compile(
    rf"^git@github\.com:(?P<owner>{_GITHUB_NAME_RE})/(?P<name>{_GITHUB_NAME_RE})(?:\.git)?/?$"
)
_GITHUB_SHORTHAND_RE = re.compile(
    rf"^(?P<owner>{_GITHUB_NAME_RE})/(?P<name>{_GITHUB_NAME_RE})(?:\.git)?/?$"
)


class GitHistoryError(RuntimeError):
    pass


def _run_git_command(command: list[str], cwd: Path | None = None) -> str:
    env = os.environ.copy()
    env["GIT_PAGER"] = "cat"
    env["LC_ALL"] = "C"
    completed = subprocess.run(
        command,
        capture_output=True,
        cwd=str(cwd) if cwd is not None else None,
        env=env,
        text=True,
        errors="replace",
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise GitHistoryError(detail or f"git command failed: {' '.join(command)}")
    return completed.stdout


def run_git(repo: Path, args: list[str]) -> str:
    command = ["git", "-C", str(repo), *args]
    return _run_git_command(command)


def resolve_repo_input(repo_input: str | Path) -> Path:
    repo_text = str(repo_input).strip()
    if not repo_text:
        raise GitHistoryError("Repository path or GitHub URL is required.")

    github_url = _parse_github_repo_input(repo_text)
    if github_url is not None:
        return _sync_github_repo(repo_text, github_url)

    return resolve_repo(Path(repo_text).expanduser())


def resolve_repo(path: Path) -> Path:
    if not path.exists():
        raise GitHistoryError(f"Path does not exist: {path}")
    output = run_git(path, ["rev-parse", "--show-toplevel"]).strip()
    if not output:
        raise GitHistoryError(f"Not a git repository: {path}")
    return Path(output)


def _parse_github_repo_input(repo_text: str) -> str | None:
    expanded = Path(repo_text).expanduser()
    if expanded.exists():
        return None

    ssh_match = _GITHUB_SSH_RE.match(repo_text)
    if ssh_match is not None:
        return _canonical_github_url(ssh_match.group("owner"), ssh_match.group("name"))

    candidate = repo_text
    if repo_text.startswith("github.com/"):
        candidate = f"https://{repo_text}"

    parsed = urlparse(candidate)
    if parsed.scheme in {"http", "https"} or parsed.netloc:
        if parsed.netloc.lower() != "github.com":
            return None
        path_parts = [part for part in parsed.path.split("/") if part]
        if len(path_parts) < 2:
            raise GitHistoryError(f"Invalid GitHub repository URL: {repo_text}")
        return _canonical_github_url(path_parts[0], path_parts[1])

    if repo_text.startswith(("/", "./", "../", "~/")):
        return None
    if os.name == "nt" and re.match(r"^[A-Za-z]:[\\/]", repo_text):
        return None

    shorthand_match = _GITHUB_SHORTHAND_RE.match(repo_text)
    if shorthand_match is None:
        return None
    return _canonical_github_url(
        shorthand_match.group("owner"),
        shorthand_match.group("name"),
    )


def _canonical_github_url(owner: str, name: str) -> str:
    normalized_name = name[:-4] if name.endswith(".git") else name
    return f"https://github.com/{owner}/{normalized_name}.git"


def _sync_github_repo(repo_text: str, github_url: str) -> Path:
    cache_dir = _github_cache_dir(github_url)
    cache_dir.parent.mkdir(parents=True, exist_ok=True)

    if cache_dir.exists():
        existing_url = run_git(cache_dir, ["remote", "get-url", "origin"]).strip()
        if _normalize_remote_url(existing_url) != github_url:
            raise GitHistoryError(
                f"Cached repository remote does not match input: {repo_text}"
            )
    else:
        _run_git_command(["git", "clone", "--no-checkout", github_url, str(cache_dir)])

    run_git(cache_dir, ["fetch", "--prune", "--tags", "origin"])
    return resolve_repo(cache_dir)


def _github_cache_dir(github_url: str) -> Path:
    parsed = urlparse(github_url)
    path_parts = [part for part in parsed.path.split("/") if part]
    owner = path_parts[0].lower()
    repo = path_parts[1].lower()
    if repo.endswith(".git"):
        repo = repo[:-4]
    key = hashlib.sha1(github_url.encode("utf-8")).hexdigest()[:12]
    return _cache_root() / "git_history_viewer" / "github" / f"{owner}--{repo}-{key}"


def _cache_root() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches"
    if os.name == "nt":
        local_app_data = os.getenv("LOCALAPPDATA")
        if local_app_data:
            return Path(local_app_data)
    xdg_cache_home = os.getenv("XDG_CACHE_HOME")
    if xdg_cache_home:
        return Path(xdg_cache_home)
    return Path.home() / ".cache"


def _normalize_remote_url(remote_url: str) -> str:
    parsed = _parse_github_repo_input(remote_url)
    return parsed or remote_url
