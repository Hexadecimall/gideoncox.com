import { GitWasiWorktree, MAX_GIT_OUTPUT } from './repository.js?v=history-1';

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
    let outputLength = 0;
    for (const [operation, ...args] of operations) {
      const result = await repo.run(operation, ...args);
      outputLength += result?.byteLength ?? 0;
      if (outputLength > MAX_GIT_OUTPUT) throw new Error('Git output exceeded the browser limit.');
      results.push(result);
    }
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
