const CACHE = 'zed-crates-io-v1';
const INDEX = 'https://index.crates.io';
const MIRROR = 'https://raw.githubusercontent.com/rust-lang/crates.io-index/master';
const DOWNLOAD = 'https://static.crates.io';
const CRATE = '[A-Za-z0-9_][A-Za-z0-9_-]{0,63}';
const VERSION = '[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?';
const crateArchive = new RegExp(`^/crates/(${CRATE})/\\1-(${VERSION})\\.crate$`);
const crateDownload = new RegExp(`^/crates/(${CRATE})/(${VERSION})/download$`);
const maxResponse = 32 * 1024 * 1024;
export const REGISTRY_CHUNK = 256 * 1024;

function indexPath(name) {
  if (name.length < 3) return `/${name.length}/${name}`;
  if (name.length === 3) return `/3/${name[0]}/${name}`;
  return `/${name.slice(0, 2)}/${name.slice(2, 4)}/${name}`;
}

export function publicCargoResource(value) {
  let url;
  try { url = new URL(value); }
  catch { return null; }
  if (url.username || url.password || url.search || url.hash) return null;
  const path = decodeURIComponent(url.pathname);
  if (url.origin === INDEX) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (path !== '/config.json' && (!/^[a-z0-9_][a-z0-9_-]{0,63}$/.test(name) || indexPath(name) !== path)) return null;
    // Use a dedicated cache key for cross-origin index responses.
    return { address: `${INDEX}${path}?zed-cargo=1`, mirror: `${MIRROR}${path}`, archive: false };
  }
  let match;
  if (url.origin === DOWNLOAD) match = path.match(crateArchive) ?? path.match(crateDownload);
  else if (url.origin === 'https://crates.io' && path.startsWith('/api/v1/')) match = path.slice(7).match(crateDownload);
  if (!match) return null;
  const [, name, version] = match;
  return { address: `${DOWNLOAD}/crates/${name}/${name}-${version}.crate`, archive: true };
}

async function readResponse(response) {
  if (Number(response.headers.get('content-length')) > maxResponse) throw new Error('Cargo registry response exceeds 32 MB.');
  if (!response.body) return new Uint8Array();
  const chunks = [];
  let length = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxResponse) throw new Error('Cargo registry response exceeds 32 MB.');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function fetchResource(url) {
  return fetch(url, {
    credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(20_000),
  });
}

export class CargoRegistry {
  constructor() {
    this.responses = new Map();
    this.sequence = 0;
  }

  async begin({ method, url }) {
    try {
      const resource = method === 'GET' && publicCargoResource(url);
      if (!resource) return { status: 403, headers: [], length: 0 };
      const { address, archive, mirror } = resource;
      this.cache ??= globalThis.caches?.open(CACHE).catch(() => undefined) ?? Promise.resolve();
      const cache = await this.cache;
      const cached = await cache?.match(address).catch(() => undefined);
      let response = archive ? cached : undefined;
      if (!response) {
        try { response = await fetchResource(address); }
        catch (error) {
          if (cached) response = cached;
          else if (mirror) response = await fetchResource(mirror);
          else throw error;
        }
      }
      const headers = ['content-type', 'etag', 'last-modified'].flatMap(name => {
        const value = response.headers.get(name);
        return value ? [[name, value]] : [];
      });
      const status = response.status;
      if (!response.ok) return { status, headers, length: 0 };
      const bytes = await readResponse(response);
      const token = ++this.sequence;
      if (bytes.length) this.responses.set(token, bytes);
      if (cache && response !== cached) {
        await cache.put(address, new Response(bytes, { status, headers })).catch(() => {});
      }
      return { status, headers, length: bytes.length, token };
    } catch (error) {
      return { status: 503, headers: [], length: 0, error: error?.message || 'Registry request failed.' };
    }
  }

  chunk({ token, offset }) {
    const bytes = this.responses.get(token);
    if (!bytes || !Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length) return [];
    const chunk = bytes.subarray(offset, offset + REGISTRY_CHUNK);
    if (offset + chunk.length === bytes.length) this.responses.delete(token);
    return Array.from(chunk);
  }
}
