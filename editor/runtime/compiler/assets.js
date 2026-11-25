const CACHE = 'zed-compiler-assets-v1';
const decoder = new TextDecoder();
let manifest;

async function asset(name, consume) {
  manifest ??= fetch(new URL('./manifest.json', import.meta.url), { cache: 'no-cache' }).then(response => {
    if (!response.ok) throw new Error('Could not load the compiler manifest.');
    return response.json();
  });
  const hash = (await manifest)[name];
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Missing compiler asset ${name}.`);
  const url = new URL(`./${name}?v=${hash}`, import.meta.url);
  const cache = await globalThis.caches?.open(CACHE).catch(() => undefined);
  const hit = await cache?.match(url).catch(() => undefined);
  const response = hit ?? await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Could not load ${name} (${response.status}).`);
  const save = hit || !cache ? undefined : cache.put(url, response.clone()).catch(() => {});
  try {
    const result = await consume(response.body.pipeThrough(new DecompressionStream('gzip')));
    if (save) {
      await save;
      const older = await cache.keys().catch(() => []);
      await Promise.all(older.filter(request => {
        const old = new URL(request.url);
        return old.pathname === url.pathname && old.search !== url.search;
      }).map(request => cache.delete(request).catch(() => {})));
    }
    return result;
  } catch (error) {
    await save;
    await cache?.delete(url).catch(() => {});
    throw error;
  }
}

export function loadModule(name) {
  return asset(name, stream => WebAssembly.compileStreaming(new Response(stream, {
    headers: { 'Content-Type': 'application/wasm' },
  })));
}

function tarField(bytes, start, length) {
  return decoder.decode(bytes.subarray(start, start + length)).split('\0', 1)[0];
}

export function loadArchive(name) {
  return asset(name, async stream => {
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    const files = new Map();
    for (let offset = 0; offset + 512 <= bytes.length;) {
      const filename = tarField(bytes, offset, 100);
      if (!filename) return files;
      const prefix = tarField(bytes, offset + 345, 155);
      const path = prefix ? `${prefix}/${filename}` : filename;
      const size = Number.parseInt(tarField(bytes, offset + 124, 12), 8);
      const type = bytes[offset + 156];
      offset += 512;
      if (!Number.isSafeInteger(size) || size < 0 || offset + size > bytes.length || (type && type !== 48)) {
        throw new Error(`Invalid compiler archive ${name}.`);
      }
      files.set(path, bytes.subarray(offset, offset + size));
      offset += Math.ceil(size / 512) * 512;
    }
    throw new Error(`Truncated compiler archive ${name}.`);
  });
}
