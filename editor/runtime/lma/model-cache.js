const models = {
  coder: {
    repository: 'lmstudio-community/Qwen2.5-Coder-0.5B-GGUF',
    filename: 'Qwen2.5-Coder-0.5B-Q4_K_M.gguf',
    revision: 'a25ae40c247296c6f1059f6afe3c4ebecb54d9b9',
    bytes: 397807840,
  },
  agent: {
    repository: 'unsloth/Qwen3-0.6B-GGUF',
    filename: 'Qwen3-0.6B-Q4_K_M.gguf',
    revision: '50968a4468ef4233ed78cd7c3de230dd1d61a56b',
    bytes: 396705472,
  },
};

const CACHE_NAME = 'zed-lma-models';

function modelUrl(model) {
  return `https://huggingface.co/${model.repository}/resolve/${model.revision}/${model.filename}`;
}

export async function hasCachedModel(kind) {
  if (!Object.hasOwn(models, kind)) return false;
  const cached = await caches.match(modelUrl(models[kind]), { cacheName: CACHE_NAME });
  return Boolean(cached?.ok);
}

function checkedDownload(body, model) {
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

export async function recommendedModel(kind = 'coder', { download = true } = {}) {
  if (!Object.hasOwn(models, kind)) throw new Error('Unknown LMA model.');
  const model = models[kind];
  const cache = await caches.open(CACHE_NAME);
  const url = modelUrl(model);
  let response = await cache.match(url);
  if (!response) {
    if (!download) throw new Error('This LMA model was cleared from browser storage. Download it again in Settings.');
    const remote = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(15 * 60_000),
    });
    if (!remote.ok || !remote.body) {
      throw new Error(`The model download failed (${remote.status}).`);
    }
    try {
      await cache.put(url, new Response(checkedDownload(remote.body, model), {
        headers: { 'Content-Type': 'application/octet-stream' },
      }));
    } catch (error) {
      if (error.name === 'QuotaExceededError') {
        const size = Math.ceil(model.bytes / 1_000_000);
        throw new Error(`Browser storage needs ${size} MB to save this model. You can also choose a GGUF file.`);
      }
      throw error;
    }
    response = await cache.match(url);
  }
  if (!response) throw new Error('The downloaded model could not be read from browser storage.');
  return new File([await response.blob()], model.filename, { type: 'application/octet-stream' });
}
