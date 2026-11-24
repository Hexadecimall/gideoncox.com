import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeTerminalBridge } from '../assets/js/zed/native-terminal.js';
import { installNativeHost, NativeHostBridge } from '../assets/js/zed/native-host.js';

function fixture() {
  const calls = [];
  const transport = new NativeTerminalBridge(async () => 'temporary-test-token', async (url, options) => {
    const body = options.body && JSON.parse(options.body);
    calls.push({ url, body });
    let value = {};
    if (url.endsWith('/workspace/info')) value = { protocol: 3, root: '/project', processes: true };
    if (url.endsWith('/workspace/fs') && body.operation === 'read') value = 'AP8=';
    if (url.endsWith('/process/open')) value = { id: 'process-a', pid: 1234 };
    if (url.endsWith('/process/read')) value = { stdout: 'AP8=', stderr: 'ZXJyb3I=', ended: true, exitCode: 7, signal: null };
    return { ok: true, json: async () => value };
  });
  return { host: new NativeHostBridge(transport), transport, calls };
}

test('browser projects can start Python without routing their commands to a paired computer', async context => {
  const { transport, calls } = fixture();
  const python = {
    accepts: options => options.command === 'zed-browser-pyright' && options.cwd === '/home/web',
    owns: id => id === 'browser-python:test',
    processOpen: async () => ({ id: 'browser-python:test', pid: 0 }),
    processRead: async () => 'worker output',
  };
  globalThis.window = { addEventListener() {} };
  context.after(() => { delete globalThis.window; delete globalThis.zedHost; });
  const host = installNativeHost(transport, python);
  const service = globalThis.zedHost;
  const { id } = await service.processOpen({ command: 'zed-browser-pyright', cwd: '/home/web' });
  assert.equal(await service.processRead(id), 'worker output');
  assert.deepEqual(calls, []);

  await host.connect();
  const requests = calls.length;
  assert.throws(() => service.processOpen({ command: 'sh', cwd: '/home/web' }), /not available/);
  assert.equal(calls.length, requests);
  const native = await service.processOpen({ command: 'clangd', cwd: '/project' });
  assert.equal(native.id, 'process-a');
});

test('local project requires pairing and retains mount identity after disconnect', async () => {
  const { host, transport, calls } = fixture();
  await assert.rejects(host.fs('read', { path: '/project/file' }), /disconnected/);
  assert.equal(calls.length, 0);
  assert.equal(await host.connect(), '/project');
  assert.equal(transport.token, 'temporary-test-token');
  await host.disconnect();
  assert.equal(host.projectRoot, '/project');
  assert.equal(transport.token, '');
  await assert.rejects(host.fs('write', { path: '/project/file', data: new Uint8Array() }), /disconnected/);
});

test('filesystem bytes and process exit status survive transport unchanged', async () => {
  const { host, calls } = fixture();
  await host.connect();
  assert.deepEqual([...await host.fs('read', { path: '/project/file' })], [0, 255]);
  await host.fs('write', { path: '/project/file', data: new Uint8Array([0, 255]) });
  assert.equal(calls.at(-1).body.data, 'AP8=');
  const { id, pid } = await host.processOpen({ command: 'server', args: [], cwd: '/project' });
  assert.equal(pid, 1234);
  const result = await host.processRead(id);
  assert.deepEqual([...result.stdout], [0, 255]);
  assert.equal(new TextDecoder().decode(result.stderr), 'error');
  assert.equal(result.exitCode, 7);
  assert.equal(result.signal, null);
  assert.equal(host.processes.size, 0);
});

test('process input is copied and EOF waits for all chunks', async () => {
  const { host, calls } = fixture();
  await host.connect();
  const { id } = await host.processOpen({ command: 'server', args: [] });
  const data = new Uint8Array(70000).fill(65);
  const pending = host.processWrite(id, data);
  data.fill(66);
  await Promise.all([pending, host.processEndInput(id)]);
  const operations = calls.filter(call => /\/(write|end-input)$/.test(call.url));
  assert.deepEqual(operations.map(call => call.url.split('/').pop()), ['write', 'write', 'write', 'end-input']);
  assert.equal(operations.slice(0, 3).map(call => atob(call.body.data)).join(''), 'A'.repeat(70000));
  await host.disconnect();
  assert.equal(host.processes.size, 0);
});

test('host mounts cannot shadow browser settings or documents', async () => {
  for (const root of ['/', '/home', '/home/web', '/home/web/project']) {
    const transport = new NativeTerminalBridge(async () => 'temporary-test-token', async () => ({
      ok: true, json: async () => ({ protocol: 3, root, processes: true }),
    }));
    const host = new NativeHostBridge(transport);
    await assert.rejects(host.connect(), /overlaps the browser workspace/);
    assert.equal(host.active, false);
    assert.equal(host.projectRoot, null);
    assert.equal(transport.token, '');
  }
});

test('partial process writes retry only the remaining bytes before EOF', async () => {
  const { host, transport } = fixture();
  const originalCall = transport.call.bind(transport);
  const received = [];
  let writes = 0;
  let eof = false;
  transport.call = async (path, body) => {
    if (path === '/process/write') {
      const bytes = Uint8Array.from(atob(body.data), value => value.charCodeAt(0));
      const written = writes++ === 0 ? 0 : Math.min(7, bytes.length);
      received.push(...bytes.subarray(0, written));
      assert.equal(eof, false);
      return { written };
    }
    if (path === '/process/end-input') eof = true;
    return originalCall(path, body);
  };
  await host.connect();
  const { id } = await host.processOpen({ command: 'server' });
  const bytes = Uint8Array.from({ length: 100 }, (_, index) => index);
  await Promise.all([host.processWrite(id, bytes), host.processEndInput(id)]);
  assert.deepEqual(received, [...bytes]);
  assert.equal(eof, true);
  await host.disconnect();
});

test('disconnect interrupts input waiting for pipe space', async () => {
  const { host, transport } = fixture();
  const originalCall = transport.call.bind(transport);
  let attempted;
  const firstWrite = new Promise(resolve => { attempted = resolve; });
  transport.call = async (path, body) => {
    if (path === '/process/write') { attempted(); return { written: 0 }; }
    return originalCall(path, body);
  };
  await host.connect();
  const { id } = await host.processOpen({ command: 'server' });
  const write = host.processWrite(id, new Uint8Array([1, 2, 3]));
  await firstWrite;
  await host.disconnect();
  await assert.rejects(write, /disconnected/);
});
