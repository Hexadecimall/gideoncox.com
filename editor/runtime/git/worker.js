import { GitWasiWorktree } from './repository.js';

let engine;

async function loadEngine() {
  const manifest = await fetch(new URL('./manifest.json', import.meta.url), { cache: 'no-cache' });
  if (!manifest.ok) throw new Error('Could not load the browser Git manifest.');
  const { sha256 } = await manifest.json();
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid browser Git manifest.');
  const response = await fetch(new URL(`./zed-git.wasm.gz?v=${sha256}`, import.meta.url));
  if (!response.ok || !response.body) throw new Error('Could not download browser Git.');
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  return WebAssembly.compileStreaming(new Response(stream, { headers: { 'Content-Type': 'application/wasm' } }));
}

const writesMetadata = new Set(['init', 'stage', 'stage-deletion', 'unstage', 'commit']);

self.addEventListener('message', async ({ data: { id, entries, operations } }) => {
  try {
    engine ??= loadEngine().catch(error => {
      engine = undefined;
      throw error;
    });
    const repo = new GitWasiWorktree(await engine, entries);
    const results = [];
    for (const [operation, ...args] of operations) results.push(await repo.run(operation, ...args));
    const metadata = operations.some(([operation]) => writesMetadata.has(operation)) ? [...repo.metadata()] : null;
    const buffers = new Set(results.filter(Boolean).map(bytes => bytes.buffer));
    for (const [, bytes] of metadata ?? []) {
      if (bytes) buffers.add(bytes.buffer);
    }
    postMessage({ id, results, metadata }, [...buffers]);
  } catch (error) {
    postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
