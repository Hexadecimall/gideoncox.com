import { GitWasiWorktree, MAX_GIT_OUTPUT } from './repository.js?v=git-stash-1';

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

const writesWorktree = new Set([
  'create-branch', 'switch-branch', 'stash-save', 'stash-staged', 'stash-pop', 'stash-apply',
]);
const writesMetadata = new Set([
  'init', 'stage', 'set-index-text', 'stage-deletion', 'unstage', 'commit', 'rename-branch', 'delete-branch', ...writesWorktree,
  'remote-add', 'remote-remove', 'stash-drop',
]);

const MAX_GIT_INPUT = 16 * 1024 * 1024;

self.addEventListener('message', async ({ data: { id, entries, operations, input = null } }) => {
  try {
    engine ??= loadEngine().catch(error => {
      engine = undefined;
      throw error;
    });
    const inputOperation = operations.find(([operation]) => operation === 'set-index-text' || operation === 'blame-buffer');
    const validInput = inputOperation
      ? operations.length === 1 && input instanceof Uint8Array && input.byteLength <= MAX_GIT_INPUT
        && (inputOperation[0] !== 'blame-buffer' || inputOperation[2] === String(input.byteLength))
      : input === null;
    if (!validInput) throw new Error('Invalid Git file content.');
    const checkout = operations.some(([operation]) => writesWorktree.has(operation));
    const repo = new GitWasiWorktree(await engine, entries, checkout);
    const results = [];
    let outputLength = 0;
    for (const [operation, ...args] of operations) {
      const result = await repo.run(operation, args, input);
      outputLength += result?.byteLength ?? 0;
      if (outputLength > MAX_GIT_OUTPUT) throw new Error('Git output exceeded the browser limit.');
      results.push(result);
    }
    const metadata = operations.some(([operation]) => writesMetadata.has(operation)) ? [...repo.metadata()] : null;
    const worktree = checkout ? repo.worktreeChanges(entries) : null;
    const buffers = new Set(results.filter(Boolean).map(bytes => bytes.buffer));
    for (const [, bytes] of [...(metadata ?? []), ...(worktree?.changed ?? [])]) {
      if (bytes) buffers.add(bytes.buffer);
    }
    postMessage({ id, results, metadata, worktree }, [...buffers]);
  } catch (error) {
    postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
