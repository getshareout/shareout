"""POST /convert (body = deck bytes, header x-ext = pptx|ppt|odp) -> application/pdf.

Status codes the Worker maps to import errors: 413 too large, 415 bad type,
422 LibreOffice produced nothing, 504 conversion timed out, 503 busy.
"""
import os
import shutil
import signal
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BYTES = 25 * 1024 * 1024
TIMEOUT_S = 75
EXTS = {"pptx", "ppt", "odp"}
SLOTS = threading.BoundedSemaphore(2)


def convert(data, ext):
    work = tempfile.mkdtemp()
    try:
        src = os.path.join(work, "in." + ext)
        with open(src, "wb") as f:
            f.write(data)
        proc = subprocess.Popen(
            ["soffice", f"-env:UserInstallation=file://{work}/profile", "--headless", "--norestore",
             "--nolockcheck", "--nodefault", "--convert-to", "pdf", "--outdir", work, src],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
        )
        try:
            proc.wait(timeout=TIMEOUT_S)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            return 504, b""
        out = os.path.join(work, "in.pdf")
        if not os.path.exists(out):
            return 422, b""
        with open(out, "rb") as f:
            return 200, f.read()
    finally:
        shutil.rmtree(work, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body=b"", ctype="text/plain"):
        self.send_response(status)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        """The body, b"" when missing, None past MAX_BYTES (content-length or chunked)."""
        if "chunked" not in (self.headers.get("transfer-encoding") or "").lower():
            size = int(self.headers.get("content-length") or 0)
            return None if size > MAX_BYTES else self.rfile.read(size) if size > 0 else b""
        data = bytearray()
        while True:
            size = int(self.rfile.readline().split(b";")[0].strip() or b"0", 16)
            if size == 0:
                self.rfile.readline()
                return bytes(data)
            if len(data) + size > MAX_BYTES:
                return None
            data += self.rfile.read(size)
            self.rfile.readline()

    def do_GET(self):
        self.reply(200 if self.path == "/health" else 404)

    def do_POST(self):
        if self.path != "/convert":
            return self.reply(404)
        ext = (self.headers.get("x-ext") or "").lower()
        if ext not in EXTS:
            return self.reply(415)
        data = self.read_body()
        if data is None:
            return self.reply(413)
        if not data:
            return self.reply(400)
        if not SLOTS.acquire(timeout=30):
            return self.reply(503)
        try:
            status, pdf = convert(data, ext)
        finally:
            SLOTS.release()
        self.reply(status, pdf, "application/pdf" if status == 200 else "text/plain")

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
