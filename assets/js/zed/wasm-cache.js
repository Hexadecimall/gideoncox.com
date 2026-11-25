const CACHE_NAME = 'zed-editor-wasm-v1';
const WASM_PATH = '/assets/vendor/zed/pkg/zed_browser_probe_bg.wasm';

export async function editorWasmResponse(build, {
  gzip = false, cacheStorage = globalThis.caches, request = fetch,
} = {}) {
  const url = `${WASM_PATH}${gzip ? '.gz' : ''}?v=${build}`;
  const cache = await cacheStorage?.open(CACHE_NAME).catch(() => undefined);
  const hit = await cache?.match(url).catch(() => undefined);
  const response = hit ?? await request(url, { cache: 'no-cache' });

  return {
    response,
    body(onBytes) {
      let stream = response.body;
      if (!stream) return null;
      if (onBytes && typeof TransformStream === 'function') {
        stream = stream.pipeThrough(new TransformStream({
          transform(chunk, controller) {
            onBytes(chunk.byteLength);
            controller.enqueue(chunk);
          },
        }));
      }
      return gzip ? stream.pipeThrough(new DecompressionStream('gzip')) : stream;
    },
    async discard() { await cache?.delete(url).catch(() => {}); },
    save() {
      if (!cache || hit || !response.ok || response.status !== 200) return Promise.resolve();
      return cache.put(url, response.clone()).then(async () => {
        // Keep the current and previous versions for editor tabs still on an older release.
        const previous = (await cache.keys()).filter(request => {
          const cached = new URL(request.url);
          const isEditor = cached.pathname === WASM_PATH || cached.pathname === `${WASM_PATH}.gz`;
          return isEditor && cached.pathname + cached.search !== url;
        });
        await Promise.all(previous.slice(0, -1).map(request => cache.delete(request)));
      }).catch(() => {});
    },
  };
}
