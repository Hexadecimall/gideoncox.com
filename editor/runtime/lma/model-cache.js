const model = {
  filename: 'qwen2.5-coder-0.5b-instruct-q4_k_m.gguf',
  revision: 'ebb2015119c907b064c512bf053e945850b5875f',
  bytes: 491400064,
};

function checkedDownload(body) {
  const magic = new TextEncoder().encode('GGUF');
  let received = 0;
  return body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      for (let i = 0; i < chunk.length && received + i < magic.length; i++) {
        if (chunk[i] !== magic[received + i]) throw new Error('The download is not a GGUF model.');
      }
      received += chunk.length;
      if (received > model.bytes) throw new Error('The model download exceeds its expected size.');
      controller.enqueue(chunk);
    },
    flush() {
      if (received !== model.bytes) throw new Error('The model download ended before it was complete.');
    },
  }));
}

export async function recommendedModel() {
  const cache = await caches.open('zed-lma-models');
  const url = `https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/${model.revision}/${model.filename}`;
  let response = await cache.match(url);
  if (!response) {
    const download = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(15 * 60_000),
    });
    if (!download.ok || !download.body) {
      throw new Error(`The model download failed (${download.status}).`);
    }
    await cache.put(url, new Response(checkedDownload(download.body), {
      headers: { 'Content-Type': 'application/octet-stream' },
    }));
    response = await cache.match(url);
  }
  if (!response) throw new Error('The downloaded model could not be read from browser storage.');
  return new File([await response.blob()], model.filename, { type: 'application/octet-stream' });
}
