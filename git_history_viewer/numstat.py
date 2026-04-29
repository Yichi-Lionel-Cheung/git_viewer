from __future__ import annotations

from .filters import is_code_path
from .models import FileChange


def expand_git_rename(path_text: str) -> tuple[str | None, str]:
    path_text = path_text.strip()
    open_brace = path_text.find("{")
    close_brace = path_text.find("}", open_brace + 1)
    if open_brace != -1 and close_brace != -1:
        inside = path_text[open_brace + 1 : close_brace]
        if " => " in inside:
            old_piece, new_piece = inside.split(" => ", 1)
            prefix = path_text[:open_brace]
            suffix = path_text[close_brace + 1 :]
            return prefix + old_piece + suffix, prefix + new_piece + suffix

    if " => " in path_text:
        old_path, new_path = path_text.split(" => ", 1)
        return old_path.strip(), new_path.strip()

    return None, path_text


def parse_numstat(output: str) -> tuple[FileChange, ...]:
    changes: list[FileChange] = []
    for raw_line in output.splitlines():
        if not raw_line:
            continue
        parts = raw_line.split("\t", 2)
        if len(parts) != 3:
            continue
        additions_text, deletions_text, raw_path = parts
        if additions_text == "-" or deletions_text == "-":
            continue
        try:
            additions = int(additions_text)
            deletions = int(deletions_text)
        except ValueError:
            continue

        old_path, new_path = expand_git_rename(raw_path)
        old_is_code = old_path is not None and is_code_path(old_path)
        new_is_code = is_code_path(new_path)
        if not old_is_code and not new_is_code:
            continue

        display_path = new_path if new_is_code else (old_path or new_path)
        changes.append(
            FileChange(
                path=new_path,
                display_path=display_path,
                additions=additions,
                deletions=deletions,
                old_path=old_path,
            )
        )
    return tuple(changes)
