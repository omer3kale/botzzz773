import http.server
import socketserver
import json
import os
from urllib.parse import urlparse, parse_qs
from urllib.request import urlopen, Request
from pathlib import Path

# Base directory for static files (BOTZZZ773)
BASE_DIR = Path(__file__).resolve().parents[1]
os.chdir(str(BASE_DIR))

PORT = int(os.environ.get("PORT", "8888"))

# Production base URL to proxy function calls
PROD_BASE = os.environ.get("PROD_BASE", "https://www.botzzz773.pro")


class Handler(http.server.SimpleHTTPRequestHandler):
    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _proxy_get(self, target_url):
        try:
            req = Request(target_url, headers={"User-Agent": "BOTZZZ773-DevProxy/1.0"})
            with urlopen(req, timeout=20) as resp:
                status = resp.getcode()
                data = resp.read()
                ctype = resp.headers.get("Content-Type", "application/json")
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        except Exception as e:
            self._send_json({"error": str(e)}, status=502)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parsed.query

        # Proxy public-config and services functions to production
        if path.startswith("/.netlify/functions/"):
            target = f"{PROD_BASE}{path}"
            if qs:
                target = f"{target}?{qs}"
            return self._proxy_get(target)

        # Proxy v2 endpoint
        if path == "/v2":
            target = f"{PROD_BASE}{path}"
            if qs:
                target = f"{target}?{qs}"
            return self._proxy_get(target)

        # Otherwise serve static files
        return super().do_GET()


if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"* Python dev server running at http://localhost:{PORT}")
        print(f"* Serving static from: {BASE_DIR}")
        print(f"* Proxying functions to: {PROD_BASE}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down...")
            httpd.server_close()
