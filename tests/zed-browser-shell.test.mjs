import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Shell } from '../assets/js/terminal/shell.js';
import { BrowserShellBridge } from '../assets/js/zed/browser-shell.js';
import { terminalTransport } from '../assets/js/zed/native-terminal.js';

const encode = new TextEncoder();
const decode = new TextDecoder();

test('terminal routing keeps the browser shell, WASI tasks, and Ark PTY distinct', async t => {
  globalThis.zedLocalFolders = {
    rootFor: path => path?.startsWith('/browser-folders/folder') ? '/browser-folders/folder' : undefined,
  };
  t.after(() => { delete globalThis.zedLocalFolders; });
  const browser = {
    accepts: ({ command }) => command === 'browser-cc', owns: id => id === 'task',
    open: async () => 'task', read: async () => 'WASI task',
  };
  const shell = new BrowserShellBridge();
  t.mock.method(shell, 'open', async () => 'browser-shell:1');
  t.mock.method(shell, 'read', async () => 'Browser Ark');
  const host = { open: async options => options, read: async () => 'native Ark' };
  const transport = terminalTransport(host, browser, shell);
  assert.equal(await transport.open({ command: null, cwd: null }), 'browser-shell:1');
  assert.equal(await transport.open({ cwd: '/home/web/project' }), 'browser-shell:1');
  assert.equal(await transport.open({ cwd: '/browser-folders/folder/src' }), 'browser-shell:1');
  assert.equal(await transport.open({ command: 'browser-ark', cwd: '/native/repo' }), 'browser-shell:1');
  assert.equal(await transport.open({ command: 'browser-cc', cwd: '/home/web' }), 'task');
  assert.deepEqual(await transport.open({ command: 'ark-connector', cwd: '/browser-folders/folder' }), {
    command: null, cwd: null, args: [],
  });
  assert.deepEqual(await transport.open({ cwd: '/native/repo' }), { cwd: '/native/repo' });
  assert.equal(await transport.read('browser-shell:1'), 'Browser Ark');
  assert.equal(await transport.read('task'), 'WASI task');
  assert.equal(await transport.read('host'), 'native Ark');
});

test('Browser Ark runs the WASM shell with line editing, quoted text, pipes, and exit status', async t => {
  const modules = await Promise.all(['ark-core', 'terminal'].map(async name =>
    WebAssembly.compile(await readFile(new URL(`../assets/wasm/${name}.wasm`, import.meta.url)))));
  const runtime = new Shell(...modules);
  const worker = new EventTarget();
  worker.terminate = () => {};
  const commands = [];
  worker.postMessage = ({ id, type, source, interrupt }) => {
    let value = { cwd: '/home/web' };
    if (type === 'run') {
      commands.push(source);
      value = runtime.run(source, interrupt && new Int32Array(interrupt));
    }
    worker.dispatchEvent(new MessageEvent('message', { data: { id, value } }));
  };
  const shell = new BrowserShellBridge(() => worker);
  const id = await shell.open({ columns: 80 });
  t.after(() => shell.close(id));
  assert.match(decode.decode((await shell.read(id)).data), /ark:~ \$ /);

  shell.write(id, encode.encode('\x1b[200~printf "%s\\n" "two words" | grep two > result.txt\ncat result.txt\x1b[201~'));
  await shell.read(id);
  assert.deepEqual(commands, []);
  shell.write(id, encode.encode('\r\n'));
  let result = '';
  while (!result.includes('\r\ntwo words\r\n')) {
    result += decode.decode((await shell.read(id)).data);
  }
  assert.equal(commands.length, 1);
  assert.equal(runtime.files.request('read', 'result.txt')[0], 'two words\n');

  shell.write(id, encode.encode('exit 1\x7f7\r'));
  let exit;
  do { exit = await shell.read(id); } while (!exit.ended);
  assert.equal(commands.at(-1), 'exit 7');
  assert.equal(exit.exitCode, 7);
  assert.equal(shell.sessions.size, 0);
});
