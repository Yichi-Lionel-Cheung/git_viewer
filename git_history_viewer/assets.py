from __future__ import annotations

import json
from pathlib import Path


PACKAGE_DIR = Path(__file__).resolve().parent
TEMPLATE_DIR = PACKAGE_DIR / "templates"
STATIC_DIR = PACKAGE_DIR / "static"

CONTENT_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
}


def render_html(default_repo: str, default_ref: str) -> bytes:
    template = (TEMPLATE_DIR / "index.html").read_text(encoding="utf-8")
    config = _safe_script_json(
        {
            "defaultRepo": default_repo,
            "defaultRef": default_ref,
        }
    )
    return template.replace("__APP_CONFIG__", config).encode("utf-8")


def read_static_asset(request_path: str) -> tuple[bytes, str] | None:
    relative_path = request_path.removeprefix("/static/").lstrip("/")
    if not relative_path:
        return None

    static_root = STATIC_DIR.resolve()
    asset_path = (STATIC_DIR / relative_path).resolve()
    try:
        asset_path.relative_to(static_root)
    except ValueError:
        return None
    if not asset_path.is_file():
        return None

    content_type = CONTENT_TYPES.get(asset_path.suffix, "application/octet-stream")
    return asset_path.read_bytes(), content_type


def _safe_script_json(value: object) -> str:
    return (
        json.dumps(value)
        .replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
    )
