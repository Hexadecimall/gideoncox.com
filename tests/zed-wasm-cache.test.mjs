import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { editorWasmResponse } from '../assets/js/zed/wasm-cache.js';

function cacheStorageFixture() {
  const entries = new Map();
  const cache = {
    async match(url) { return entries.get(String(url))?.clone(); },
    async put(url, response) { entries.set(String(url), response); },
    async keys() { return [...entries.keys()].map(path => new Request(`https://example.test${path}`)); },
    async delete(item) {
      const url = new URL(typeof item === 'string' ? item : item.url, 'https://example.test');
      return entries.delete(url.pathname + url.search);
    },
  };
  return { entries, cacheStorage: { open: async () => cache } };
}

test('editor assets reuse the cached build and download a new build once', async () => {
  const { entries, cacheStorage } = cacheStorageFixture();
  let requests = 0;
  const fetcher = async url => {
    requests++;
    return new Response(url.split('=').pop());
  };
  const options = { cacheStorage, request: fetcher };
  const first = await editorWasmResponse('one', options);
  await first.save();
  assert.equal(await first.response.text(), 'one');
  const warm = await editorWasmResponse('one', options);
  assert.equal(await warm.response.text(), 'one');
  assert.equal(requests, 1);
  for (const build of ['two', 'three']) {
    const update = await editorWasmResponse(build, options);
    await update.save();
    assert.equal(await update.response.text(), build);
  }
  assert.equal(requests, 3);
  assert.equal(entries.size, 2);
  assert.deepEqual([...entries.keys()].map(url => url.split('=').pop()), ['two', 'three']);
  const failed = await editorWasmResponse('three', options);
  await failed.discard();
  assert.equal(entries.size, 1);
});

test('startup falls back to the network when site storage is blocked', async () => {
  const cacheStorage = { async open() { throw Error('Storage unavailable'); } };
  const download = await editorWasmResponse('uncached', {
    cacheStorage, request: async () => new Response('editor'),
  });
  await download.save();
  assert.equal(await download.response.text(), 'editor');
});

test('gzip builds stream into WebAssembly while the cache keeps compressed bytes', async () => {
  const { entries, cacheStorage } = cacheStorageFixture();
  const wasm = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
  const compressed = new Uint8Array(gzipSync(wasm));
  const options = {
    gzip: true,
    cacheStorage,
    async request(url) {
      assert.match(url, /_bg\.wasm\.gz\?v=gzip-build$/);
      return new Response(compressed);
    },
  };
  const cold = await editorWasmResponse('gzip-build', options);
  const saved = cold.save();
  let received = 0;
  const body = cold.body(bytes => { received += bytes; });
  const fromDownload = await WebAssembly.compileStreaming(new Response(body, {
    headers: { 'Content-Type': 'application/wasm' },
  }));
  assert.ok(fromDownload instanceof WebAssembly.Module);
  assert.equal(received, compressed.length);
  await saved;
  const cached = [...entries.values()][0];
  assert.deepEqual(new Uint8Array(await cached.clone().arrayBuffer()), compressed);
  const warm = await editorWasmResponse('gzip-build', {
    ...options, request: () => { assert.fail('The cached gzip should be reused'); },
  });
  assert.deepEqual(new Uint8Array(await new Response(warm.body()).arrayBuffer()), wasm);
  await warm.discard();
  assert.equal(entries.size, 0);
});

test('limited-memory startup saves and releases the download stream before compiling', async () => {
  const { cacheStorage } = cacheStorageFixture();
  const cache = await cacheStorage.open();
  const put = cache.put;
  cache.put = async (url, response) => {
    // CacheStorage consumes the supplied stream and provides a separate reader.
    await put(url, new Response(await response.arrayBuffer()));
  };
  const wasm = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
  let requests = 0;
  const options = {
    gzip: true,
    cacheBeforeCompile: true,
    cacheStorage,
    async request() {
      requests++;
      const response = new Response(gzipSync(wasm));
      response.clone = () => assert.fail('Do not fork the network body during compilation');
      return response;
    },
  };
  for (let open = 0; open < 2; open++) {
    const download = await editorWasmResponse('mobile', options);
    await download.save();
    assert.deepEqual(new Uint8Array(await new Response(download.body()).arrayBuffer()), wasm);
  }
  assert.equal(requests, 1);
});

test('limited-memory startup can compile after storage consumes a failed write', async () => {
  const { cacheStorage } = cacheStorageFixture();
  const cache = await cacheStorage.open();
  cache.put = async (_url, response) => {
    await response.arrayBuffer();
    throw new Error('Quota exceeded');
  };
  const requests = [];
  const download = await editorWasmResponse('quota', {
    cacheBeforeCompile: true,
    cacheStorage,
    async request(url, { cache }) {
      requests.push([url, cache]);
      return new Response('editor');
    },
  });
  assert.equal(await new Response(download.body()).text(), 'editor');
  assert.deepEqual(requests.map(([, mode]) => mode), ['no-cache', 'force-cache']);
  assert.equal(requests[0][0], requests[1][0]);
});
