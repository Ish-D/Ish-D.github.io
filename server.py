#!/usr/bin/env python3
"""
SPA server with live-reload support for markdown files.
Serves index.html for all routes and provides WebSocket updates when cards/*.md files change.

Usage: python3 server.py [port]
Default port is 8000, WebSocket runs on port+1 (8001)

For live-reload, install: pip install websockets watchdog
"""

import http.server
import socketserver
import os
import sys
import json
import asyncio
import threading
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
WS_PORT = PORT + 1
DEBOUNCE_MS = 50  # Debounce rapid file changes (low for fast feedback)

# Track connected WebSocket clients and their watched files
clients = {}  # websocket -> set of watched file names
pending_updates = {}  # file_name -> asyncio.Task for debouncing
loop = None  # asyncio event loop for WebSocket server


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    """SPA handler that serves index.html for all non-file routes."""

    def log_message(self, format, *args):
        # Suppress default logging for cleaner output
        pass

    def do_GET(self):
        # Get the file path
        path = self.path.split('?')[0]  # Remove query string

        # API endpoint: return list of card files dynamically
        if path == '/api/cards':
            self.send_card_list()
            return

        # Check if the path corresponds to an actual file
        file_path = '.' + path

        # If it's a directory, check for index.html
        if os.path.isdir(file_path):
            return super().do_GET()

        # If the file exists, serve it normally
        if os.path.isfile(file_path):
            return super().do_GET()

        # Don't route static assets (JS, CSS, images, etc.) - return 404 instead
        static_extensions = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot']
        if any(path.lower().endswith(ext) for ext in static_extensions):
            self.send_error(404, 'File not found')
            return

        # Otherwise, serve index.html (SPA routing)
        self.path = '/index.html'
        return super().do_GET()

    def send_card_list(self):
        """Return JSON list of all card files in cards/ directory."""
        cards_dir = Path('cards')
        card_files = sorted([f.stem for f in cards_dir.glob('*.md')]) if cards_dir.exists() else []

        response = json.dumps({'cards': card_files})
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(response))
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(response.encode())


# Try to import live-reload dependencies
try:
    import websockets
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    HAS_LIVE_RELOAD = True
except ImportError:
    HAS_LIVE_RELOAD = False


if HAS_LIVE_RELOAD:
    class MarkdownHandler(FileSystemEventHandler):
        """Watch for markdown file changes and notify clients."""

        def on_modified(self, event):
            if not event.is_directory and event.src_path.endswith('.md'):
                file_name = Path(event.src_path).stem
                if loop:
                    asyncio.run_coroutine_threadsafe(schedule_update(file_name), loop)

        def on_created(self, event):
            # Also handle file creation (some editors create new files on save)
            self.on_modified(event)

    async def schedule_update(file_name):
        """Debounce updates to prevent flooding during rapid edits."""
        global pending_updates

        # Cancel any pending update for this file
        if file_name in pending_updates:
            pending_updates[file_name].cancel()

        async def delayed_broadcast():
            await asyncio.sleep(DEBOUNCE_MS / 1000)
            await broadcast_update(file_name)
            if file_name in pending_updates:
                del pending_updates[file_name]

        pending_updates[file_name] = asyncio.create_task(delayed_broadcast())

    async def broadcast_update(file_name):
        """Send file content to all clients watching this file."""
        file_path = Path('cards') / f'{file_name}.md'

        if not file_path.exists():
            return

        try:
            content = file_path.read_text(encoding='utf-8')
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
            return

        message = json.dumps({
            'type': 'update',
            'file': file_name,
            'content': content
        })

        # Send to all clients watching this file
        for ws, watched_files in list(clients.items()):
            if file_name in watched_files:
                try:
                    await ws.send(message)
                except Exception:
                    # Connection may have closed
                    pass

    async def handle_client(websocket):
        """Handle a WebSocket client connection."""
        clients[websocket] = set()
        remote = websocket.remote_address
        print(f"  Live-reload client connected: {remote[0]}:{remote[1]}")

        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    if data.get('type') == 'watch':
                        file_name = data.get('file')
                        if file_name:
                            clients[websocket].add(file_name)
                    elif data.get('type') == 'unwatch':
                        file_name = data.get('file')
                        if file_name:
                            clients[websocket].discard(file_name)
                except json.JSONDecodeError:
                    pass
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            if websocket in clients:
                del clients[websocket]
            print(f"  Live-reload client disconnected: {remote[0]}:{remote[1]}")

    async def start_websocket_server():
        """Start the WebSocket server."""
        try:
            async with websockets.serve(handle_client, "0.0.0.0", WS_PORT):
                print(f"  WebSocket server started on port {WS_PORT}")
                await asyncio.Future()  # Run forever
        except Exception as e:
            print(f"  WebSocket server error: {e}")

    def run_websocket_server():
        """Run WebSocket server in a separate thread."""
        global loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(start_websocket_server())
        except Exception as e:
            print(f"  WebSocket thread error: {e}")

    def start_file_watcher():
        """Start watching cards directory for changes."""
        cards_dir = Path('cards')
        if not cards_dir.exists():
            print("  Warning: cards/ directory not found, file watching disabled")
            return None

        observer = Observer()
        observer.schedule(MarkdownHandler(), str(cards_dir), recursive=False)
        observer.start()
        return observer


def main():
    print(f"\n{'='*50}")
    print(f"  Paper Cards Development Server")
    print(f"{'='*50}")
    print(f"\n  HTTP:  http://localhost:{PORT}/")
    print(f"  Cards: http://localhost:{PORT}/journal")

    observer = None

    if HAS_LIVE_RELOAD:
        print(f"\n  Live-reload enabled:")
        print(f"    WebSocket: ws://localhost:{WS_PORT}")
        print(f"    Watching:  cards/*.md")

        # Start file watcher
        observer = start_file_watcher()

        # Start WebSocket server in background thread
        ws_thread = threading.Thread(target=run_websocket_server, daemon=True)
        ws_thread.start()

        # Give WebSocket server time to start
        import time
        time.sleep(0.5)
    else:
        print(f"\n  Live-reload disabled (optional dependencies not installed)")
        print(f"    To enable: pip install websockets watchdog")

    print(f"\n  Press Ctrl+C to stop")
    print(f"{'='*50}\n")

    # Start HTTP server
    with socketserver.TCPServer(("", PORT), SPAHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\nServer stopped.")
            if observer:
                observer.stop()
                observer.join()


if __name__ == '__main__':
    main()
