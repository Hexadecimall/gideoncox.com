#!/usr/bin/env python3
"""Pair a browser terminal with a local Ark PTY. No third-party dependencies."""
import argparse
import base64
import codecs
import hmac
import json
import os
import platform
import secrets
import select
import shutil
import signal
import struct
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit, parse_qs

if os.name != 'posix':
    raise SystemExit('Run this connector on macOS, Linux, or inside WSL.')
import fcntl
import pty
import termios

MAX_INPUT = 65536
IDLE_SECONDS = 30
MAX_SESSIONS = 8
MAX_FILE = 32 * 1024 * 1024
MAX_PROCESSES = 16
ZED_REVISION = '1a28cff4b409169bac058bca40dfbfeb7621d19b'


def native_server_info(executable):
    resolved = shutil.which(executable)
    if not resolved:
        raise ValueError('The configured Zed remote server is not executable')
    path = Path(resolved).resolve(strict=True)
    try:
        version = subprocess.run([str(path), 'version'], capture_output=True,
                                 text=True, timeout=5, check=True).stdout.strip()
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError('The Zed remote server version check failed') from error
    if version.split('+')[-1] != ZED_REVISION:
        raise ValueError('The Zed remote server must match the browser port revision ' + ZED_REVISION)
    system = platform.system()
    architecture = {'arm64': 'aarch64', 'aarch64': 'aarch64', 'x86_64': 'x86_64'}.get(platform.machine())
    if system not in ('Darwin', 'Linux') or not architecture:
        raise ValueError('The Zed remote server requires macOS or Linux on arm64 or x86_64')
    return {'os': 'macos' if system == 'Darwin' else 'linux', 'arch': architecture,
            'osVersion': platform.mac_ver()[0] if system == 'Darwin' else platform.release(),
            'shell': os.environ.get('SHELL') or '/bin/sh',
            'zedServer': {'path': str(path), 'revision': ZED_REVISION}}


class ProjectFiles:
    """Filesystem access to the directory explicitly shared on the command line."""

    def __init__(self, root):
        self.root = Path(root).resolve(strict=True)
        if not self.root.is_dir():
            raise ValueError('The shared project must be a directory')
        self.observed = {}

    def path(self, value, mutable=False):
        if not isinstance(value, str) or not value or '\x00' in value:
            raise ValueError('A project path is required')
        path = Path(os.path.abspath(value))
        # Check both lexical ancestry and symlink resolution, including missing leaves.
        if not path.is_relative_to(self.root) or not path.resolve().is_relative_to(self.root):
            raise ValueError('Path is outside the shared project')
        if mutable and path == self.root:
            raise ValueError('The shared project root cannot be replaced or removed')
        return path

    def metadata(self, path):
        try:
            link = path.lstat()
            info = path.stat()
        except FileNotFoundError:
            return None
        return dict(inode=info.st_ino, mtime_secs=info.st_mtime_ns // 1_000_000_000,
                    mtime_nanos=info.st_mtime_ns % 1_000_000_000,
                    is_symlink=stat.S_ISLNK(link.st_mode), is_dir=stat.S_ISDIR(info.st_mode),
                    len=info.st_size, is_fifo=stat.S_ISFIFO(info.st_mode),
                    is_executable=bool(info.st_mode & 0o111), is_writable=os.access(path, os.W_OK))

    def observe(self, path):
        value = self.metadata(path)
        if len(self.observed) >= 100000 and path not in self.observed:
            raise ValueError('Project file observation limit reached')
        self.observed[path] = value
        return value

    def changes(self):
        changed = []
        for path, previous in list(self.observed.items()):
            try:
                current = self.metadata(self.path(str(path)))
            except (OSError, ValueError):
                current = None
            if current != previous:
                changed.append(str(path))
                self.observed[path] = current
        return changed

    def run(self, body):
        operation = body.get('operation')
        if operation == 'watch':
            return self.changes()
        path = self.path(body.get('path', body.get('source')))
        if operation == 'metadata':
            return self.observe(path)
        if operation == 'canonicalize':
            return str(path.resolve(strict=True))
        if operation == 'read_link':
            return str(path.parent / os.readlink(path))
        if operation == 'read_dir':
            paths = []
            for child in path.iterdir():
                try:
                    self.path(str(child))
                except ValueError:
                    continue  # An outside symlink does not grant access to its target.
                paths.append(str(child))
            self.observe(path)
            return sorted(paths)
        if operation == 'read':
            if not path.is_file() or path.stat().st_size > MAX_FILE:
                raise ValueError('Expected a regular file of at most 32 MiB')
            with path.open('rb') as source:
                data = source.read(MAX_FILE + 1)
            if len(data) > MAX_FILE:
                raise ValueError('File is larger than 32 MiB')
            self.observe(path)
            return base64.b64encode(data).decode('ascii')
        if operation == 'create_dir' and path == self.root:
            return None
        self.path(str(path), mutable=True)
        if operation == 'write':
            data = base64.b64decode(body['data'], validate=True)
            if len(data) > MAX_FILE:
                raise ValueError('File is larger than 32 MiB')
            previous_mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.zed-write-', delete=False) as target:
                    temporary = Path(target.name)
                    target.write(data)
                    target.flush()
                    os.fsync(target.fileno())
                temporary.chmod(previous_mode)
                os.replace(temporary, path)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
        elif operation == 'create_dir':
            path.mkdir(parents=True, exist_ok=True)
        elif operation == 'create_file':
            if path.exists() and body.get('ignore_if_exists'):
                return None
            with path.open('wb' if body.get('overwrite') else 'xb'):
                pass
        elif operation == 'create_symlink':
            target = body['target']
            resolved = path.parent / target
            self.path(str(resolved))
            path.symlink_to(target)
        elif operation in ('copy', 'rename'):
            target = self.path(body['target'], mutable=True)
            if target.exists():
                if body.get('ignore_if_exists'):
                    return None
                if not body.get('overwrite'):
                    raise FileExistsError('Target already exists')
            if operation == 'rename' and target.is_relative_to(path) and path != target:
                raise ValueError('Cannot move a directory inside itself')
            if body.get('create_parents'):
                target.parent.mkdir(parents=True, exist_ok=True)
            if operation == 'rename':
                path.rename(target)
            else:
                shutil.copyfile(path, target)
        elif operation in ('remove_file', 'remove_dir'):
            if not path.exists() and body.get('ignore_if_not_exists'):
                return None
            if operation == 'remove_file':
                path.unlink()
            elif body.get('recursive'):
                shutil.rmtree(path)
            else:
                path.rmdir()
        else:
            raise ValueError('Unknown filesystem operation')
        return None


class Process:
    """A separate process group with binary pipes for language servers and tools."""

    def __init__(self, files, options):
        command, args = options.get('command'), options.get('args', [])
        environment = options.get('env', {})
        if not isinstance(command, str) or not command or '\x00' in command:
            raise ValueError('A process command is required')
        if not isinstance(args, list) or any(not isinstance(arg, str) or '\x00' in arg for arg in args):
            raise ValueError('Process arguments must be strings')
        if not isinstance(environment, dict) or any(not isinstance(key, str) or not key or '=' in key or '\x00' in key or (value is not None and (not isinstance(value, str) or '\x00' in value)) for key, value in environment.items()):
            raise ValueError('Invalid process environment')
        cwd = files.path(options.get('cwd') or str(files.root))
        env = {} if options.get('envClear') else dict(os.environ)
        for key, value in environment.items():
            if value is None:
                env.pop(key, None)
            else:
                env[key] = value
        self.child = subprocess.Popen([command, *args], cwd=cwd, env=env,
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, start_new_session=True)
        self.id = secrets.token_urlsafe(24)
        self.last_seen = time.monotonic()
        self.eof = set()
        self.closed = False
        for stream in (self.child.stdin, self.child.stdout, self.child.stderr):
            os.set_blocking(stream.fileno(), False)

    def read(self):
        result = {}
        for name in ('stdout', 'stderr'):
            stream, data = getattr(self.child, name), bytearray()
            while name not in self.eof and len(data) < 256 * 1024:
                try:
                    part = os.read(stream.fileno(), 8192)
                    if not part:
                        self.eof.add(name)
                        break
                    data.extend(part)
                except BlockingIOError:
                    break
            result[name] = base64.b64encode(data).decode('ascii')
        code = self.child.poll()
        result['exitCode'] = code if code is not None and code >= 0 else None
        result['signal'] = -code if code is not None and code < 0 else None
        result['ended'] = code is not None and len(self.eof) == 2
        return result

    def write(self, data):
        if len(data) > MAX_INPUT:
            raise ValueError('Input too large')
        # Never wait here: the same HTTP loop must drain the child's output.
        # A client retries the unwritten suffix while reads continue separately.
        try:
            return os.write(self.child.stdin.fileno(), data)
        except BlockingIOError:
            return 0

    def end_input(self):
        self.child.stdin.close()

    def kill(self):
        try:
            os.killpg(self.child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        # Keep the pipes and status available until the reader receives EOF.

    def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            # Descendants may still own the pipes after the original process exits.
            os.killpg(self.child.pid, signal.SIGTERM)
            if self.child.poll() is None:
                self.child.wait(timeout=.25)
        except (subprocess.TimeoutExpired, ProcessLookupError):
            pass
        try:
            os.killpg(self.child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        self.child.wait(timeout=2)
        for stream in (self.child.stdin, self.child.stdout, self.child.stderr):
            stream.close()


class Session:
    def __init__(self, executable, encoding='utf8', columns=80, rows=24, cwd=None, command=None, args=None, env=None):
        self.id = secrets.token_urlsafe(24)
        self.encoding = encoding
        self.exit_code = None
        self.output_eof = False
        self.last_seen = time.monotonic()
        self.decoder = codecs.getincrementaldecoder('utf-8')('replace')
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            try:
                environment = dict(os.environ, TERM='xterm-256color', ARK_DEFAULT_TERMINAL='1', ARK_CHROME='0')
                if cwd:
                    os.chdir(cwd)
                environment.update(env or {})
                program = command or executable
                os.execvpe(program, [program, *(args or [])], environment)
            except Exception as error:
                os.write(2, (str(error) + '\n').encode(errors='replace'))
                os._exit(127)
        os.set_blocking(self.fd, False)
        self.resize(columns, rows)

    def resize(self, columns, rows):
        columns = max(20, min(240, int(columns)))
        rows = max(5, min(100, int(rows)))
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))

    def read(self):
        chunks = []
        size = 0
        while not self.output_eof and size < 256 * 1024 and select.select([self.fd], [], [], 0)[0]:
            try:
                chunk = os.read(self.fd, 8192)
                if not chunk:
                    self.output_eof = True
                    break
                chunks.append(chunk)
                size += len(chunk)
            except BlockingIOError:
                break
            except OSError:
                self.output_eof = True
                break
        data = b''.join(chunks)
        if self.exit_code is None:
            try:
                pid, status = os.waitpid(self.pid, os.WNOHANG)
                if pid:
                    self.exit_code = os.waitstatus_to_exitcode(status)
            except ChildProcessError:
                pass
        # EOF can arrive before waitpid reports the task's final status.
        ended = self.output_eof and self.exit_code is not None
        if self.encoding == 'base64':
            return base64.b64encode(data).decode('ascii'), ended
        return self.decoder.decode(data, final=ended), ended

    def write(self, data):
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
        if self.fd is None:
            return
        try:
            foreground = os.tcgetpgrp(self.fd)
            if foreground > 0 and foreground not in (self.pid, os.getpgrp()):
                os.killpg(foreground, signal.SIGHUP)
        except (ProcessLookupError, OSError):
            pass
        try:
            if self.exit_code is None:
                os.killpg(self.pid, signal.SIGHUP)
        except ProcessLookupError:
            pass
        os.close(self.fd)
        self.fd = None
        try:
            os.waitpid(self.pid, os.WNOHANG)
        except ChildProcessError:
            pass


class Connector(HTTPServer):
    allow_reuse_address = True

    def __init__(self, port, origins, executable, project=None, allow_processes=False, zed_server=None):
        if zed_server and not (project and allow_processes):
            raise ValueError('A Zed remote server requires --project and --allow-processes')
        self.native = native_server_info(zed_server) if zed_server else None
        if self.native:
            self.native['shell'] = str(Path(executable).resolve())
        super().__init__(('127.0.0.1', port), Handler)
        self.timeout = .5
        self.origins = set(origins)
        self.executable = executable
        self.token = secrets.token_urlsafe(32)
        self.sessions = {}
        self.files = ProjectFiles(project) if project else None
        self.allow_processes = bool(allow_processes and self.files)
        self.processes = {}

    def close_process(self, process_id=None):
        for key in [process_id] if process_id else list(self.processes):
            process = self.processes.pop(key, None)
            if process:
                process.close()

    def close_session(self, session_id=None):
        ids = [session_id] if session_id else list(self.sessions)
        for key in ids:
            session = self.sessions.pop(key, None)
            if session:
                session.close()

    def expire_sessions(self):
        now = time.monotonic()
        for key, session in list(self.sessions.items()):
            if now - session.last_seen > IDLE_SECONDS:
                self.close_session(key)
        for key, process in list(self.processes.items()):
            if now - process.last_seen > IDLE_SECONDS:
                self.close_process(key)


class Handler(BaseHTTPRequestHandler):
    server_version = 'ArkConnector/3'

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
                limit = MAX_FILE * 4 // 3 + 4096 if url.path == '/workspace/fs' else MAX_INPUT * 6 + 1024
                if not 0 <= length <= limit:
                    raise ValueError('Request too large')
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError('Invalid request')
            if url.path == '/workspace/info' and self.command == 'GET':
                self.reply(200, {'protocol': 3, 'root': str(self.server.files.root) if self.server.files else None,
                                 'processes': self.server.allow_processes, 'native': self.server.native})
                return
            if url.path == '/workspace/fs' and self.command == 'POST':
                if not self.server.files:
                    raise ValueError('Start the connector with --project to share a folder')
                self.reply(200, self.server.files.run(body))
                return
            if url.path.startswith('/process/') and self.command == 'POST':
                self.handle_process(url.path, body)
                return
            if url.path == '/connect' and self.command == 'POST':
                self.server.expire_sessions()
                if len(self.server.sessions) >= MAX_SESSIONS:
                    self.reply(409, {'error': 'The terminal session limit has been reached'})
                    return
                encoding = body.get('encoding', 'utf8')
                if encoding not in ('utf8', 'base64'):
                    raise ValueError('Unsupported terminal encoding')
                columns, rows = int(body.get('columns', 80)), int(body.get('rows', 24))
                if body.get('cwd') and not self.server.files:
                    raise ValueError('Sharing a terminal working directory requires --project')
                cwd = self.server.files.path(body['cwd']) if body.get('cwd') else None
                command, args, env = body.get('command'), body.get('args', []), body.get('env', {})
                if command:
                    if not self.server.allow_processes:
                        raise ValueError('Running tasks requires --project and --allow-processes')
                    if not isinstance(command, str) or '\x00' in command:
                        raise ValueError('Invalid task command')
                    cwd = cwd or self.server.files.root
                if not isinstance(args, list) or any(not isinstance(arg, str) or '\x00' in arg for arg in args):
                    raise ValueError('Invalid task arguments')
                if not isinstance(env, dict) or any(not isinstance(key, str) or not key or '=' in key or '\x00' in key or not isinstance(value, str) or '\x00' in value for key, value in env.items()):
                    raise ValueError('Invalid task environment')
                if not self.server.allow_processes and (args or env):
                    raise ValueError('Task arguments and environment require --allow-processes')
                session = Session(self.server.executable, encoding, columns, rows, cwd=cwd, command=command, args=args, env=env)
                self.server.sessions[session.id] = session
                self.reply(200, {'session': session.id, 'protocol': 2, 'encoding': encoding})
                return
            session_id = body.get('session') if self.command == 'POST' else parse_qs(url.query).get('session', [''])[0]
            session = self.server.sessions.get(str(session_id))
            if not session:
                self.reply(404, {'error': 'Session disconnected'})
                return
            session.last_seen = time.monotonic()
            if url.path == '/output' and self.command == 'GET':
                output, ended = session.read()
                field = 'data' if session.encoding == 'base64' else 'output'
                code = session.exit_code
                self.reply(200, {field: output, 'ended': ended,
                                 'exitCode': code if code is not None and code >= 0 else None,
                                 'signal': -code if code is not None and code < 0 else None})
                if ended:
                    self.server.close_session(session.id)
            elif url.path == '/input' and self.command == 'POST':
                if session.encoding == 'base64':
                    if not isinstance(body.get('data'), str):
                        raise ValueError('Input must be base64 data')
                    data = base64.b64decode(body['data'], validate=True)
                else:
                    if not isinstance(body.get('text'), str):
                        raise ValueError('Input must be text')
                    data = body['text'].encode('utf-8')
                session.write(data)
                self.reply(200, {})
            elif url.path == '/resize' and self.command == 'POST':
                session.resize(body['columns'], body['rows'])
                self.reply(200, {})
            elif url.path == '/disconnect' and self.command == 'POST':
                self.server.close_session(session.id)
                self.reply(200, {})
            else:
                self.reply(404, {'error': 'Unknown request'})
        except (ValueError, KeyError, TypeError, OSError) as error:
            self.reply(400, {'error': str(error)})

    def handle_process(self, path, body):
        if not self.server.allow_processes:
            raise ValueError('Start the connector with --project and --allow-processes to run development tools')
        if path == '/process/open':
            self.server.expire_sessions()
            if len(self.server.processes) >= MAX_PROCESSES:
                raise ValueError('Process limit reached')
            process = Process(self.server.files, body)
            self.server.processes[process.id] = process
            self.reply(200, {'id': process.id, 'pid': process.child.pid})
            return
        process = self.server.processes.get(body.get('id'))
        if not process:
            raise ValueError('Process disconnected')
        process.last_seen = time.monotonic()
        if path == '/process/read':
            result = process.read()
            self.reply(200, result)
            if result['ended']:
                self.server.close_process(process.id)
        elif path == '/process/write':
            written = process.write(base64.b64decode(body['data'], validate=True))
            self.reply(200, {'written': written})
        elif path == '/process/end-input':
            process.end_input()
            self.reply(200, {})
        elif path == '/process/kill':
            process.kill()
            self.reply(200, {})
        elif path == '/process/close':
            self.server.close_process(process.id)
            self.reply(200, {})
        else:
            raise ValueError('Unknown process operation')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8770)
    parser.add_argument('--origin', action='append', default=[], help='Additional exact website origin allowed to pair')
    parser.add_argument('--shell', default='ark', help='Ark executable name or path')
    parser.add_argument('--project', help='Project directory to share with Zed for editing')
    parser.add_argument('--allow-processes', action='store_true', help='Allow paired Zed to run language servers and development tools as your user')
    parser.add_argument('--zed-server', help='Optional matching Zed remote-server executable; requires --allow-processes')
    args = parser.parse_args()
    executable = shutil.which(args.shell)
    if not executable:
        parser.error('Ark is not installed or not on PATH. Use --shell with its path.')
    origins = ['https://gideoncox.com', 'https://www.gideoncox.com', *args.origin]
    if args.allow_processes and not args.project:
        parser.error('--allow-processes requires --project')
    if args.zed_server and not args.allow_processes:
        parser.error('--zed-server requires --allow-processes')
    server = Connector(args.port, origins, executable, args.project, args.allow_processes, args.zed_server)
    print(f'Listening on http://127.0.0.1:{server.server_port}', flush=True)
    print('Pair only with a website you trust. Connected commands run as your user.', flush=True)
    if server.files:
        print(f'Shared project: {server.files.root}', flush=True)
        print('Development processes enabled.' if server.allow_processes else 'Development processes disabled.', flush=True)
    print(f'Pairing token: {server.token}', flush=True)
    print('Keep this window open. Ctrl+C disconnects terminals and development tools.', flush=True)
    try:
        while True:
            server.handle_request()
            server.expire_sessions()
    except KeyboardInterrupt:
        pass
    finally:
        server.close_session()
        server.close_process()
        server.server_close()


if __name__ == '__main__':
    main()
