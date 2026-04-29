from __future__ import annotations

from .models import CommitFrame, GitHistory


def collect_change_totals(frame: CommitFrame) -> dict[str, tuple[int, int]]:
    totals: dict[str, tuple[int, int]] = {}
    for change in frame.changes:
        additions, deletions = totals.get(change.display_path, (0, 0))
        totals[change.display_path] = (
            additions + change.additions,
            deletions + change.deletions,
        )
    return totals


def history_to_payload(history: GitHistory) -> dict[str, object]:
    frames: list[dict[str, object]] = []
    for frame in history.frames:
        changes = [
            {"path": path, "additions": additions, "deletions": deletions}
            for path, (additions, deletions) in sorted(
                collect_change_totals(frame).items()
            )
        ]
        files = [
            {"path": path, "lines": lines}
            for path, lines in sorted(frame.file_lines.items())
        ]
        frames.append(
            {
                "index": frame.index,
                "hash": frame.meta.commit_hash,
                "short_hash": frame.meta.short_hash,
                "author": frame.meta.author,
                "date": frame.meta.date,
                "subject": frame.meta.subject,
                "files": files,
                "changes": changes,
                "file_count": frame.file_count,
                "total_lines": frame.total_lines,
                "additions": frame.total_additions,
                "deletions": frame.total_deletions,
            }
        )

    return {
        "repo": str(history.repo),
        "ref": history.ref,
        "frames": frames,
    }


def summarize_history(history: GitHistory) -> dict[str, object]:
    last = history.frames[-1]
    return {
        "repo": str(history.repo),
        "ref": history.ref,
        "commits": len(history.frames),
        "code_files": last.file_count,
        "code_lines": last.total_lines,
        "last_commit": {
            "hash": last.meta.commit_hash,
            "short_hash": last.meta.short_hash,
            "date": last.meta.date,
            "author": last.meta.author,
            "subject": last.meta.subject,
        },
    }
