import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const worker = new URL('../editor/runtime/git/worker.js', import.meta.url);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

test('the browser Git worker can reopen a repository and preserve its real Git index and objects', async t => {
  const endpoint = new EventTarget();
  t.mock.method(globalThis, 'fetch', async url => {
    const asset = new URL(url);
    const version = asset.searchParams.get('v');
    asset.search = '';
    const bytes = await readFile(asset);
    if (version) assert.equal(createHash('sha256').update(bytes).digest('hex'), version);
    return new Response(bytes);
  });
  globalThis.self = endpoint;
  t.after(() => { delete globalThis.self; delete globalThis.postMessage; });
  await import(worker);

  let id = 0;
  async function run(entries, operations) {
    const request = ++id;
    const result = new Promise((resolve, reject) => {
      globalThis.postMessage = (message, transfer) => {
        assert.equal(message.id, request);
        if (message.error) reject(new Error(message.error));
        else resolve(structuredClone(message, { transfer }));
      };
    });
    endpoint.dispatchEvent(new MessageEvent('message', { data: { id: request, entries, operations } }));
    return result;
  }

  const path = 'source/space name 雪.txt';
  const tracked = [path, encoder.encode('one\n')];
  const ignored = ['.gitignore', encoder.encode('ignored.txt\n')];
  const scratch = ['ignored.txt', encoder.encode('keep out\n')];
  const identity = ['Test Author', 'author@example.invalid'];
  const initial = await run([tracked, ignored, scratch], [
    ['init', 'main'], ['head'], ['status'], ['stage', path], ['stage', '.gitignore'],
    ['read-index', path], ['read-head', path], ['commit', ...identity, 'Initial commit'],
  ]);
  const outputs = initial.results.map(bytes => bytes === null ? null : decoder.decode(bytes));
  assert.equal(outputs[1], 'refs/heads/main\0\0');
  assert.match(outputs[2], /128\0source\/space name 雪\.txt\0\0/);
  assert.doesNotMatch(outputs[2], /ignored\.txt/);
  assert.equal(outputs[5], 'one\n');
  assert.equal(outputs[6], null);
  const initialSha = outputs[7].slice(0, -1);
  assert.match(initialSha, /^[a-f0-9]{40}$/);

  const reopened = await run([...initial.metadata, [path, encoder.encode('two\n')], ignored, scratch], [
    ['status'], ['read-head', path], ['resolve', 'HEAD'], ['diff-stat', 'index-worktree'],
    ['diff', 'head-worktree'], ['stage', path], ['diff-stat', 'head-index'],
    ['status'], ['unstage', path], ['status'], ['stage', path], ['commit', ...identity, 'Edit the file'],
    ['read-tree', initialSha, path], ['read-head', path], ['status'],
  ]);
  const [uncommitted, original, head, pendingStat, patch, , stagedStat, staged, , unstaged, , nextSha, past, current, clean] =
    reopened.results.map(bytes => decoder.decode(bytes));
  assert.deepEqual([uncommitted, original, head, staged, unstaged, past, current, clean], [
    `256\0${path}\0\0`, 'one\n', `${initialSha}\0`, `2\0${path}\0\0`, `256\0${path}\0\0`, 'one\n', 'two\n', '',
  ]);
  assert.match(nextSha, /^[a-f0-9]{40}\0$/);
  assert.notEqual(nextSha, `${initialSha}\0`);
  assert.equal(pendingStat, `1\x001\x00${path}\0`);
  assert.equal(stagedStat, pendingStat);
  assert.match(patch, /\n-one\n\+two\n/);

  const history = await run(reopened.metadata, [['branches'], ['show', 'HEAD']]);
  const [branches, details] = history.results.map(bytes => decoder.decode(bytes).split('\0'));
  assert.deepEqual(branches.slice(0, 4), ['refs/heads/main', '1', nextSha.slice(0, -1), 'Edit the file']);
  assert.equal(branches[5], identity[0]);
  assert.equal(branches[6], '1');
  assert.equal(details[0], nextSha.slice(0, -1));
  assert.equal(details[1].trimEnd(), 'Edit the file');
  assert.equal(details[3], identity[1]);
  assert.equal(details[4], identity[0]);
  assert.equal(history.metadata, null);

  // An existing repository can have packed refs and a detached HEAD.
  const committedSha = nextSha.slice(0, -1);
  const packed = reopened.metadata.filter(([name]) => !['.git/HEAD', '.git/refs/heads/main'].includes(name));
  packed.push(
    ['.git/HEAD', encoder.encode(`${committedSha}\n`)],
    ['.git/packed-refs', encoder.encode(`${committedSha} refs/heads/main\n${initialSha} refs/remotes/origin/main\n`)],
  );
  const detached = await run(packed, [['branches'], ['resolve', 'refs/heads/main'], ['show', 'refs/remotes/origin/main']]);
  const [detachedBranches, packedMain, remoteCommit] = detached.results.map(bytes => decoder.decode(bytes).split('\0'));
  const names = new Map();
  for (let offset = 0; offset < detachedBranches.length - 1; offset += 7) {
    names.set(detachedBranches[offset], detachedBranches.slice(offset + 1, offset + 3));
  }
  assert.deepEqual(names.get('HEAD'), ['1', committedSha]);
  assert.deepEqual(names.get('refs/heads/main'), ['0', committedSha]);
  assert.deepEqual(names.get('refs/remotes/origin/main'), ['0', initialSha]);
  assert.equal(packedMain[0], committedSha);
  assert.equal(remoteCommit[0], initialSha);

  const deleted = await run([...reopened.metadata, ignored, scratch], [
    ['status'], ['stage-deletion', path], ['status'], ['read-index', path],
  ]);
  assert.equal(decoder.decode(deleted.results[0]), `512\0${path}\0\0`);
  assert.equal(decoder.decode(deleted.results[2]), `4\0${path}\0\0`);
  assert.equal(deleted.results[3], null);
  await assert.rejects(run(deleted.metadata, [['stage', '../outside']]), /Invalid Git arguments/);
  await assert.rejects(run(deleted.metadata, [['stage', '.git/HEAD']]), /Invalid Git arguments/);
  await assert.rejects(run([['../outside', encoder.encode('outside')]], [['head']]), /Invalid Git snapshot entry/);
});
