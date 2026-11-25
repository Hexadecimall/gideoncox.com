import assert from 'node:assert/strict';
import test from 'node:test';
import { CargoRegistry, publicCargoResource, REGISTRY_CHUNK } from '../editor/runtime/compiler/cargo-registry.js';

test('Cargo registry requests resolve only public package names and official HTTPS hosts', () => {
  assert.match(publicCargoResource('https://index.crates.io/it/oa/itoa').address, /index\.crates\.io\/it\/oa\/itoa/);
  assert.equal(publicCargoResource('https://crates.io/api/v1/crates/itoa/1.0.14/download').address,
    'https://static.crates.io/crates/itoa/itoa-1.0.14.crate');
  assert.equal(publicCargoResource('https://static.crates.io/crates/wasi/wasi-0.11.1%2Bwasi-snapshot-preview1.crate').archive, true);
  for (const address of [
    'nonsense', 'http://index.crates.io/config.json', 'https://index.crates.io/extra',
    'https://index.crates.io/it/oa/itoa?extra=1', 'https://name@index.crates.io/config.json',
    'https://index.crates.io.example.invalid/config.json', 'https://static.crates.io/crates/itoa/not-itoa-1.0.14.crate',
  ]) assert.equal(publicCargoResource(address), null, address);
});

test('Cargo reuses immutable downloads and reads large archive responses in chunks', async t => {
  const address = 'https://static.crates.io/crates/itoa/itoa-1.0.14.crate';
  const archive = new Uint8Array(REGISTRY_CHUNK + 7).fill(200);
  const entries = new Map();
  const cache = { async match(key) { return entries.get(key)?.clone(); }, async put(key, value) { entries.set(key, value); } };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { async open() { return cache; } } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'caches', previous);
    else delete globalThis.caches;
  });
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests++;
    assert.equal(url, address);
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    return new Response(archive);
  });
  for (const registry of [new CargoRegistry(), new CargoRegistry()]) {
    const response = await registry.begin({ method: 'GET', url: address });
    assert.equal(response.status, 200);
    assert.equal(response.length, archive.length);
    const { token } = response;
    assert.deepEqual(Uint8Array.from(registry.chunk({ token, offset: 0 })), archive.subarray(0, REGISTRY_CHUNK));
    assert.deepEqual(registry.chunk({ token, offset: REGISTRY_CHUNK }), Array(7).fill(200));
    assert.deepEqual(registry.chunk({ token, offset: 0 }), []);
    assert.equal((await registry.begin({ method: 'POST', url: address })).status, 403);
  }
  assert.equal(requests, 1);
});
