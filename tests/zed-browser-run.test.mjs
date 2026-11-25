import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserRunBridge } from '../assets/js/zed/browser-run.js';
import { createStdin, makeStdinReader } from '../editor/runtime/python/stdin.js';

const encode = text => new TextEncoder().encode(text);
const decode = bytes => new TextDecoder().decode(bytes);

test('WASI stdin supports wraparound, backpressure, and EOF', () => {
  const stdin = createStdin();
  const read = makeStdinReader(stdin.buffer);
  assert.equal(stdin.write(new Uint8Array(65_535).fill(97)), true);
  assert.equal(stdin.write(encode('xy')), false);
  assert.equal(read(65_534).length, 65_534);
  assert.equal(stdin.write(encode('xy')), true);
  stdin.close();
  assert.equal(decode(read(10)), 'axy');
  assert.equal(read(10).length, 0);
  assert.equal(stdin.write(encode('late')), false);
});

test('running Python snapshots the active buffer and keeps the project and terminal local', async t => {
  const isolation = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');
  Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: true });
  t.after(() => {
    if (isolation) Object.defineProperty(globalThis, 'crossOriginIsolated', isolation);
    else delete globalThis.crossOriginIsolated;
  });

  const paths = ['/home/web/project/main.py', '/home/web/project/helper.py', '/home/web/project/.git/config',
    '/home/web/project/../outside.py', '/home/web/other/secret.py'];
  const reads = [];
  const editor = {
    async list_browser_paths() { return JSON.stringify(paths.map(path => ({ path }))); },
    async read_browser_file(path) { reads.push(path); return encode('helper'); },
  };
  const worker = new EventTarget();
  worker.terminate = () => { worker.terminated = true; };
  const posted = new Promise(resolve => { worker.postMessage = resolve; });
  const bridge = new BrowserRunBridge(editor, () => worker);
  const options = {
    cwd: '/home/web/project', command: 'browser-python', args: [paths[0]],
    env: { ZED_BROWSER_SOURCE: 'changed in the editor' },
  };
  assert.equal(bridge.accepts({ command: 'python3' }), false);
  await assert.rejects(bridge.open({ ...options, args: ['/opt/project/main.py'] }), /outside the browser project/);
  const id = await bridge.open(options);
  t.after(() => bridge.close(id));
  assert.equal(bridge.owns(id), true);
  assert.match(decode((await bridge.read(id)).data), /Starting Python/);
  const { files, stdin } = await posted;
  assert.deepEqual(reads, [paths[1]]);
  assert.deepEqual(files.map(([path, bytes]) => [path, decode(bytes)]), [
    [paths[0], 'changed in the editor'], [paths[1], 'helper'],
  ]);
  await bridge.write(id, encode('Grüße\r\n\x04'));
  const read = makeStdinReader(stdin);
  assert.equal(decode(read(100)), 'Grüße\n');
  assert.equal(read(100).length, 0);
  assert.equal(decode((await bridge.read(id)).data), 'Grüße\r\n');
  worker.dispatchEvent(new MessageEvent('message', { data: { chunk: encode('result\r\n') } }));
  worker.dispatchEvent(new MessageEvent('message', { data: { code: 7 } }));
  const result = await bridge.read(id);
  assert.equal(result.ended, true);
  assert.equal(result.exitCode, 7);
  assert.equal(decode(result.data), 'result\r\n');
  assert.equal(worker.terminated, true);
});

test('a WebAssembly task displays the program exit code only after it ran', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('The task must stay local'); });
  const isolation = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');
  Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: true });
  t.after(() => {
    if (isolation) Object.defineProperty(globalThis, 'crossOriginIsolated', isolation);
    else delete globalThis.crossOriginIsolated;
  });

  for (const data of [{ code: 0, ranProgram: true }, { code: 23, ranProgram: true }, { code: 1 }]) {
    const worker = new EventTarget();
    worker.terminate = () => {};
    const posted = new Promise(resolve => { worker.postMessage = resolve; });
    const bridge = new BrowserRunBridge({ async list_browser_paths() { return '[]'; } }, () => worker);
    const id = await bridge.open({
      cwd: '/home/web/project', command: 'browser-cc', args: ['/home/web/project/main.c', 'wasi'],
      env: { ZED_BROWSER_SOURCE: 'int main(void) { return 0; }' },
    });
    t.after(() => bridge.close(id));
    await posted;
    worker.dispatchEvent(new MessageEvent('message', { data }));
    const result = await bridge.read(id);
    assert.equal(result.exitCode, data.code);
    const exitLine = `\r\nExit code: ${data.code}\r\n`;
    assert.equal(decode(result.data).includes(exitLine), Boolean(data.ranProgram));
  }
});
