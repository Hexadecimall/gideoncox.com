const DIRECTORY = 'zed-lma-models';
const FILE_HEADER = 'X-Zed-Lma-File';

async function modelDirectory(create) {
  const root = await globalThis.navigator?.storage?.getDirectory?.();
  return root?.getDirectoryHandle(DIRECTORY, { create });
}

async function modelFilename(url) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function writableFile(url) {
  let directory;
  try {
    directory = await modelDirectory(true);
  } catch (error) {
    if (error.name !== 'SecurityError' && error.name !== 'NotAllowedError') throw error;
  }
  if (!directory) return;
  const name = await modelFilename(url);
  const handle = await directory.getFileHandle(name, { create: true });
  try {
    if (handle.createWritable) return { name, stream: await handle.createWritable() };
  } catch (error) {
    await directory.removeEntry(name).catch(() => {});
    if (error.name !== 'NotSupportedError') throw error;
    return;
  }
  await directory.removeEntry(name);
}

async function removeFile(name) {
  try {
    const directory = await modelDirectory(false);
    await directory?.removeEntry(name);
  } catch (error) {
    if (error.name !== 'NotFoundError') throw error;
  }
}

export async function saveModelBody(cache, url, body, headers) {
  const file = await writableFile(url);
  if (!file) {
    await cache.put(url, new Response(body, { headers }));
    return;
  }
  try {
    await body.pipeTo(file.stream);
    headers.set(FILE_HEADER, file.name);
    await cache.put(url, new Response(null, { headers }));
  } catch (error) {
    await removeFile(file.name).catch(() => {});
    throw error;
  }
}

export async function readModelBody(response) {
  const name = response.headers.get(FILE_HEADER);
  if (!name) return response.blob();
  const directory = await modelDirectory(false);
  if (!directory) throw new Error('Browser model storage is unavailable.');
  const handle = await directory.getFileHandle(name);
  return handle.getFile();
}

export async function removeModelBody(cache, url) {
  const name = (await cache.match(url))?.headers.get(FILE_HEADER);
  if (name) await removeFile(name);
  await cache.delete(url);
}
