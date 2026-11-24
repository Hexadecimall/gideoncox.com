import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeTerminalBridge } from '../assets/js/zed/native-terminal.js';

function fixture() {
  let count = 0;
  let paired = 0;
  const requests = [];
  const bridge = new NativeTerminalBridge(async () => { paired++; return 'test-pairing-token'; }, async (url, options) => {
    const body = options.body && JSON.parse(options.body);
    requests.push({ url, options, body });
    let result = {};
    if (url.endsWith('/connect')) result = { session: String(++count), protocol: 2, encoding: 'base64' };
    if (url.includes('/output?')) result = { data: '/wAbWzMxbQ==', ended: false };
    return { ok: true, json: async () => result };
  });
  return { bridge, requests, paired: () => paired };
}

test('native terminal sessions share consent but isolate input and closure', async () => {
  const { bridge, requests, paired } = fixture();
  const [first, second] = await Promise.all([bridge.open({ columns: 80, rows: 24 }), bridge.open({ columns: 90, rows: 30 })]);
  assert.equal(paired(), 1);
  const output = await bridge.read(first);
  assert.deepEqual([...output.data], [255, 0, 27, 91, 51, 49, 109]);
  const buffer = new Uint8Array([0, 255, 27]);
  const write = bridge.write(second, buffer);
  buffer.fill(42);
  await write;
  const input = requests.find(request => request.url.endsWith('/input'));
  assert.equal(input.body.session, second);
  assert.equal(input.body.data, 'AP8b');
  await bridge.close(first);
  assert.equal(bridge.sessions.has(second), true);
  assert.equal(bridge.token, 'test-pairing-token');
  await bridge.close(second);
  assert.equal(bridge.token, '');
  for (const request of requests) {
    assert.ok(request.url.startsWith('http://127.0.0.1:8770/'));
    assert.equal(request.options.credentials, 'omit');
    assert.equal(request.options.headers.Authorization, 'Bearer test-pairing-token');
  }
});

test('large native writes and resize retain order without aliasing caller memory', async () => {
  const { bridge, requests } = fixture();
  const id = await bridge.open({ columns: 80, rows: 24 });
  const bytes = new Uint8Array(70000).fill(65);
  await Promise.all([bridge.write(id, bytes), bridge.resize(id, { columns: 100, rows: 40 }), bridge.write(id, new Uint8Array([66]))]);
  const operations = requests.filter(request => /\/(input|resize)$/.test(request.url));
  assert.deepEqual(operations.map(request => request.url.split('/').pop()), ['input', 'input', 'input', 'resize', 'input']);
  assert.equal(operations.slice(0, 3).map(request => atob(request.body.data)).join(''), 'A'.repeat(70000));
  await bridge.close(id);
});

test('pairing cancellation never contacts the local connector', async () => {
  let calls = 0;
  const bridge = new NativeTerminalBridge(async () => { throw new Error('Canceled'); }, async () => { calls++; });
  await assert.rejects(bridge.open({ columns: 80, rows: 24 }), /Canceled/);
  assert.equal(calls, 0);
  assert.equal(bridge.token, '');
});

test('an old connector session is closed before rejecting incompatible byte transport', async () => {
  const calls = [];
  const bridge = new NativeTerminalBridge(async () => 'test-token', async (url, options) => {
    calls.push(url);
    return { ok: true, json: async () => url.endsWith('/connect') ? { session: 'old-session' } : {} };
  });
  await assert.rejects(bridge.open({ columns: 80, rows: 24 }), /Update the local connector/);
  assert.ok(calls.at(-1).endsWith('/disconnect'));
  assert.equal(bridge.sessions.size, 0);
  assert.equal(bridge.token, '');
});
