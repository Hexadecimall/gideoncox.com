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
const HUB = 'https://huggingface.co';
const MAX_MODEL_BYTES = 512 * 1024 * 1024;
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;
const METADATA_HEADER = 'X-Zed-Lma-Model';

function modelUrl(model) {
  const file = model.filename.split('/').map(encodeURIComponent).join('/');
  return `${HUB}/${model.repository}/resolve/${model.revision}/${file}`;
}

export async function hasCachedModel(kind) {
  const cached = await caches.match(cacheKey(kind), { cacheName: CACHE_NAME });
  return Boolean(cached?.ok);
}

export function cacheKey(id) {
  if (Object.hasOwn(models, id)) return modelUrl(models[id]);
  const url = new URL(id);
  if (url.origin !== HUB || url.username || url.password || url.search || url.hash ||
    !/^\/[\w.-]+\/[\w.-]+\/resolve\/[a-f0-9]{40}\/[^?#]+\.gguf$/i.test(url.pathname)) {
    throw new Error('Invalid model ID.');
  }
  return url.href;
}

function entry(id, model) {
  return {
    id,
    name: id === 'agent' ? 'Qwen3 0.6B' : id === 'coder' ? 'Qwen2.5-Coder 0.5B' : model.filename,
    repository: model.repository,
    bytes: model.bytes,
  };
}

async function hubJson(url) {
  const response = await fetch(url, {
    credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Hugging Face returned ${response.status}.`);
  return response.json();
}

export async function searchModels(query) {
  const search = query.trim();
  if (search.length < 2 || search.length > 120) throw new Error('Enter a model name or repository.');
  if (REPOSITORY.test(search) && !search.split('/').some(part => part === '.' || part === '..')) return [search];
  const parameters = new URLSearchParams({
    search, filter: 'gguf', sort: 'downloads', direction: '-1', limit: '30',
  });
  const results = await hubJson(`${HUB}/api/models?${parameters}`);
  return results
    .filter(item => !item.private && !item.gated && REPOSITORY.test(item.id))
    .map(item => item.id);
}

export async function modelFiles(repository) {
  if (!REPOSITORY.test(repository) || repository.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('Invalid Hugging Face repository.');
  }
  const result = await hubJson(`${HUB}/api/models/${repository}?blobs=true`);
  if (result.private || result.gated || !/^[a-f0-9]{40}$/.test(result.sha)) return [];
  return (result.siblings ?? [])
    .filter(file => typeof file.rfilename === 'string' && file.rfilename.length <= 256 &&
      /\.gguf$/i.test(file.rfilename) && !/(?:mmproj|projector|\d{5}-of-\d{5})/i.test(file.rfilename) &&
      file.rfilename.split('/').every(part => part && part !== '.' && part !== '..') &&
      Number.isSafeInteger(file.size) && file.size >= 24 && file.size <= MAX_MODEL_BYTES)
    .map(file => ({ repository, revision: result.sha, filename: file.rfilename, bytes: file.size }))
    .map(model => {
      const preset = Object.keys(models).find(id => modelUrl(models[id]) === modelUrl(model));
      return { ...entry(preset ?? modelUrl(model), model), ...model };
    });
}

export async function installedModels() {
  const cache = await caches.open(CACHE_NAME);
  const requests = await cache.keys();
  const entries = await Promise.all(requests.map(async request => {
    const preset = Object.keys(models).find(id => modelUrl(models[id]) === request.url);
    if (preset) return entry(preset, models[preset]);
    const response = await cache.match(request);
    const header = response?.headers.get(METADATA_HEADER);
    return header ? JSON.parse(decodeURIComponent(header)) : undefined;
  }));
  return entries.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteModel(id) {
  const cache = await caches.open(CACHE_NAME);
  await cache.delete(cacheKey(id));
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

async function cacheModel(id, model, download) {
  const cache = await caches.open(CACHE_NAME);
  const url = cacheKey(id);
  let response = await cache.match(url);
  if (!response) {
    if (!download || !model) throw new Error('This model is no longer installed. Install it again in Settings.');
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
        headers: {
          'Content-Type': 'application/octet-stream',
          [METADATA_HEADER]: encodeURIComponent(JSON.stringify(entry(id, model))),
        },
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
  return response;
}

export async function installModel(candidate) {
  if (!candidate || !REPOSITORY.test(candidate.repository) ||
    !Number.isSafeInteger(candidate.bytes) || candidate.bytes < 24 || candidate.bytes > MAX_MODEL_BYTES) {
    throw new Error('Select a supported GGUF file.');
  }
  if (cacheKey(candidate.id) !== modelUrl(candidate)) throw new Error('The model file has changed.');
  await cacheModel(candidate.id, candidate, true);
}

export async function recommendedModel(id = 'coder', { download = true } = {}) {
  const model = Object.hasOwn(models, id) ? models[id] : undefined;
  const response = await cacheModel(id, model, download);
  const filename = model?.filename ?? decodeURIComponent(new URL(id).pathname.split('/').at(-1));
  return new File([await response.blob()], filename, { type: 'application/octet-stream' });
}
