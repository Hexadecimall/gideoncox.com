"""Exercise the real Ark PTY through the connector's authenticated HTTP API."""
import importlib.util
import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

CONNECTOR = Path(__file__).resolve().parents[1] / 'connector' / 'ark_connector.py'
ORIGIN = 'http://127.0.0.1:8767'


class SessionCleanupTest(unittest.TestCase):
    def test_empty_foreground_group_never_signals_the_connector_group(self):
        spec = importlib.util.spec_from_file_location('connector_cleanup_test', CONNECTOR)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        session = module.Session.__new__(module.Session)
        session.fd, session.pid, session.exit_code = 10, 12345, None
        with patch.object(module.os, 'tcgetpgrp', return_value=0), \
             patch.object(module.os, 'killpg') as kill, \
             patch.object(module.os, 'close'), \
             patch.object(module.os, 'waitpid', return_value=(12345, 0)):
            session.close()
            session.close()
        kill.assert_called_once_with(12345, module.signal.SIGHUP)


@unittest.skipUnless(shutil.which('ark'), 'Ark must be installed for the native integration check')
class ConnectorTest(unittest.TestCase):
    def test_authenticated_pty_and_origin_boundaries(self):
        # Keep Ark config/history and the test file inside a disposable home.
        with tempfile.TemporaryDirectory() as home:
            bootstrap = '''import importlib.util,sys
spec=importlib.util.spec_from_file_location('connector',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
server=module.Connector(0,[sys.argv[2]],sys.argv[3])
print(server.server_port,server.token,flush=True)
try:
 while True: server.handle_request()
finally: server.close_session();server.server_close()
'''
            process = subprocess.Popen([sys.executable, '-c', bootstrap, str(CONNECTOR), ORIGIN, shutil.which('ark')], cwd=home, env=dict(os.environ, HOME=home), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                ready = process.stdout.readline().strip()
                if not ready:
                    raise RuntimeError(process.stderr.read())
                port, token = ready.split()
                endpoint = f'http://127.0.0.1:{port}'
                def request(path, body=None, origin=ORIGIN, credential=token):
                    headers = {'Origin': origin, 'Authorization': 'Bearer '+credential}
                    data = None
                    if body is not None:
                        data=json.dumps(body).encode();headers['Content-Type']='application/json'
                    with urllib.request.urlopen(urllib.request.Request(endpoint+path,data=data,headers=headers),timeout=5) as response:
                        return json.load(response)
                for origin, credential, expected in [('https://unrelated.invalid',token,403),(ORIGIN,'incorrect',401)]:
                    with self.assertRaises(urllib.error.HTTPError) as caught:
                        request('/connect',{},origin,credential)
                    self.assertEqual(caught.exception.code,expected)
                    caught.exception.close()
                session=request('/connect',{'columns':80,'rows':24})['session']
                request('/input',{'session':session,'text':"printf native-ok > sample.txt; cat sample.txt; printf '\\nPTY_DONE\\n'\r"})
                output=''
                for _ in range(80):
                    output+=request('/output?session='+session)['output']
                    if Path(home,'sample.txt').exists() and output.count('PTY_DONE')>=2:break
                    time.sleep(.05)
                self.assertEqual(Path(home,'sample.txt').read_text(),'native-ok')
                self.assertIn('native-ok',output)
                request('/resize',{'session':session,'columns':95,'rows':30})
                request('/disconnect',{'session':session})
                with self.assertRaises(urllib.error.HTTPError) as caught:request('/output?session='+session)
                caught.exception.close()
                # Zed panes use independent PTYs and preserve non-UTF8 bytes.
                first=request('/connect',{'encoding':'base64','columns':91,'rows':29})
                second=request('/connect',{'encoding':'base64'})
                self.assertEqual(first['protocol'],2)
                self.assertNotEqual(first['session'],second['session'])
                native=first['session']
                try:
                    payload=b"printf '\\377\\000BINARY_END\\n'; stty size\r"
                    request('/input',{'session':native,'data':base64.b64encode(payload).decode()})
                    binary=b''
                    for _ in range(80):
                        binary+=base64.b64decode(request('/output?session='+native)['data'])
                        if b'\xff\x00BINARY_END' in binary and b'29 91' in binary:break
                        time.sleep(.05)
                    self.assertIn(b'\xff\x00BINARY_END',binary)
                    self.assertIn(b'29 91',binary)
                    with self.assertRaises(urllib.error.HTTPError) as caught:
                        request('/input',{'session':native,'data':'not base64!'})
                    self.assertEqual(caught.exception.code,400)
                    caught.exception.close()
                    request('/disconnect',{'session':native})
                    # Closing a Zed tab must leave another tab running.
                    request('/input',{'session':second['session'],'data':base64.b64encode(b'printf pane-alive\r').decode()})
                    remaining=b''
                    for _ in range(80):
                        remaining+=base64.b64decode(request('/output?session='+second['session'])['data'])
                        if remaining.count(b'pane-alive')>=2:break
                        time.sleep(.05)
                    self.assertIn(b'pane-alive',remaining)
                finally:
                    for item in (first,second):
                        try:request('/disconnect',{'session':item['session']})
                        except urllib.error.HTTPError as error:error.close()
            finally:
                process.terminate();process.communicate(timeout=5)


if __name__ == '__main__':
    unittest.main()
