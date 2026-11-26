
function bounded(limit) {
  let remaining = limit;
  return new TransformStream({
    transform(chunk, controller) {
      remaining -= chunk.byteLength;
      if (remaining < 0) throw new Error('The extension response is too large.');
      controller.enqueue(chunk);
    },
  });
}

async function collect(body, limit) {
  return new Uint8Array(await new Response(body.pipeThrough(bounded(limit))).arrayBuffer());
}

export async function fetchExtensionResource(path, maxBytes) {
  const response = await fetch(new URL(path, 'https://api.zed.dev'), {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok || !response.body) {
    throw new Error('Zed Extensions returned HTTP ' + response.status + '.');
  }

  return collect(response.body, maxBytes);
}

export function unpackExtensionArchive(compressed) {
  const body = new Response(compressed).body.pipeThrough(new DecompressionStream('gzip'));
  return collect(body, 32 * 1024 * 1024);
}

export async function accessExtensionArchive(path, operation, bytes) {
  const cache = await caches.open('zed-extension-packages-v1');
  const url = new URL('/editor/_extension_packages/' + path, location.origin);
  if (operation === 'write') {
    await cache.put(url, new Response(bytes));
  } else if (operation === 'remove') {
    await cache.delete(url);
  } else {
    const response = await cache.match(url);
    if (!response?.body) throw new Error('The saved extension archive is missing.');
    return collect(response.body, 8 * 1024 * 1024);
  }
}
