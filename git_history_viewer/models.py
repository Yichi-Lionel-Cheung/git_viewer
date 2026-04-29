from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable


@dataclass(frozen=True)
class FileChange:
    path: str
    display_path: str
    additions: int
    deletions: int
    old_path: str | None = None


@dataclass(frozen=True)
class CommitMeta:
    commit_hash: str
    short_hash: str
    author: str
    date: str
    subject: str


@dataclass(frozen=True)
class CommitFrame:
    index: int
    meta: CommitMeta
    changes: tuple[FileChange, ...]
    file_lines: dict[str, int]
    total_lines: int
    file_count: int
    total_additions: int
    total_deletions: int


@dataclass(frozen=True)
class GitHistory:
    repo: Path
    ref: str
    frames: tuple[CommitFrame, ...]


ProgressCallback = Callable[[int, int, str], None]
