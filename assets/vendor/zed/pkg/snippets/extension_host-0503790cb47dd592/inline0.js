
export async function fetchExtensionResource(path, archive) {
  const response = await fetch(new URL(path, 'https://api.zed.dev'), {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok || !response.body) {
    throw new Error('Zed Extensions returned HTTP ' + response.status + '.');
  }

  const bounded = limit => {
    let remaining = limit;
    return new TransformStream({
      transform(chunk, controller) {
        remaining -= chunk.byteLength;
        if (remaining < 0) throw new Error('The extension response is too large.');
        controller.enqueue(chunk);
      },
    });
  };

  let body = response.body.pipeThrough(bounded(4 * 1024 * 1024));
  if (archive) {
    body = body.pipeThrough(new DecompressionStream('gzip'))
      .pipeThrough(bounded(16 * 1024 * 1024));
  }
  return new Uint8Array(await new Response(body).arrayBuffer());
}
