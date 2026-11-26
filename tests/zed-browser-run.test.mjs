import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('running Python forwards arguments and keeps the active buffer and terminal local', async t => {
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
  const argumentsForScript = ['--mode', 'two words', '', '雪'];
  const options = {
    cwd: '/home/web/project', command: 'browser-python',
    args: [paths[0], 'python', '--', ...argumentsForScript],
    env: { ZED_BROWSER_SOURCE: 'changed in the editor' },
  };
  assert.equal(bridge.accepts({ command: 'python3' }), false);
  await assert.rejects(bridge.open({ ...options, args: ['/opt/project/main.py'] }), /outside the browser project/);
  await assert.rejects(bridge.open({ ...options, args: [...options.args, 'bad\0arg'] }), /NUL/);
  const id = await bridge.open(options);
  t.after(() => bridge.close(id));
  assert.equal(bridge.owns(id), true);
  assert.match(decode((await bridge.read(id)).data), /Starting Python/);
  const { files, stdin, programArgs } = await posted;
  assert.deepEqual(programArgs, argumentsForScript);
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
  worker.dispatchEvent(new MessageEvent('message', { data: { code: 7, ranProgram: true } }));
  const result = await bridge.read(id);
  assert.equal(result.ended, true);
  assert.equal(result.exitCode, 7);
  assert.equal(decode(result.data), 'result\r\n\r\nExit code: 7\r\n');
  assert.equal(worker.terminated, true);
});

test('CPython WASI receives exact sys.argv values and preserves the exit code', { timeout: 20000 }, async t => {
  const scope = new EventTarget();
  scope.close = () => {};
  const chunks = [];
  let finish;
  const exited = new Promise(resolve => { finish = resolve; });
  const restore = ['self', 'postMessage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => {
    for (const [key, descriptor] of restore) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  globalThis.self = scope;
  globalThis.postMessage = message => {
    if (message.chunk) chunks.push(decode(message.chunk));
    else finish(message);
  };
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url.protocol, 'file:');
    const asset = new URL(url);
    asset.search = '';
    return new Response(await readFile(asset));
  });
  await import('../editor/runtime/python/worker.js');

  const cwd = '/home/web';
  const script = `${cwd}/argument demo.py`;
  const programArgs = ['--mode', 'two words', '', '雪', '"quotes"'];
  const code = 'import json, sys\nprint(json.dumps(sys.argv, ensure_ascii=False))\nsys.exit(23)';
  scope.dispatchEvent(new MessageEvent('message', {
    data: { cwd, script, programArgs, files: [[script, encode(code)]], stdin: createStdin().buffer },
  }));
  assert.deepEqual(await exited, { code: 23, ranProgram: true });
  assert.deepEqual(JSON.parse(chunks.join('')), [script, ...programArgs]);
});

test('a WebAssembly task forwards exact program arguments and displays the exit code after running', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('The task must stay local'); });
  const isolation = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');
  Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: true });
  t.after(() => {
    if (isolation) Object.defineProperty(globalThis, 'crossOriginIsolated', isolation);
    else delete globalThis.crossOriginIsolated;
  });

  for (const [programArgs, data, code, exitLine] of [
    [['--mode', 'two words', '', '雪'], { code: 23, ranProgram: true }, 23, 'Exit code: 23'],
    [[], { code: 0, ranProgram: true }, 0, 'Exit code: 0'],
    [undefined, { code: 1 }, 1, 'Build exit code: 1'],
    [undefined, { error: 'WebAssembly runtime trap' }, 1, 'Task exit code: 1'],
  ]) {
    const worker = new EventTarget();
    worker.terminate = () => {};
    const posted = new Promise(resolve => { worker.postMessage = resolve; });
    const bridge = new BrowserRunBridge({ async list_browser_paths() { return '[]'; } }, () => worker);
    const options = {
      cwd: '/home/web/project', command: 'browser-cc', args: ['/home/web/project/main.c', 'wasi'],
      env: { ZED_BROWSER_SOURCE: 'int main(void) { return 0; }' },
    };
    await assert.rejects(bridge.open({ ...options, args: [...options.args, '--', 'bad\0arg'] }), /NUL/);
    if (programArgs !== undefined) options.args.push('--', ...programArgs);
    const id = await bridge.open(options);
    t.after(() => bridge.close(id));
    assert.deepEqual((await posted).programArgs, programArgs);
    worker.dispatchEvent(new MessageEvent('message', { data }));
    const result = await bridge.read(id);
    assert.equal(result.exitCode, code);
    assert.ok(decode(result.data).includes(`\r\n${exitLine}\r\n`));
  }
});

test('C builds reuse a worker after normal exit and release it after cancellation', async t => {
  const isolation = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');
  Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: true });
  t.after(() => {
    if (isolation) Object.defineProperty(globalThis, 'crossOriginIsolated', isolation);
    else delete globalThis.crossOriginIsolated;
  });

  const workers = [];
  const bridge = new BrowserRunBridge({ async list_browser_paths() { return '[]'; } }, () => {
    const worker = new EventTarget();
    worker.postMessage = () => {};
    worker.terminate = () => { worker.terminated = true; };
    workers.push(worker);
    return worker;
  });
  const cwd = '/home/web/project';
  const options = {
    cwd, command: 'browser-cc', args: [`${cwd}/main.c`, 'wasi'],
    env: { ZED_BROWSER_SOURCE: 'int main(void) { return 0; }' },
  };
  const first = await bridge.open(options);
  workers[0].dispatchEvent(new MessageEvent('message', { data: { code: 0, ranProgram: true } }));
  assert.equal((await bridge.read(first)).exitCode, 0);
  assert.equal(workers[0].terminated, undefined);

  const second = await bridge.open(options);
  assert.equal(workers.length, 1);
  await bridge.close(second);
  assert.equal(workers[0].terminated, true);

  const third = await bridge.open(options);
  assert.equal(workers.length, 2);
  await bridge.close(third);
});

test('Zig and Rust snapshot saved arguments even when the project listing omits the config', async t => {
  const isolation = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');
  Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: true });
  t.after(() => {
    if (isolation) Object.defineProperty(globalThis, 'crossOriginIsolated', isolation);
    else delete globalThis.crossOriginIsolated;
  });

  const cwd = '/home/web/project';
  const config = `${cwd}/.zed/browser-build.json`;
  for (const [command, name] of [['browser-zig', 'main.zig'], ['browser-rust', 'main.rs']]) {
    const source = `${cwd}/${name}`;
    const worker = new EventTarget();
    worker.terminate = () => {};
    const posted = new Promise(resolve => { worker.postMessage = resolve; });
    const bridge = new BrowserRunBridge({
      async list_browser_paths() { return '[]'; },
      async read_browser_file(path) {
        assert.equal(path, config);
        return encode('{"args":["two words",""]}');
      },
    }, () => worker);
    const id = await bridge.open({ cwd, command, args: [source, 'wasi'], env: { ZED_BROWSER_SOURCE: '' } });
    t.after(() => bridge.close(id));
    const { files, programArgs } = await posted;
    assert.deepEqual(files.map(([path]) => path), [source, config]);
    assert.deepEqual(JSON.parse(decode(files[1][1])).args, ['two words', '']);
    assert.equal(programArgs, undefined);
  }
});

test('a saved Rust file waits for the foreground compiler and uses the latest save', async t => {
  const isolation = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');
  Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: true });
  t.after(() => {
    if (isolation) Object.defineProperty(globalThis, 'crossOriginIsolated', isolation);
    else delete globalThis.crossOriginIsolated;
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cwd = '/home/web/project';
  const workers = [];
  const lintResult = Promise.withResolvers();
  const lintJob = Promise.withResolvers();
  const bridge = new BrowserRunBridge({
    async list_browser_paths() { return '[]'; },
    async read_browser_file(path) {
      return path.endsWith('.rs') ? encode('fn main() {}') : undefined;
    },
  }, () => {
    const worker = new EventTarget();
    worker.terminate = () => {};
    worker.postMessage = job => { if (job.target === 'clippy') lintJob.resolve(job); };
    workers.push(worker);
    return worker;
  }, (root, result) => lintResult.resolve({ root, result }));
  const active = await bridge.open({ cwd, command: 'browser-cc', args: [`${cwd}/main.c`, 'wasi'],
    env: { ZED_BROWSER_SOURCE: 'int main(void) { return 0; }' } });
  t.after(() => bridge.close(active));

  bridge.scheduleRustCheck(cwd, `${cwd}/previous.rs`);
  bridge.scheduleRustCheck(cwd, `${cwd}/saved.rs`);
  t.mock.timers.tick(650);
  assert.equal(workers.length, 1);
  workers[0].dispatchEvent(new MessageEvent('message', { data: { code: 0, ranProgram: true } }));
  assert.equal((await bridge.read(active)).ended, true);
  t.mock.timers.tick(650);
  const job = await lintJob.promise;
  assert.equal(job.script, `${cwd}/saved.rs`);
  assert.equal(decode(job.files[0][1]), 'fn main() {}');
  const diagnostics = { diagnosticSource: 'clippy', cargoDiagnostics: [] };
  workers[1].dispatchEvent(new MessageEvent('message', { data: diagnostics }));
  workers[1].dispatchEvent(new MessageEvent('message', { data: { code: 0 } }));
  assert.deepEqual(await lintResult.promise, { root: cwd, result: diagnostics });
});

test('the static Linux task offers the linked ELF under its target-specific filename', async t => {
  const isolation = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');
  Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: true });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const link = {
    click() { assert.equal(this.attached, true); this.clicked = true; },
    remove() { this.attached = false; },
  };
  globalThis.document = {
    createElement(tag) { assert.equal(tag, 'a'); return link; },
    body: { append(element) { element.attached = true; } },
  };
  t.after(() => {
    if (isolation) Object.defineProperty(globalThis, 'crossOriginIsolated', isolation);
    else delete globalThis.crossOriginIsolated;
    delete globalThis.document;
  });
  const worker = new EventTarget();
  worker.terminate = () => {};
  const posted = new Promise(resolve => { worker.postMessage = resolve; });
  const bridge = new BrowserRunBridge({ async list_browser_paths() { return '[]'; } }, () => worker);
  const id = await bridge.open({
    cwd: '/home/web/project', command: 'browser-cc',
    args: ['/home/web/project/main.cpp', 'linux-x86_64-static'],
    env: { ZED_BROWSER_SOURCE: 'int main() { return 0; }' },
  });
  t.after(() => bridge.close(id));
  assert.equal((await posted).target, 'linux-x86_64-static');
  const artifact = Uint8Array.of(0x7f, 0x45, 0x4c, 0x46);
  worker.dispatchEvent(new MessageEvent('message', { data: { artifact } }));
  worker.dispatchEvent(new MessageEvent('message', { data: { code: 0 } }));
  assert.equal(link.clicked, true);
  assert.equal(link.attached, false);
  assert.equal(link.download, 'main-linux-x86_64-static.elf');
  assert.deepEqual(new Uint8Array(await (await fetch(link.href)).arrayBuffer()), artifact);
  t.mock.timers.tick(30000);
  assert.equal((await bridge.read(id)).exitCode, 0);
});

test('requested C libraries are included before optional files and may exceed the per-file snapshot limit', async t => {
  const isolation = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');
  Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: true });
  t.after(() => {
    if (isolation) Object.defineProperty(globalThis, 'crossOriginIsolated', isolation);
    else delete globalThis.crossOriginIsolated;
  });
  const cwd = '/home/web/project';
  const script = `${cwd}/main.c`;
  const config = `${cwd}/.zed/browser-build.json`;
  const library = `${cwd}/vendor/libanswer.a`;
  const bytes = new Uint8Array(3 * 1024 * 1024);
  const reads = [];
  const zed = {
    async list_browser_paths() { return JSON.stringify([{ path: config }, { path: library }]); },
    async read_browser_file(path) {
      reads.push(path);
      if (path === config) return encode(JSON.stringify({ libraries: { wasi: ['vendor/libanswer.a'] } }));
      if (path === library) return bytes;
      throw new Error('Unexpected file request');
    },
  };
  const worker = new EventTarget();
  worker.terminate = () => {};
  const posted = new Promise(resolve => { worker.postMessage = resolve; });
  const bridge = new BrowserRunBridge(zed, () => worker);
  const id = await bridge.open({
    cwd, command: 'browser-cc', args: [script, 'wasi'],
    env: { ZED_BROWSER_SOURCE: 'int main(void) { return 0; }' },
  });
  t.after(() => bridge.close(id));
  const { files } = await posted;
  assert.deepEqual(reads, [config, library]);
  assert.deepEqual(files.map(([path]) => path), [script, config, library]);
  assert.equal(files[2][1], bytes);
});
