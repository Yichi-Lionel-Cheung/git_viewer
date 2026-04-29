from __future__ import annotations

import argparse
import json
import sys

from .history import GitHistoryBuilder
from .payloads import summarize_history
from .server import serve_web_app


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Visualize code-line changes through a git repository history."
    )
    parser.add_argument(
        "repo",
        nargs="?",
        help="Path to a git repository, a GitHub URL, or owner/repo.",
    )
    parser.add_argument("--ref", default="HEAD", help="Git ref to visualize.")
    parser.add_argument("--host", default="127.0.0.1", help="HTTP host.")
    parser.add_argument("--port", default=8765, type=int, help="HTTP port.")
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not open the browser automatically.",
    )
    parser.add_argument(
        "--json-summary",
        action="store_true",
        help="Parse history and print a JSON summary instead of opening the UI.",
    )
    args = parser.parse_args(argv)
    if args.json_summary and not args.repo:
        parser.error("--json-summary requires a repository path.")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    repo = args.repo.strip() if args.repo else ""
    if args.json_summary:
        builder = GitHistoryBuilder(repo, args.ref)
        history = builder.build()
        print(json.dumps(summarize_history(history), indent=2))
        return 0

    return serve_web_app(
        repo=repo,
        ref=args.ref,
        host=args.host,
        port=args.port,
        open_browser=not args.no_browser,
    )
