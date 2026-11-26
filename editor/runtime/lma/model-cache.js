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
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;
const METADATA_HEADER = 'X-Zed-Lma-Model';
const SHARD = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i;
const SHARD_MANIFEST = '?zed-shards=1';

function modelUrl(model) {
  const file = model.filename.split('/').map(encodeURIComponent).join('/');
  return `${HUB}/${model.repository}/resolve/${model.revision}/${file}`;
}

export async function hasCachedModel(kind) {
  const url = cacheKey(kind);
  const manifest = await caches.match(url + SHARD_MANIFEST, { cacheName: CACHE_NAME });
  if (!manifest) {
    return !SHARD.test(url) && Boolean((await caches.match(url, { cacheName: CACHE_NAME }))?.ok);
  }
  const model = await manifest.json();
  const parts = await Promise.all(model.parts.map(part =>
    caches.match(modelUrl({ ...model, ...part }), { cacheName: CACHE_NAME })));
  return parts.every(part => part?.ok);
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
    name: id === 'agent' ? 'Qwen3 0.6B' : id === 'coder' ? 'Qwen2.5-Coder 0.5B' : model.name ?? model.filename,
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
  const files = (result.siblings ?? [])
    .filter(file => typeof file.rfilename === 'string' &&
      /\.gguf$/i.test(file.rfilename) && !/(?:mmproj|projector)/i.test(file.rfilename) &&
      file.rfilename.split('/').every(part => part && part !== '.' && part !== '..') &&
      Number.isSafeInteger(file.size) && file.size >= 24)
    .map(file => ({ filename: file.rfilename, bytes: file.size }));
  const complete = [];
  const groups = new Map();
  for (const file of files) {
    const shard = SHARD.exec(file.filename);
    if (!shard) {
      complete.push(file);
      continue;
    }
    const [, stem, part, total] = shard;
    const key = `${stem}-of-${total}`;
    if (!groups.has(key)) groups.set(key, { stem, total, parts: new Map() });
    groups.get(key).parts.set(Number(part), file);
  }
  for (const { stem, total, parts } of groups.values()) {
    if (parts.size !== Number(total)) continue;
    const ordered = Array.from({ length: parts.size }, (_, index) => parts.get(index + 1));
    if (ordered.some(part => !part)) continue;
    const bytes = ordered.reduce((size, part) => size + part.bytes, 0);
    complete.push({ ...ordered[0], name: stem + '.gguf', bytes, parts: ordered });
  }
  return complete.map(file => {
    const model = { repository, revision: result.sha, ...file };
    const url = modelUrl(model);
    const preset = Object.keys(models).find(id => modelUrl(models[id]) === url);
    return { ...entry(preset ?? url, model), ...model };
  });
}

export async function installedModels() {
  const cache = await caches.open(CACHE_NAME);
  const requests = await cache.keys();
  const available = new Set(requests.map(request => request.url));
  const entries = await Promise.all(requests.map(async request => {
    if (request.url.endsWith(SHARD_MANIFEST)) {
      const manifest = await cache.match(request);
      const model = await manifest?.json();
      return model?.parts.every(part => available.has(modelUrl({ ...model, ...part }))) ? model : undefined;
    }
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
  const url = cacheKey(id);
  await withModelLock(url, async () => {
    const manifest = await (await cache.match(url + SHARD_MANIFEST))?.json();
    if (manifest) {
      await cache.delete(url + SHARD_MANIFEST);
      for (const part of manifest.parts) await cache.delete(modelUrl({ ...manifest, ...part }));
    } else {
      await cache.delete(url);
    }
  });
}

function withModelLock(key, action) {
  const locks = globalThis.navigator?.locks;
  return locks ? locks.request(key, action) : action();
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

async function downloadModel(cache, url, model, metadata) {
  const remote = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!remote.ok || !remote.body) {
    throw new Error(`The model download failed (${remote.status}).`);
  }
  try {
    await cache.put(url, new Response(checkedDownload(remote.body, model), {
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(metadata && { [METADATA_HEADER]: encodeURIComponent(JSON.stringify(metadata)) }),
      },
    }));
  } catch (error) {
    if (error.name === 'QuotaExceededError') {
      const size = Math.ceil(model.bytes / 1_000_000);
      throw new Error(`Browser storage needs ${size} MB to save this file. You can also choose a downloaded GGUF.`);
    }
    throw error;
  }
}

async function cacheModel(id, model, download) {
  const cache = await caches.open(CACHE_NAME);
  const url = cacheKey(id);
  let response = await cache.match(url);
  if (!response && download && model) {
    await downloadModel(cache, url, model, entry(id, model));
    response = await cache.match(url);
  }
  if (!response && (!download || !model)) throw new Error('This model is no longer installed. Install it again in Settings.');
  if (!response) throw new Error('The downloaded model could not be read from browser storage.');
  return response;
}

export async function installModel(candidate) {
  if (!candidate || !REPOSITORY.test(candidate.repository) ||
    !Number.isSafeInteger(candidate.bytes) || candidate.bytes < 24) {
    throw new Error('Select a supported GGUF file.');
  }
  if (cacheKey(candidate.id) !== modelUrl(candidate)) throw new Error('The model file has changed.');
  if (candidate.parts) {
    const url = cacheKey(candidate.id);
    const cache = await caches.open(CACHE_NAME);
    const first = SHARD.exec(candidate.filename);
    if (!first || Number(first[2]) !== 1 || candidate.parts.length !== Number(first[3]) ||
        candidate.parts.some((part, index) => !Number.isSafeInteger(part.bytes) || part.bytes < 24 ||
          part.filename?.replace(/\.gguf$/i, '.gguf') !== `${first[1]}-${String(index + 1).padStart(5, '0')}-of-${first[3]}.gguf`) ||
        candidate.parts.reduce((size, part) => size + part.bytes, 0) !== candidate.bytes) {
      throw new Error('The model is missing one or more GGUF parts.');
    }
    await withModelLock(url, async () => {
      const written = [];
      try {
        for (const part of candidate.parts) {
          const shard = { ...candidate, ...part };
          const key = cacheKey(modelUrl(shard));
          if (!await cache.match(key)) {
            await downloadModel(cache, key, shard);
            written.push(key);
          }
        }
        await cache.put(url + SHARD_MANIFEST, Response.json(candidate));
      } catch (error) {
        await Promise.allSettled(written.map(key => cache.delete(key)));
        throw error;
      }
    });
    return;
  }
  await cacheModel(candidate.id, candidate, true);
}

export async function recommendedModel(id = 'coder', { download = true } = {}) {
  const url = cacheKey(id);
  const cache = await caches.open(CACHE_NAME);
  const manifest = await (await cache.match(url + SHARD_MANIFEST))?.json();
  if (manifest) {
    const files = [];
    for (const part of manifest.parts) {
      const response = await cache.match(modelUrl({ ...manifest, ...part }));
      if (!response) throw new Error('A GGUF part is missing. Install the model again in Settings.');
      files.push(new File([await response.blob()], part.filename.split('/').at(-1)));
    }
    return files;
  }
  if (SHARD.test(url)) throw new Error('This split model is no longer installed. Install it again in Settings.');
  const model = Object.hasOwn(models, id) ? models[id] : undefined;
  const response = await cacheModel(id, model, download);
  const filename = model?.filename ?? decodeURIComponent(new URL(id).pathname.split('/').at(-1));
  return new File([await response.blob()], filename, { type: 'application/octet-stream' });
}
