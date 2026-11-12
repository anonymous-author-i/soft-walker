"""Preview both root and GitHub Pages /soft-walker/ paths, without COOP/COEP."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os

os.chdir(Path(__file__).resolve().parents[1])

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        # Keep automated browser output focused on failures.
        if args and str(args[1] if len(args) > 1 else '').startswith(('4', '5')):
            super().log_message(format, *args)

    def do_GET(self):
        if self.path.startswith('/soft-walker/'):
            self.path = self.path[len('/soft-walker'):]
        try:
            super().do_GET()
        except (BrokenPipeError, ConnectionResetError):
            pass  # Browser intentionally cancelled a navigation/download.

ThreadingHTTPServer(('127.0.0.1', 8000), Handler).serve_forever()
