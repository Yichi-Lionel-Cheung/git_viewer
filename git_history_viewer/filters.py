from __future__ import annotations

from pathlib import PurePosixPath


CODE_EXTENSIONS = {
    ".asm",
    ".bash",
    ".bat",
    ".c",
    ".cc",
    ".clj",
    ".cljs",
    ".cmake",
    ".cpp",
    ".cs",
    ".css",
    ".cu",
    ".cuh",
    ".dart",
    ".erl",
    ".ex",
    ".exs",
    ".fish",
    ".fs",
    ".fsx",
    ".go",
    ".graphql",
    ".gql",
    ".h",
    ".hpp",
    ".hrl",
    ".html",
    ".java",
    ".jl",
    ".js",
    ".jsx",
    ".kt",
    ".kts",
    ".less",
    ".lua",
    ".m",
    ".mm",
    ".nim",
    ".php",
    ".pl",
    ".pm",
    ".proto",
    ".ps1",
    ".py",
    ".r",
    ".rb",
    ".rs",
    ".sass",
    ".scala",
    ".scss",
    ".sh",
    ".sql",
    ".svelte",
    ".swift",
    ".toml",
    ".ts",
    ".tsx",
    ".vue",
    ".xml",
    ".yaml",
    ".yml",
    ".zig",
}

CODE_FILENAMES = {
    "CMakeLists.txt",
    "Dockerfile",
    "Gemfile",
    "Makefile",
    "Rakefile",
}

SKIPPED_FILENAMES = {
    "Cargo.lock",
    "composer.lock",
    "package-lock.json",
    "pnpm-lock.yaml",
    "poetry.lock",
    "yarn.lock",
}

SKIPPED_DIRS = {
    ".cache",
    ".git",
    ".tox",
    ".venv",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "target",
    "vendor",
}


def is_code_path(path_text: str) -> bool:
    path = PurePosixPath(path_text)
    if any(part in SKIPPED_DIRS for part in path.parts):
        return False

    name = path.name
    lower_name = name.lower()
    if name in SKIPPED_FILENAMES:
        return False
    if lower_name.endswith((".bundle.js", ".min.css", ".min.js")):
        return False
    if name in CODE_FILENAMES:
        return True
    return path.suffix.lower() in CODE_EXTENSIONS
