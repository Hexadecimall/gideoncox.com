"""Exercise the real Ark PTY through the connector's authenticated HTTP API."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

CONNECTOR = Path(__file__).resolve().parents[1] / 'connector' / 'ark_connector.py'
ORIGIN = 'http://127.0.0.1:8767'


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
                port, token = process.stdout.readline().strip().split()
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
            finally:
                process.terminate();process.communicate(timeout=5)


if __name__ == '__main__':
    unittest.main()
