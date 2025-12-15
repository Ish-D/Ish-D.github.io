#!/usr/bin/env python3
"""
Simple SPA server that serves index.html for all routes.
This enables path-based routing like /journal -> journal.md

Usage: python3 server.py [port]
Default port is 8000
"""

import http.server
import socketserver
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Get the file path
        path = self.path.split('?')[0]  # Remove query string

        # Check if the path corresponds to an actual file
        file_path = '.' + path

        # If it's a directory, check for index.html
        if os.path.isdir(file_path):
            return super().do_GET()

        # If the file exists, serve it normally
        if os.path.isfile(file_path):
            return super().do_GET()

        # If path starts with /cards/, return 404 (for proper card not found handling)
        if path.startswith('/cards/'):
            self.send_error(404, 'File not found')
            return

        # Otherwise, serve index.html (SPA routing)
        self.path = '/index.html'
        return super().do_GET()

with socketserver.TCPServer(("", PORT), SPAHandler) as httpd:
    print(f"SPA Server running at http://localhost:{PORT}/")
    print(f"Direct card access: http://localhost:{PORT}/journal")
    print(f"Press Ctrl+C to stop")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
