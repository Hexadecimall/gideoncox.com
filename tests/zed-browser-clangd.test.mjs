import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserClangd } from '../assets/js/zed/browser-clangd.js';
import { LspFrames, lspFrame } from '../assets/js/zed/lsp-stream.js';
import { installNativeHost } from '../assets/js/zed/native-host.js';

test('clangd mirrors browser files and preserves ordinary stdio LSP', async context => {
  const worker = new EventTarget();
  const messages = [];
  const bytes = new TextEncoder().encode('int score = 3;');
  worker.postMessage = data => {
    messages.push(data);
    if (data.type === 'start') worker.dispatchEvent(new MessageEvent('message', { data: { type: 'ready' } }));
  };
  worker.terminate = () => {};
  const zed = {
    list_browser_paths: async () => JSON.stringify([
      '/home/web/code.cpp', '/home/web/.config/zed/settings.json',
      '/home/web/.git/config', '/host/private.cpp', '/home/web/../other.cpp',
    ].map(path => ({ path }))),
    read_browser_file: async path => {
      assert.equal(path, '/home/web/code.cpp');
      return bytes;
    },
  };
  globalThis.crossOriginIsolated = true;
  globalThis.window = { addEventListener() {} };
  context.after(() => {
    delete globalThis.crossOriginIsolated;
    delete globalThis.zedHost;
    delete globalThis.window;
  });
  const clangd = new BrowserClangd(zed, () => worker);
  installNativeHost({}, clangd);
  const host = globalThis.zedHost;
  const { id } = await host.processOpen({ command: 'clangd', cwd: '/home/web' });
  context.after(() => clangd.close());
  assert.ok(clangd.owns(id));
  assert.throws(() => host.processOpen({ command: 'sh', cwd: '/home/web' }), /not available/);

  const initialize = lspFrame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: 'file:///home/web' } });
  await host.processWrite(id, initialize.subarray(0, 19));
  await host.processWrite(id, initialize.subarray(19));
  assert.deepEqual(messages[0].files, [['/home/web/code.cpp', bytes]]);
  assert.equal(messages[1].message.params.initializationOptions.fallbackFlags[0], '--target=wasm32-wasi');

  const read = host.processRead(id);
  const response = { jsonrpc: '2.0', id: 1, result: { capabilities: { hoverProvider: true } } };
  worker.dispatchEvent(new MessageEvent('message', { data: { type: 'lsp', message: response } }));
  assert.deepEqual(new LspFrames().push((await read).stdout), [response]);

  await host.processWrite(id, lspFrame({
    jsonrpc: '2.0',
    method: 'textDocument/didSave',
    params: { textDocument: { uri: 'file:///home/web/code.cpp' }, text: 'int x = 4;' },
  }));
  assert.equal(messages[2].path, '/home/web/code.cpp');
  assert.equal(new TextDecoder().decode(messages[2].bytes), 'int x = 4;');
  assert.equal(messages[3].message.method, 'textDocument/didSave');

  await host.processKill(id);
  assert.equal((await host.processRead(id)).ended, true);
});

test('same-language projects keep independent workers and skip unrelated assets', async context => {
  const roots = ['/home/web/one', '/home/web/two'];
  const reads = [];
  const workers = [];
  const zed = {
    async list_browser_paths() {
      return JSON.stringify(roots.flatMap(root => [
        { path: `${root}/main.cpp` }, { path: `${root}/.clang-format` }, { path: `${root}/assets/logo.png` },
        { path: `${root}/node_modules/addon.cpp` },
      ]));
    },
    async read_browser_file(path) { reads.push(path); return new Uint8Array(1); },
  };
  const clangd = new BrowserClangd(zed, () => {
    const worker = new EventTarget();
    worker.messages = [];
    worker.postMessage = message => {
      worker.messages.push(message);
      if (message.type === 'start') worker.dispatchEvent(new MessageEvent('message', { data: { type: 'ready' } }));
    };
    worker.terminate = () => { worker.stopped = true; };
    workers.push(worker);
    return worker;
  });
  globalThis.crossOriginIsolated = true;
  context.after(() => { clangd.close(); delete globalThis.crossOriginIsolated; });
  const [first, second] = await Promise.all(roots.map(cwd => clangd.processOpen({ command: 'clangd', cwd })));
  assert.notEqual(first.id, second.id);
  await Promise.all([first, second].map(({ id }) => clangd.processWrite(id, lspFrame({
    jsonrpc: '2.0', id: 1, method: 'initialize', params: {},
  }))));
  assert.deepEqual(reads.sort(), roots.flatMap(root => [`${root}/.clang-format`, `${root}/main.cpp`]));
  assert.deepEqual(workers.map(worker => worker.messages[0].root), roots);
  await clangd.processClose(first.id);
  assert.equal(workers[0].stopped, true);
  assert.equal(workers[1].stopped, undefined);
});
