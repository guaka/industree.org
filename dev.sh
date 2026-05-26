#!/usr/bin/env sh
set -eu

PORT="${PORT:-21845}"
HOST="${HOST:-127.0.0.1}"
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SITE_DIR="$ROOT_DIR/site"

printf 'Serving %s at http://%s:%s/\n' "$SITE_DIR" "$HOST" "$PORT"
exec python3 - "$SITE_DIR" "$HOST" "$PORT" <<'PY'
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
import sys
import time

directory = Path(sys.argv[1]).resolve()
host = sys.argv[2]
port = int(sys.argv[3])
FOLDER_PREFIXES = ("/site", "/docs")
APP_SHELL_PREFIXES = ("/impulse/",)

LIVE_RELOAD_SCRIPT = b"""<script>
(() => {
  if (!("EventSource" in window)) return;
  const source = new EventSource("/__dev_reload/events");
  let ready = false;
  source.onmessage = () => {
    if (ready) window.location.reload();
    ready = true;
  };
})();
</script>
"""


def snapshot_version():
    count = 0
    total_size = 0
    latest_mtime = 0
    for path in directory.rglob("*"):
        if not path.is_file():
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        count += 1
        total_size += stat.st_size
        latest_mtime = max(latest_mtime, stat.st_mtime_ns)
    return f"{count}:{total_size}:{latest_mtime}"


def folder_prefix_for(path):
    for prefix in FOLDER_PREFIXES:
        if path == prefix or path.startswith(prefix + "/"):
            return prefix
    return None


class IndusTreeHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = urlsplit(path).path
        folder_prefix = folder_prefix_for(path)
        if folder_prefix:
            path = path[len(folder_prefix):] or "/"
        return super().translate_path(path)

    def do_GET(self):
        if self.redirect_site_folder_path():
            return
        if urlsplit(self.path).path == "/__dev_reload/events":
            self.serve_reload_events()
            return
        if self.should_serve_app_shell():
            self.path = "/index.html"
        if self.should_inject_live_reload():
            self.serve_html(head_only=False)
            return
        super().do_GET()

    def do_HEAD(self):
        if self.redirect_site_folder_path():
            return
        if self.should_serve_app_shell():
            self.path = "/index.html"
        if self.should_inject_live_reload():
            self.serve_html(head_only=True)
            return
        super().do_HEAD()

    def redirect_site_folder_path(self):
        parts = urlsplit(self.path)
        folder_prefix = folder_prefix_for(parts.path)
        if not folder_prefix:
            return False

        target_path = parts.path[len(folder_prefix):] or "/"
        if target_path == "/index.html":
            target_path = "/"
        target = urlunsplit(("", "", target_path, parts.query, ""))
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", target)
        self.end_headers()
        return True

    def should_serve_app_shell(self):
        parts = urlsplit(self.path)
        requested = Path(self.translate_path(self.path))
        if requested.exists():
            return False
        if parts.path.startswith(APP_SHELL_PREFIXES):
            return True
        return "." not in Path(parts.path).name

    def html_path(self):
        requested = Path(self.translate_path(self.path))
        if requested.is_dir():
            requested = requested / "index.html"
        if requested.suffix.lower() != ".html" or not requested.exists():
            return None
        try:
            requested.relative_to(directory)
        except ValueError:
            return None
        return requested

    def should_inject_live_reload(self):
        return self.html_path() is not None

    def serve_html(self, head_only=False):
        path = self.html_path()
        if path is None:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return

        content = path.read_bytes()
        lower = content.lower()
        body_index = lower.rfind(b"</body>")
        if body_index >= 0:
            content = content[:body_index] + LIVE_RELOAD_SCRIPT + content[body_index:]
        else:
            content += LIVE_RELOAD_SCRIPT

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if not head_only:
            self.wfile.write(content)

    def serve_reload_events(self):
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        last = snapshot_version()
        try:
            self.wfile.write(f"data: {last}\n\n".encode())
            self.wfile.flush()
            while True:
                time.sleep(0.5)
                current = snapshot_version()
                if current == last:
                    continue
                last = current
                self.wfile.write(f"data: {current}\n\n".encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            return


handler = partial(IndusTreeHandler, directory=str(directory))
server = ThreadingHTTPServer((host, port), handler)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
PY
