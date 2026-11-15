"""Local test server for IronLog. Disables browser caching so every refresh shows the latest edits.
Run:  python dev-server.py      then open http://localhost:8080
"""
import http.server, socketserver, os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

class NoCache(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        # refuse hidden files/folders (.git etc.) - this server is reachable from your Wi-Fi
        if any(part.startswith('.') for part in self.path.split('?')[0].split('/')):
            self.send_error(404)
            return None
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

print("IronLog running at http://localhost:8080  (Ctrl+C to stop)")
Server(("0.0.0.0", 8080), NoCache).serve_forever()
