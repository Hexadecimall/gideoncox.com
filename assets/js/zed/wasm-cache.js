const CACHE_NAME = 'zed-editor-wasm-v1';
const WASM_PATH = '/assets/vendor/zed/pkg/zed_browser_probe_bg.wasm';

export async function editorWasmResponse(build, cacheStorage = globalThis.caches, request = fetch) {
  const url = `${WASM_PATH}?v=${build}`;
  const cache = await cacheStorage?.open(CACHE_NAME).catch(() => undefined);
  const hit = await cache?.match(url).catch(() => undefined);
  const response = hit ?? await request(url, { cache: 'no-cache' });

  return {
    response,
    async discard() { await cache?.delete(url).catch(() => {}); },
    save() {
      if (!cache || hit || !response.ok || response.status !== 200) return Promise.resolve();
      return cache.put(url, response.clone()).then(async () => {
        // Keep the current and previous versions for editor tabs still on an older release.
        const previous = (await cache.keys()).filter(request => {
          const cached = new URL(request.url);
          return cached.pathname === WASM_PATH && cached.searchParams.get('v') !== build;
        });
        await Promise.all(previous.slice(0, -1).map(request => cache.delete(request)));
      }).catch(() => {});
    },
  };
}
