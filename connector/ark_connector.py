#!/usr/bin/env python3
"""Pair a browser terminal with a local Ark PTY. No third-party dependencies."""
import argparse
import codecs
import hmac
import json
import os
import secrets
import select
import shutil
import signal
import struct
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit, parse_qs

if os.name != 'posix':
    raise SystemExit('Run this connector on macOS, Linux, or inside WSL.')
import fcntl
import pty
import termios

MAX_INPUT = 65536
IDLE_SECONDS = 30


class Session:
    def __init__(self, executable):
        self.id = secrets.token_urlsafe(24)
        self.last_seen = time.monotonic()
        self.decoder = codecs.getincrementaldecoder('utf-8')('replace')
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            environment = dict(os.environ, TERM='xterm-256color', ARK_DEFAULT_TERMINAL='1', ARK_CHROME='0')
            os.execvpe(executable, [executable], environment)
        os.set_blocking(self.fd, False)
        self.resize(80, 24)

    def resize(self, columns, rows):
        columns = max(20, min(240, int(columns)))
        rows = max(5, min(100, int(rows)))
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))

    def read(self):
        chunks = []
        size = 0
        ended = False
        while size < 256 * 1024 and select.select([self.fd], [], [], 0)[0]:
            try:
                chunk = os.read(self.fd, 8192)
                if not chunk:
                    ended = True
                    break
                chunks.append(chunk)
                size += len(chunk)
            except BlockingIOError:
                break
            except OSError:
                ended = True
                break
        return self.decoder.decode(b''.join(chunks), final=ended), ended

    def write(self, text):
        data = text.encode('utf-8')
        if len(data) > MAX_INPUT:
            raise ValueError('Input too large')
        deadline = time.monotonic() + 2
        while data:
            if time.monotonic() > deadline:
                raise ValueError('Terminal input is busy')
            if select.select([], [self.fd], [], .05)[1]:
                data = data[os.write(self.fd, data):]

    def close(self):
        # SIGHUP matches closing a terminal window. Only this PTY's process
        # groups are touched; unrelated terminals remain outside the session.
        try:
            foreground = os.tcgetpgrp(self.fd)
            if foreground != self.pid:
                os.killpg(foreground, signal.SIGHUP)
        except (ProcessLookupError, OSError):
            pass
        try:
            os.killpg(self.pid, signal.SIGHUP)
        except ProcessLookupError:
            pass
        os.close(self.fd)
        try:
            os.waitpid(self.pid, os.WNOHANG)
        except ChildProcessError:
            pass


class Connector(HTTPServer):
    allow_reuse_address = True

    def __init__(self, port, origins, executable):
        super().__init__(('127.0.0.1', port), Handler)
        self.timeout = .5
        self.origins = set(origins)
        self.executable = executable
        self.token = secrets.token_urlsafe(32)
        self.session = None

    def close_session(self):
        if self.session:
            self.session.close()
            self.session = None


class Handler(BaseHTTPRequestHandler):
    server_version = 'ArkConnector/1'

    def log_message(self, *_):
        pass  # Never log pairing tokens, commands, or terminal output.

    def origin_allowed(self):
        return self.headers.get('Origin') in self.server.origins and self.headers.get('Host') in {
            f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}

    def reply(self, code, body):
        payload = json.dumps(body).encode()
        self.send_response(code)
        if self.origin_allowed():
            self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
            self.send_header('Vary', 'Origin')
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        if not self.origin_allowed():
            self.reply(403, {'error': 'Origin not allowed'})
            return
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Access-Control-Max-Age', '600')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def handle_request(self):
        self.connection.settimeout(3)
        if not self.origin_allowed():
            self.reply(403, {'error': 'Origin not allowed'})
            return
        expected = 'Bearer ' + self.server.token
        if not hmac.compare_digest(self.headers.get('Authorization', ''), expected):
            self.reply(401, {'error': 'Incorrect pairing token'})
            return
        try:
            url = urlsplit(self.path)
            body = {}
            if self.command == 'POST':
                if self.headers.get('Content-Type') != 'application/json':
                    raise ValueError('JSON required')
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 <= length <= MAX_INPUT * 6 + 1024:
                    raise ValueError('Request too large')
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError('Invalid request')
            if url.path == '/connect' and self.command == 'POST':
                if self.server.session:
                    self.reply(409, {'error': 'A terminal is already connected'})
                    return
                self.server.session = Session(self.server.executable)
                self.server.session.resize(body.get('columns', 80), body.get('rows', 24))
                self.reply(200, {'session': self.server.session.id})
                return
            session = self.server.session
            session_id = body.get('session') if self.command == 'POST' else parse_qs(url.query).get('session', [''])[0]
            if not session or not hmac.compare_digest(str(session_id), session.id):
                self.reply(404, {'error': 'Session disconnected'})
                return
            session.last_seen = time.monotonic()
            if url.path == '/output' and self.command == 'GET':
                output, ended = session.read()
                self.reply(200, {'output': output, 'ended': ended})
                if ended:
                    self.server.close_session()
            elif url.path == '/input' and self.command == 'POST':
                if not isinstance(body.get('text'), str):
                    raise ValueError('Input must be text')
                session.write(body['text'])
                self.reply(200, {})
            elif url.path == '/resize' and self.command == 'POST':
                session.resize(body['columns'], body['rows'])
                self.reply(200, {})
            elif url.path == '/disconnect' and self.command == 'POST':
                self.server.close_session()
                self.reply(200, {})
            else:
                self.reply(404, {'error': 'Unknown request'})
        except (ValueError, KeyError, TypeError, OSError) as error:
            self.reply(400, {'error': str(error)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8770)
    parser.add_argument('--origin', action='append', default=[], help='Additional exact website origin allowed to pair')
    parser.add_argument('--shell', default='ark', help='Ark executable name or path')
    args = parser.parse_args()
    executable = shutil.which(args.shell)
    if not executable:
        parser.error('Ark is not installed or not on PATH. Use --shell with its path.')
    origins = ['https://gideoncox.com', 'https://www.gideoncox.com', *args.origin]
    server = Connector(args.port, origins, executable)
    print(f'Listening on http://127.0.0.1:{server.server_port}', flush=True)
    print('Pair only with a website you trust. Connected commands run as your user.', flush=True)
    print(f'Pairing token: {server.token}', flush=True)
    print('Keep this window open. Ctrl+C disconnects the terminal.', flush=True)
    try:
        while True:
            server.handle_request()
            if server.session and time.monotonic() - server.session.last_seen > IDLE_SECONDS:
                server.close_session()
    except KeyboardInterrupt:
        pass
    finally:
        server.close_session()
        server.server_close()


if __name__ == '__main__':
    main()
