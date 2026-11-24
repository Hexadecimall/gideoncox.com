"""Exercise shared project boundaries and actual process pipes with disposable files."""
import base64
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import json
import shutil
import threading
import time
import unittest
import urllib.request
import urllib.error

spec = importlib.util.spec_from_file_location('ark_connector', Path(__file__).resolve().parents[1] / 'connector/ark_connector.py')
connector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(connector)


class ProjectTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name).resolve()
        self.root = self.base / 'project'
        self.root.mkdir()
        self.files = connector.ProjectFiles(self.root)

    def tearDown(self):
        self.temporary.cleanup()

    def run_fs(self, operation, path, **options):
        return self.files.run(dict(operation=operation, path=str(path), **options))

    def test_real_bytes_atomic_save_and_external_watch(self):
        path = self.root / 'binary.dat'
        self.run_fs('create_file', path)
        path.chmod(0o750)
        data = b'\0\xff\x80\r\nbytes'
        self.run_fs('write', path, data=base64.b64encode(data).decode())
        self.assertEqual(path.read_bytes(), data)
        self.assertEqual(path.stat().st_mode & 0o777, 0o750)
        self.assertEqual(base64.b64decode(self.run_fs('read', path)), data)
        self.run_fs('read_dir', self.root)
        path.write_bytes(b'changed outside Zed')
        new_file = self.root / 'external.txt'
        new_file.write_text('new')
        self.assertEqual(set(self.files.changes()), {str(path), str(self.root)})
        self.assertEqual(self.files.changes(), [])

    def test_traversal_and_symlink_cannot_escape_shared_root(self):
        outside = self.base / 'outside.txt'
        outside.write_text('untouched')
        link = self.root / 'escape'
        link.symlink_to(self.base, target_is_directory=True)
        for path in (outside, self.root / '..' / 'outside.txt', link / 'outside.txt'):
            for operation in ('read', 'write', 'remove_file'):
                with self.assertRaises(ValueError):
                    self.run_fs(operation, path, data=base64.b64encode(b'replaced').decode())
        self.assertEqual(outside.read_text(), 'untouched')
        self.assertNotIn(str(link), self.run_fs('read_dir', self.root))
        with self.assertRaises(ValueError):
            self.run_fs('remove_dir', self.root, recursive=True)

    def test_rename_and_no_overwrite_preserve_data(self):
        source, target = self.root / 'one', self.root / 'two'
        source.write_text('one')
        target.write_text('two')
        with self.assertRaises(FileExistsError):
            self.run_fs('rename', source, target=str(target))
        self.assertEqual(source.read_text(), 'one')
        self.run_fs('rename', source, target=str(target), overwrite=True)
        self.assertEqual(target.read_text(), 'one')
        self.assertFalse(source.exists())

    def test_native_server_requires_opt_in_and_matching_revision(self):
        with self.assertRaisesRegex(ValueError, 'requires --project and --allow-processes'):
            connector.Connector(0, [], '/bin/sh', self.root, False, '/usr/bin/true')
        with self.assertRaisesRegex(ValueError, 'must match the browser port revision'):
            connector.native_server_info(shutil.which('true'))

    def test_process_binary_pipes_eof_and_exit_code(self):
        process = connector.Process(self.files, dict(command=sys.executable,
            args=['-c', 'import sys; data=sys.stdin.buffer.read(); sys.stdout.buffer.write(data); sys.stderr.buffer.write(b"error\\xff"); sys.exit(7)'],
            cwd=str(self.root), envClear=True, env={}))
        try:
            process.write(b'input\x00\xff')
            process.end_input()
            stdout, stderr = bytearray(), bytearray()
            for _ in range(100):
                result = process.read()
                stdout.extend(base64.b64decode(result['stdout']))
                stderr.extend(base64.b64decode(result['stderr']))
                if result['ended']:
                    break
                time.sleep(.02)
            self.assertTrue(result['ended'])
            self.assertEqual(result['exitCode'], 7)
            self.assertIsNone(result['signal'])
            self.assertEqual(stdout, b'input\x00\xff')
            self.assertEqual(stderr, b'error\xff')
        finally:
            process.close()

    def test_process_cancellation_and_cwd_boundary(self):
        with self.assertRaises(ValueError):
            connector.Process(self.files, dict(command=sys.executable, cwd=str(self.base)))
        process = connector.Process(self.files, dict(command=sys.executable,
            args=['-c', 'import time; time.sleep(30)'], cwd=str(self.root)))
        process.close()
        process.close()
        self.assertIsNotNone(process.child.poll())

    def test_killed_process_retains_signal_status_until_read(self):
        process = connector.Process(self.files, dict(command=sys.executable,
            args=['-c', 'import time; time.sleep(30)'], cwd=str(self.root)))
        try:
            process.kill()
            for _ in range(100):
                result = process.read()
                if result['ended']:
                    break
                time.sleep(.02)
            self.assertTrue(result['ended'])
            self.assertEqual(result['signal'], 9)
            self.assertIsNone(result['exitCode'])
        finally:
            process.close()

    def test_cancellation_closes_descendant_pipes_after_parent_exits(self):
        process = connector.Process(self.files, dict(command=sys.executable,
            args=['-c', 'import os,time; child=os.fork(); os._exit(0) if child else time.sleep(30)'],
            cwd=str(self.root)))
        try:
            for _ in range(100):
                result = process.read()
                if result['exitCode'] == 0:
                    break
                time.sleep(.02)
            self.assertEqual(result['exitCode'], 0)
            self.assertFalse(result['ended'])
            process.kill()
            for _ in range(100):
                result = process.read()
                if result['ended']:
                    break
                time.sleep(.02)
            self.assertTrue(result['ended'])
            self.assertEqual(result['exitCode'], 0)
        finally:
            process.close()

    def test_pty_waits_for_exit_status_after_output_eof(self):
        session = connector.Session(sys.executable, encoding='base64', args=['-c',
            'import os,time; os.close(0); os.close(1); os.close(2); time.sleep(.2); os._exit(7)'])
        try:
            saw_pending_exit = False
            for _ in range(100):
                _, ended = session.read()
                if session.output_eof and session.exit_code is None:
                    saw_pending_exit = True
                    self.assertFalse(ended)
                if ended:
                    break
                time.sleep(.01)
            self.assertTrue(saw_pending_exit)
            self.assertTrue(ended)
            self.assertEqual(session.exit_code, 7)
        finally:
            session.close()


class ConnectorHttpTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.origin = 'http://127.0.0.1:8767'
        self.server = connector.Connector(0, [self.origin], '/bin/sh', self.root, True)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.thread.join(timeout=2)
        self.server.close_session()
        self.server.close_process()
        self.server.server_close()
        self.temporary.cleanup()

    def request(self, path, body=None, token=None, origin=None):
        headers = {'Origin': origin or self.origin, 'Authorization': 'Bearer ' + (token or self.server.token)}
        data = None
        if body is not None:
            headers['Content-Type'] = 'application/json'
            data = json.dumps(body).encode()
        request = urllib.request.Request(f'http://127.0.0.1:{self.server.server_port}' + path, data=data, headers=headers)
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.load(response)

    def test_auth_and_explicit_process_opt_in(self):
        for options in ({'token': 'incorrect'}, {'origin': 'https://untrusted.invalid'}):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request('/workspace/info', **options)
            self.assertIn(error.exception.code, (401, 403))
            error.exception.close()
        self.assertEqual(self.request('/workspace/info')['root'], str(self.root))
        self.assertIsNone(self.request('/workspace/info')['native'])
        self.server.allow_processes = False
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request('/process/open', {'command': sys.executable})
        self.assertEqual(error.exception.code, 400)
        error.exception.close()
        self.assertEqual(self.server.processes, {})

    def test_task_pty_uses_shared_cwd_and_reports_failure(self):
        opened = self.request('/connect', {'encoding': 'base64', 'columns': 91, 'rows': 29,
            'command': '/bin/sh', 'args': ['-c', 'printf task-output; printf task > task.txt; exit 7'], 'cwd': str(self.root)})
        output = bytearray()
        for _ in range(100):
            result = self.request('/output?session=' + opened['session'])
            output.extend(base64.b64decode(result['data']))
            if result['ended']:
                break
            time.sleep(.02)
        self.assertTrue(result['ended'])
        self.assertEqual(result['exitCode'], 7)
        self.assertIn(b'task-output', output)
        self.assertEqual((self.root / 'task.txt').read_text(), 'task')

    def test_full_duplex_pipes_do_not_block_the_http_server(self):
        # The child fills stdout before reading stdin. Both directions must
        # progress without either pipe blocking requests for the other one.
        data = bytes(range(256)) * 4096
        opened = self.request('/process/open', {'command': sys.executable,
            'args': ['-c', 'import sys; sys.stdout.buffer.write(b"x" * 1048576); sys.stdout.buffer.flush(); '
                     'sys.stdout.buffer.write(sys.stdin.buffer.read())'], 'cwd': str(self.root)})
        process_id = opened['id']
        offset, ended_input = 0, False
        output = bytearray()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if offset < len(data):
                chunk = data[offset:offset + 32768]
                acknowledgement = self.request('/process/write', {'id': process_id,
                    'data': base64.b64encode(chunk).decode()})
                self.assertLessEqual(acknowledgement['written'], len(chunk))
                offset += acknowledgement['written']
            elif not ended_input:
                self.request('/process/end-input', {'id': process_id})
                ended_input = True
            result = self.request('/process/read', {'id': process_id})
            output.extend(base64.b64decode(result['stdout']))
            if result['ended']:
                break
        self.assertTrue(result['ended'])
        self.assertEqual(result['exitCode'], 0)
        self.assertEqual(output, b'x' * 1048576 + data)

    @unittest.skipUnless(shutil.which('clangd'), 'clangd is needed for the actual LSP integration check')
    def test_actual_clangd_initialize_and_diagnostics(self):
        source = self.root / 'main.cpp'
        source.write_text('int main() { return missing_name; }\n')
        opened = self.request('/process/open', {'command': shutil.which('clangd'),
            'args': ['--background-index=false'], 'cwd': str(self.root)})
        process_id = opened['id']
        def send(message):
            data = json.dumps(message).encode()
            framed = b'Content-Length: ' + str(len(data)).encode() + b'\r\n\r\n' + data
            self.request('/process/write', {'id': process_id, 'data': base64.b64encode(framed).decode()})
        send({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'processId': None,
            'rootUri': self.root.as_uri(), 'capabilities': {}}})
        buffer = bytearray()
        initialized = False
        diagnostics = []
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and not diagnostics:
            result = self.request('/process/read', {'id': process_id})
            buffer.extend(base64.b64decode(result['stdout']))
            while b'\r\n\r\n' in buffer:
                header, rest = buffer.split(b'\r\n\r\n', 1)
                length = int(next(line.split(b':', 1)[1] for line in header.split(b'\r\n') if line.lower().startswith(b'content-length:')))
                if len(rest) < length:
                    break
                message = json.loads(rest[:length])
                buffer = bytearray(rest[length:])
                if message.get('id') == 1:
                    self.assertIn('capabilities', message['result'])
                    initialized = True
                    send({'jsonrpc': '2.0', 'method': 'initialized', 'params': {}})
                    send({'jsonrpc': '2.0', 'method': 'textDocument/didOpen', 'params': {'textDocument': {
                        'uri': source.as_uri(), 'languageId': 'cpp', 'version': 1, 'text': source.read_text()}}})
                if message.get('method') == 'textDocument/publishDiagnostics':
                    diagnostics.extend(message['params']['diagnostics'])
            time.sleep(.02)
        self.assertTrue(initialized)
        self.assertTrue(any('missing_name' in item['message'] for item in diagnostics))
        self.request('/process/close', {'id': process_id})


if __name__ == '__main__':
    unittest.main()
