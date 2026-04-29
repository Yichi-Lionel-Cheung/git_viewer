from __future__ import annotations

from pathlib import Path

from .filters import is_code_path
from .git_client import GitHistoryError, resolve_repo_input, run_git
from .models import CommitFrame, CommitMeta, FileChange, GitHistory, ProgressCallback
from .numstat import parse_numstat


class GitHistoryBuilder:
    def __init__(self, repo_path: str | Path, ref: str = "HEAD") -> None:
        self.repo_path = repo_path
        self.ref = ref

    def build(self, progress: ProgressCallback | None = None) -> GitHistory:
        repo = resolve_repo_input(self.repo_path)
        commits = self._read_first_parent_commits(repo)
        if not commits:
            raise GitHistoryError("Repository has no commits.")

        metadata = self._read_metadata(repo)
        line_counts: dict[str, int] = {}
        frames: list[CommitFrame] = []
        previous_commit: str | None = None

        total_commits = len(commits)
        for index, commit_hash in enumerate(commits):
            if progress is not None:
                progress(
                    index + 1,
                    total_commits,
                    f"Reading commit {index + 1:,}/{total_commits:,}",
                )

            diff_output = self._read_diff(repo, previous_commit, commit_hash)
            changes = parse_numstat(diff_output)
            self._apply_changes(line_counts, changes)
            meta = metadata.get(commit_hash)
            if meta is None:
                meta = CommitMeta(
                    commit_hash=commit_hash,
                    short_hash=commit_hash[:7],
                    author="",
                    date="",
                    subject="",
                )

            total_additions = sum(change.additions for change in changes)
            total_deletions = sum(change.deletions for change in changes)
            snapshot = dict(sorted(line_counts.items()))
            frames.append(
                CommitFrame(
                    index=index,
                    meta=meta,
                    changes=changes,
                    file_lines=snapshot,
                    total_lines=sum(snapshot.values()),
                    file_count=len(snapshot),
                    total_additions=total_additions,
                    total_deletions=total_deletions,
                )
            )
            previous_commit = commit_hash

        return GitHistory(repo=repo, ref=self.ref, frames=tuple(frames))

    def _read_first_parent_commits(self, repo: Path) -> list[str]:
        output = run_git(
            repo,
            ["rev-list", "--reverse", "--first-parent", self.ref],
        )
        return [line.strip() for line in output.splitlines() if line.strip()]

    def _read_metadata(self, repo: Path) -> dict[str, CommitMeta]:
        format_arg = "%H%x1f%h%x1f%an%x1f%ad%x1f%s"
        output = run_git(
            repo,
            [
                "log",
                "--reverse",
                "--first-parent",
                "--date=short",
                f"--format={format_arg}",
                self.ref,
            ],
        )
        metadata: dict[str, CommitMeta] = {}
        for line in output.splitlines():
            parts = line.split("\x1f", 4)
            if len(parts) != 5:
                continue
            commit_hash, short_hash, author, date, subject = parts
            metadata[commit_hash] = CommitMeta(
                commit_hash=commit_hash,
                short_hash=short_hash,
                author=author,
                date=date,
                subject=subject,
            )
        return metadata

    def _read_diff(self, repo: Path, old_commit: str | None, new_commit: str) -> str:
        if old_commit is None:
            return run_git(
                repo,
                [
                    "diff-tree",
                    "--root",
                    "-r",
                    "-M",
                    "--numstat",
                    "--no-commit-id",
                    new_commit,
                ],
            )
        return run_git(
            repo,
            ["diff", "-M", "--numstat", old_commit, new_commit, "--"],
        )

    def _apply_changes(
        self, line_counts: dict[str, int], changes: tuple[FileChange, ...]
    ) -> None:
        for change in changes:
            if change.old_path is not None and change.old_path in line_counts:
                old_lines = line_counts.pop(change.old_path)
            else:
                old_lines = line_counts.get(change.path, 0)

            new_lines = max(0, old_lines + change.additions - change.deletions)
            if is_code_path(change.path) and new_lines > 0:
                line_counts[change.path] = new_lines
            else:
                line_counts.pop(change.path, None)
