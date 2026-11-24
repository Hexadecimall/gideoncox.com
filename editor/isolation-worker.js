// Add the headers for WebAssembly threads on static hosting.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('fetch', event => {
  const { request } = event;
  if (new URL(request.url).origin !== self.location.origin || request.method !== 'GET') return;
  event.respondWith((async () => {
    const response = await fetch(request);
    if (!response.status || response.redirected) return response;
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  })());
});
