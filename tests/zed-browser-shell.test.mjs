import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Shell } from '../assets/js/terminal/shell.js';
import { BrowserRunBridge } from '../assets/js/zed/browser-run.js';
import { BrowserShellBridge } from '../assets/js/zed/browser-shell.js';
import { BrowserTerminalProject } from '../assets/js/zed/terminal-project.js';
import { terminalTransport } from '../assets/js/zed/native-terminal.js';
import { WorkerHost } from './fixtures/zed-worker-host.mjs';

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

test('the Ark worker reads and updates the live Zed project, expands globs, and opens a file', { timeout: 8000 }, async t => {
  const cwd = '/home/web/project';
  const path = `${cwd}/notes.txt`;
  const files = new Map([[cwd, null], [path, 'editor text\n']]);
  const opened = [];
  const project = new BrowserTerminalProject({
    async terminal_project_fs(root, operation, json) {
      assert.equal(root, '/home/web');
      const [path, value] = JSON.parse(json);
      let result = [];
      switch (operation) {
        case 'metadata':
          if (files.has(path)) result = files.get(path) === null ? ['d', '0'] : ['f', String(files.get(path).length)];
          break;
        case 'list':
          for (const [child, content] of files) {
            if (child.startsWith(path + '/') && !child.slice(path.length + 1).includes('/')) {
              result.push(child, content === null ? 'd' : 'f');
            }
          }
          break;
        case 'read': result = [files.get(path)]; break;
        case 'write': files.set(path, value); break;
        case 'append': files.set(path, (files.get(path) ?? '') + value); break;
        default: assert.fail(`Unexpected operation ${operation}`);
      }
      return JSON.stringify(result);
    },
    async open_file(path) { opened.push(path); },
  });
  const worker = new URL('./fixtures/zed-terminal-project-worker.mjs', import.meta.url);
  const shell = new BrowserShellBridge(() => new WorkerHost(worker), project);
  const id = await shell.open({ cwd, columns: 80 });
  t.after(() => shell.close(id));

  async function run(command, expected) {
    shell.write(id, encode.encode(`${command}\recho done\r`));
    let output = '';
    while (!output.includes('\r\ndone\r\n')) output += decode.decode((await shell.read(id)).data);
    assert.match(output, expected);
  }

  await run('cat *.txt', /\r\neditor text\r\n/);
  await run('echo shell text >> notes.txt', /done/);
  assert.equal(files.get(path), 'editor text\nshell text\n');
  await run('edit notes.txt', /done/);
  assert.deepEqual(opened, [path]);
  await run('echo outside > ../../outside.txt', /path is outside the open project/);
  assert.equal(files.size, 2);
  const browserRoot = '/home/web';
  await assert.rejects(project.fs(browserRoot, 'read', [`${browserRoot}-outside/notes.txt`]), /outside/);
});

test('Browser Ark runs a saved Python script with exact arguments, stdin, and shell exit status', { timeout: 12000 }, async t => {
  const isolation = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');
  Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: true });
  t.after(() => {
    if (isolation) Object.defineProperty(globalThis, 'crossOriginIsolated', isolation);
    else delete globalThis.crossOriginIsolated;
  });
  const root = '/home/web';
  const cwd = `${root}/project/run`;
  const script = `${root}/project/argument demo.py`;
  const helper = `${root}/project/helper.py`;
  const files = new Map([
    [script, 'import json, os, sys, helper\nprint(json.dumps([sys.argv, os.getcwd(), helper.text, input()]))\nsys.exit(23)'],
    [helper, 'text = "helper"'],
  ]);
  const editor = {
    async terminal_project_fs(_root, operation, args) {
      assert.equal(operation, 'metadata');
      assert.ok(cwd.startsWith(JSON.parse(args)[0]));
      return '["d","0"]';
    },
    async list_browser_paths() { return JSON.stringify([...files.keys()].map(path => ({ path }))); },
    async read_browser_file(path) {
      assert.ok(files.has(path), path);
      return encode.encode(files.get(path));
    },
  };
  const fixture = new URL('./fixtures/zed-terminal-project-worker.mjs', import.meta.url);
  const pythonWorker = new URL('?runtime=python', fixture);
  const browser = new BrowserRunBridge(editor, () => new WorkerHost(pythonWorker));
  const shell = new BrowserShellBridge(() => new WorkerHost(fixture), new BrowserTerminalProject(editor), browser);
  const id = await shell.open({ cwd, columns: 80 });
  t.after(() => shell.close(id));

  async function readThrough(marker) {
    let output = '';
    while (!output.includes(marker)) output += decode.decode((await shell.read(id)).data);
    return output;
  }

  shell.write(id, encode.encode('python3 "../argument demo.py" --mode "two words" "" 雪\r'));
  await readThrough('Starting Python');
  shell.write(id, encode.encode('from stdin\r'));
  const output = await readThrough('\x1b[32mark:~/project/run $ ');
  assert.match(output, /Exit code: 23/);
  const line = output.split('\r\n').find(line => line.startsWith('[['));
  assert.deepEqual(JSON.parse(line), [
    ['../argument demo.py', '--mode', 'two words', '', '雪'], cwd, 'helper', 'from stdin',
  ]);
  shell.write(id, encode.encode('echo $?\r'));
  await readThrough('\r\n23\r\n');
  assert.equal(browser.sessions.size, 0);
});
