import assert from 'node:assert/strict';
import test from 'node:test';
import { editorWasmResponse } from '../assets/js/zed/wasm-cache.js';

test('editor assets reuse the cached build and download a new build once', async () => {
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
  const storage = { open: async () => cache };
  let requests = 0;
  const fetcher = async url => {
    requests++;
    return new Response(url.split('=').pop());
  };
  const first = await editorWasmResponse('one', storage, fetcher);
  await first.save();
  assert.equal(await first.response.text(), 'one');
  const warm = await editorWasmResponse('one', storage, fetcher);
  assert.equal(await warm.response.text(), 'one');
  assert.equal(requests, 1);
  for (const build of ['two', 'three']) {
    const update = await editorWasmResponse(build, storage, fetcher);
    await update.save();
    assert.equal(await update.response.text(), build);
  }
  assert.equal(requests, 3);
  assert.equal(entries.size, 2);
  assert.deepEqual([...entries.keys()].map(url => url.split('=').pop()), ['two', 'three']);
  const failed = await editorWasmResponse('three', storage, fetcher);
  await failed.discard();
  assert.equal(entries.size, 1);
});

test('startup falls back to the network when site storage is blocked', async () => {
  const storage = { async open() { throw Error('Storage unavailable'); } };
  const download = await editorWasmResponse('uncached', storage, async () => new Response('editor'));
  await download.save();
  assert.equal(await download.response.text(), 'editor');
});
