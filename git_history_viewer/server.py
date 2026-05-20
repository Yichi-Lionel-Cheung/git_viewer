from __future__ import annotations

import json
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .assets import read_static_asset, render_html
from .history import GitHistoryBuilder
from .jobs import HistoryJobManager
from .payloads import history_to_payload


def make_handler(
    default_repo: str,
    default_ref: str,
    jobs: HistoryJobManager | None = None,
) -> type[BaseHTTPRequestHandler]:
    job_manager = jobs or HistoryJobManager()

    class ViewerRequestHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.handle_request(send_body=True)

        def do_HEAD(self) -> None:
            self.handle_request(send_body=False)

        def handle_request(self, send_body: bool) -> None:
            parsed = urlparse(self.path)
            if parsed.path == "/":
                self.respond_bytes(
                    200,
                    render_html(default_repo, default_ref),
                    "text/html; charset=utf-8",
                    send_body=send_body,
                )
                return

            if parsed.path.startswith("/static/"):
                asset = read_static_asset(parsed.path)
                if asset is None:
                    self.respond_json(404, {"error": "Static asset not found."})
                    return
                body, content_type = asset
                self.respond_bytes(200, body, content_type, send_body=send_body)
                return

            if parsed.path == "/api/history":
                if not send_body:
                    self.respond_json(
                        405, {"error": "Method not allowed."}, send_body=False
                    )
                    return
                self.handle_history_request(parsed.query)
                return

            if parsed.path == "/api/start-history":
                if not send_body:
                    self.respond_json(
                        405, {"error": "Method not allowed."}, send_body=False
                    )
                    return
                self.handle_start_history_request(parsed.query)
                return

            if parsed.path == "/api/job":
                if not send_body:
                    self.respond_json(
                        405, {"error": "Method not allowed."}, send_body=False
                    )
                    return
                self.handle_job_request(parsed.query)
                return

            if parsed.path == "/favicon.ico":
                self.respond_bytes(204, b"", "image/x-icon", send_body=send_body)
                return

            self.respond_json(404, {"error": "Not found"})

        def handle_history_request(self, query: str) -> None:
            repo_text, ref, ignore_tests = _history_params(query)
            if not repo_text:
                self.respond_json(
                    400, {"error": "Repository path or GitHub URL is required."}
                )
                return

            try:
                builder = GitHistoryBuilder(repo_text, ref, ignore_tests=ignore_tests)
                history = builder.build()
                self.respond_json(200, history_to_payload(history))
            except Exception as exc:  # noqa: BLE001
                self.respond_json(400, {"error": str(exc)})

        def handle_start_history_request(self, query: str) -> None:
            repo_text, ref, ignore_tests = _history_params(query)
            if not repo_text:
                self.respond_json(
                    400, {"error": "Repository path or GitHub URL is required."}
                )
                return

            job_id = job_manager.start(repo_text, ref, ignore_tests=ignore_tests)
            self.respond_json(
                202,
                {
                    "job_id": job_id,
                    "status": "queued",
                    "done": 0,
                    "total": 0,
                    "message": "Queued",
                },
            )

        def handle_job_request(self, query: str) -> None:
            params = parse_qs(query)
            job_values = params.get("id", [])
            job_id = job_values[0].strip() if job_values else ""
            if not job_id:
                self.respond_json(400, {"error": "Job id is required."})
                return

            payload = job_manager.payload(job_id)
            if payload is None:
                self.respond_json(404, {"error": "Job not found."})
                return
            self.respond_json(200, payload)

        def respond_json(
            self,
            status: int,
            payload: dict[str, object],
            send_body: bool = True,
        ) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.respond_bytes(
                status,
                body,
                "application/json; charset=utf-8",
                send_body=send_body,
            )

        def respond_bytes(
            self,
            status: int,
            body: bytes,
            content_type: str,
            send_body: bool = True,
        ) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if send_body and body:
                self.wfile.write(body)

        def log_message(self, format_text: str, *args: object) -> None:
            message = format_text % args
            sys.stderr.write(f"[viewer] {message}\n")

    return ViewerRequestHandler


def serve_web_app(
    repo: str,
    ref: str,
    host: str,
    port: int,
    open_browser: bool,
) -> int:
    handler = make_handler(repo, ref)
    try:
        server = ThreadingHTTPServer((host, port), handler)
    except OSError:
        if port == 0:
            raise
        server = ThreadingHTTPServer((host, 0), handler)

    actual_port = server.server_address[1]
    url_host = "127.0.0.1" if host in {"", "0.0.0.0"} else host
    url = f"http://{url_host}:{actual_port}/"
    print(f"Git History Viewer running at {url}")
    if repo:
        print(f"Default repository: {repo}")
    print("Press Ctrl-C to stop.")

    if open_browser:
        webbrowser.open(url)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Git History Viewer.")
    finally:
        server.server_close()
    return 0


def _history_params(query: str) -> tuple[str, str, bool]:
    params = parse_qs(query)
    repo_values = params.get("repo", [])
    ref_values = params.get("ref", [])
    ignore_tests_values = params.get("ignore_tests", [])
    repo_text = repo_values[0].strip() if repo_values else ""
    ref = ref_values[0].strip() if ref_values else "HEAD"
    ignore_tests = _parse_bool(ignore_tests_values[0]) if ignore_tests_values else False
    return repo_text, ref or "HEAD", ignore_tests


def _parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}
