import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { BrowserGit } from '../assets/js/zed/browser-git.js';
import { LocalFolders } from '../assets/js/zed/local-folders.js';

const worker = new URL('../editor/runtime/git/worker.js', import.meta.url);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function folderFixture(entries, reads) {
  function directory(name) {
    const children = new Map();
    function handle(child, kind) {
      if (!children.has(child)) throw new DOMException('Missing entry', 'NotFoundError');
      const entry = children.get(child);
      if (entry.kind !== kind) throw new DOMException('Wrong entry type', 'TypeMismatchError');
      return entry;
    }
    return {
      kind: 'directory', name, children,
      async isSameEntry(other) { return this === other; },
      async getFileHandle(child) { return handle(child, 'file'); },
      async getDirectoryHandle(child) { return handle(child, 'directory'); },
      async *values() { yield* children.values(); },
    };
  }
  const root = directory('history-fixture');
  for (const [path, content] of entries) {
    const parts = path.split('/');
    const name = parts.pop();
    const parent = parts.reduce((current, part) => {
      if (!current.children.has(part)) current.children.set(part, directory(part));
      return current.children.get(part);
    }, root);
    if (content === null) {
      if (!parent.children.has(name)) parent.children.set(name, directory(name));
    } else {
      parent.children.set(name, {
        kind: 'file', name,
        async getFile() { reads.push(path); return new Blob([content]); },
      });
    }
  }
  return root;
}

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
  async function run(entries, operations, input = null) {
    const request = ++id;
    const result = new Promise((resolve, reject) => {
      globalThis.postMessage = (message, transfer) => {
        assert.equal(message.id, request);
        if (message.error) reject(new Error(message.error));
        else resolve(structuredClone(message, { transfer }));
      };
    });
    endpoint.dispatchEvent(new MessageEvent('message', { data: { id: request, entries, operations, input } }));
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

  const configured = await run(initial.metadata, [
    ['remotes'],
    ['remote-add', 'origin', 'https://github.com/example/project.git'],
    ['remote-add', 'publish', 'ssh://git@example.invalid/project'],
    ['remotes'],
  ]);
  assert.equal(decoder.decode(configured.results[0]), '');
  assert.deepEqual(decoder.decode(configured.results[3]).split('\0'), [
    'origin', 'https://github.com/example/project.git', 'publish', 'ssh://git@example.invalid/project', '',
  ]);
  const trackingConfig = configured.metadata.map(([name, bytes]) => [name, name !== '.git/config' ? bytes :
    encoder.encode(decoder.decode(bytes) + '\n[branch "main"]\n\tremote = origin\n\tmerge = refs/heads/main\n'
      + '[remote]\n\tpushDefault = publish\n'
      + '[branch "topic/feature"]\n\tpushRemote = origin\n')]);
  const trackedRemotes = await run(trackingConfig, [
    ['branch-remote', 'main', 'fetch'], ['branch-remote', 'main', 'push'],
    ['branch-remote', 'topic/feature', 'push'], ['branch-remote', 'absent', 'fetch'],
  ]);
  assert.deepEqual(trackedRemotes.results.map(bytes => bytes && decoder.decode(bytes)),
    ['origin\0', 'publish\0', 'origin\0', null]);
  assert.equal(trackedRemotes.metadata, null);
  await assert.rejects(run(configured.metadata, [['remote-add', 'origin', 'https://example.invalid/other']]), /already exists/);
  const removed = await run(configured.metadata, [['remote-remove', 'publish']]);
  const reopenedRemotes = await run(removed.metadata, [['remotes']]);
  assert.equal(decoder.decode(reopenedRemotes.results[0]), 'origin\0https://github.com/example/project.git\0');

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

  const commitHistory = await run(reopened.metadata, [
    ['history', 'branch', 'main', 'date'], ['history', 'all', '', 'reverse'],
    ['read-commit', nextSha.slice(0, -1)], ['commit-files', 'HEAD', 'false'], ['history', 'all', '', 'author'],
  ]);
  const [currentGraph, reversedGraph, rawCommit, changes, authorGraph] = commitHistory.results.map(bytes => decoder.decode(bytes));
  const commitRecords = graph => {
    const fields = graph.split('\0');
    const records = [];
    for (let offset = 0; offset < fields.length - 1; offset += 3) {
      if (fields[offset] === 'C') records.push(fields.slice(offset + 1, offset + 3));
    }
    return records;
  };
  assert.deepEqual(commitRecords(currentGraph), [[nextSha.slice(0, -1), initialSha], [initialSha, '']]);
  assert.deepEqual(commitRecords(reversedGraph), commitRecords(currentGraph).reverse());
  assert.deepEqual(commitRecords(authorGraph), commitRecords(currentGraph));
  assert.ok(authorGraph.split('\0').some((field, index, fields) => field === 'A' && /^\d+$/.test(fields[index + 2])));
  assert.ok(currentGraph.includes('HEAD -> main'));
  assert.ok(rawCommit.includes(`parent ${initialSha}\n`));
  assert.match(rawCommit, /\n\nEdit the file/);
  assert.equal(changes, `files\0${path}\0` + '4\0one\n4\0two\n');

  const seed = decoder.decode((await run(reopened.metadata, [['read-commit', initialSha]])).results[0]);
  const tree = seed.split('\n')[0];
  const signatures = seed.split('\n').filter(line => /^(author|committer) /.test(line));
  function looseCommit(parents, message) {
    const payload = Buffer.from([tree, ...parents.map(sha => `parent ${sha}`), ...signatures, '', message, ''].join('\n'));
    const object = Buffer.concat([Buffer.from(`commit ${payload.length}\0`), payload]);
    const sha = createHash('sha1').update(object).digest('hex');
    return { sha, object: [`.git/objects/${sha.slice(0, 2)}/${sha.slice(2)}`, deflateSync(object)] };
  }
  const side = looseCommit([initialSha], 'Independent change\n\nÉdit [literal]');
  const merge = looseCommit([nextSha.slice(0, -1), side.sha], 'Merge two branches');
  const merged = await run([
    ...reopened.metadata, side.object, merge.object,
    ['.git/refs/heads/main', encoder.encode(`${merge.sha}\n`)],
  ], [
    ['history', 'branch', 'main', 'date'], ['commit-files', 'HEAD', 'false'],
    ['search-commits', 'branch', 'main', 'ignore-case', 'édit [literal]'],
    ['search-commits', 'all', '', 'literal', '[literal]'],
    ['search-commits', 'all', '', 'literal', 'édit'],
    ['search-commits', 'all', '', 'hash', side.sha.slice(0, 8).toUpperCase()],
    ['search-commits', 'revision', nextSha.slice(0, -1), 'literal', '[literal]'],
  ]);
  const mergeRecords = commitRecords(decoder.decode(merged.results[0]));
  assert.deepEqual(mergeRecords[0], [merge.sha, `${nextSha.slice(0, -1)} ${side.sha}`]);
  assert.ok(mergeRecords.some(([sha]) => sha === side.sha));
  assert.equal(decoder.decode(merged.results[1]), `files\0${path}\0` + '4\0two\n4\0one\n');
  assert.deepEqual(merged.results.slice(2).map(bytes => decoder.decode(bytes)), [
    side.sha + '\0', side.sha + '\0', '', side.sha + '\0', '',
  ]);
  assert.equal(merged.metadata, null);

  // An existing repository can have packed refs and a detached HEAD.
  const committedSha = nextSha.slice(0, -1);
  const packed = reopened.metadata.filter(([name]) => !['.git/HEAD', '.git/refs/heads/main'].includes(name));
  packed.push(
    ['.git/HEAD', encoder.encode(`${committedSha}\n`)],
    ['.git/packed-refs', encoder.encode(`${committedSha} refs/heads/main\n${initialSha} refs/remotes/origin/main\n${initialSha} refs/tags/v1\n`)],
  );
  const detached = await run(packed, [['branches'], ['resolve', 'refs/heads/main'], ['show', 'refs/remotes/origin/main'], ['history', 'all', '', 'topo']]);
  const [detachedBranches, packedMain, remoteCommit, graphRefs] = detached.results.map(bytes => decoder.decode(bytes).split('\0'));
  const names = new Map();
  for (let offset = 0; offset < detachedBranches.length - 1; offset += 7) {
    names.set(detachedBranches[offset], detachedBranches.slice(offset + 1, offset + 3));
  }
  assert.deepEqual(names.get('HEAD'), ['1', committedSha]);
  assert.deepEqual(names.get('refs/heads/main'), ['0', committedSha]);
  assert.deepEqual(names.get('refs/remotes/origin/main'), ['0', initialSha]);
  assert.equal(packedMain[0], committedSha);
  assert.equal(remoteCommit[0], initialSha);
  assert.ok(graphRefs.includes('refs/tags/v1'));
  assert.ok(graphRefs.includes('HEAD'));

  const parentObject = `.git/objects/${initialSha.slice(0, 2)}/${initialSha.slice(2)}`;
  const shallow = await run([
    ...reopened.metadata.filter(([name]) => name !== parentObject),
    ['.git/shallow', encoder.encode(`${committedSha}\n`)],
  ], [
    ['commit-files', 'HEAD', 'false'], ['commit-files', 'HEAD', 'true'], ['history', 'all', '', 'date'],
  ]);
  assert.equal(decoder.decode(shallow.results[0]), 'shallow\0');
  assert.ok(decoder.decode(shallow.results[1]).includes(`${path}\0-\0` + '4\0two\n'));
  assert.deepEqual(commitRecords(decoder.decode(shallow.results[2])), [[committedSha, '']]);

  const deleted = await run([...reopened.metadata, ignored, scratch], [
    ['status'], ['stage-deletion', path], ['status'], ['read-index', path],
  ]);
  assert.equal(decoder.decode(deleted.results[0]), `512\0${path}\0\0`);
  assert.equal(decoder.decode(deleted.results[2]), `4\0${path}\0\0`);
  assert.equal(deleted.results[3], null);
  await assert.rejects(run(deleted.metadata, [['stage', '../outside']]), /Invalid Git arguments/);
  await assert.rejects(run(deleted.metadata, [['stage', '.git/HEAD']]), /Invalid Git arguments/);
  await assert.rejects(run([['../outside', encoder.encode('outside')]], [['head']]), /Invalid Git snapshot entry/);
  const hunkPath = 'normalized.txt';
  const originalText = 'first\nmiddle\nlast\n';
  const edited = 'first edited\nmiddle\nlast edited\n';
  const selected = 'first edited\nmiddle\nlast\n';
  const attributes = ['.gitattributes', encoder.encode('normalized.txt text eol=lf\n')];
  const baseline = await run([[hunkPath, encoder.encode(originalText)], attributes], [
    ['init', 'main'], ['stage', hunkPath], ['commit', ...identity, 'Initial file'],
  ]);
  const editedFiles = [[hunkPath, encoder.encode(edited)], attributes];
  const stagedHunk = await run([...baseline.metadata, ...editedFiles], [
    ['set-index-text', hunkPath, 'false'],
  ], encoder.encode(selected.replaceAll('\n', '\r\n')));
  assert.equal(stagedHunk.worktree, null);
  const hunkState = await run([...stagedHunk.metadata, ...editedFiles], [
    ['read-index', hunkPath], ['read-head', hunkPath], ['diff', 'head-index'], ['diff', 'index-worktree'],
  ]);
  const [index, committed, stagedPatch, unstagedPatch] = hunkState.results.map(bytes => decoder.decode(bytes));
  assert.equal(index, selected);
  assert.equal(committed, originalText);
  assert.match(stagedPatch, /\n-first\n\+first edited\n/);
  assert.doesNotMatch(stagedPatch, /\+last edited/);
  assert.match(unstagedPatch, /\n-last\n\+last edited\n/);
  assert.doesNotMatch(unstagedPatch, /\+first edited/);

  const unstagedHunk = await run([...stagedHunk.metadata, ...editedFiles], [
    ['set-index-text', hunkPath, 'false'],
  ], encoder.encode(originalText));
  const partial = await run([...unstagedHunk.metadata, ...editedFiles], [
    ['read-index', hunkPath], ['diff', 'head-index'], ['diff', 'index-worktree'],
  ]);
  assert.equal(decoder.decode(partial.results[0]), originalText);
  assert.equal(decoder.decode(partial.results[1]), '');
  assert.match(decoder.decode(partial.results[2]), /\+first edited[\s\S]*\+last edited/);

  const emptyBlob = await run(stagedHunk.metadata, [
    ['set-index-text', hunkPath, 'true'],
  ], new Uint8Array());
  const executable = await run(emptyBlob.metadata, [['read-index', hunkPath], ['diff', 'head-index']]);
  assert.equal(executable.results[0].length, 0);
  assert.match(decoder.decode(executable.results[1]), /new mode 100755/);
  await assert.rejects(run(stagedHunk.metadata, [['set-index-text', hunkPath, 'false']]), /Invalid Git file content/);
  await assert.rejects(run(stagedHunk.metadata, [['set-index-text', '.git/HEAD', 'false']], encoder.encode(originalText)), /Invalid Git arguments/);

  const branch = await run([...baseline.metadata, ...editedFiles], [['create-branch', 'feature', '']]);
  const headReference = metadata => decoder.decode(metadata.find(([name]) => name === '.git/HEAD')[1]).trim();
  assert.equal(headReference(branch.metadata), 'ref: refs/heads/feature');
  assert.deepEqual(branch.worktree, { changed: [], removed: [] });
  const branchCommit = await run([...branch.metadata, ...editedFiles], [
    ['stage', hunkPath], ['commit', ...identity, 'Feature changes'],
  ]);
  const contaminated = [[hunkPath, encoder.encode('local edit\n')], attributes];
  const protectedStage = await run([...branchCommit.metadata, ...contaminated], [['stage', hunkPath]]);
  await assert.rejects(run([...protectedStage.metadata, ...contaminated], [['switch-branch', 'main']]), /conflict/);
  const switched = await run([...branchCommit.metadata, ...editedFiles], [['switch-branch', 'main']]);
  assert.equal(headReference(switched.metadata), 'ref: refs/heads/main');
  assert.deepEqual(switched.worktree.changed.map(([name, bytes]) => [name, decoder.decode(bytes)]), [[hunkPath, originalText]]);
  assert.deepEqual(switched.worktree.removed, []);
  await assert.rejects(
    run(switched.metadata, [['delete-branch', 'feature', 'false', 'false']]), /not fully merged/,
  );
  const renamed = await run(switched.metadata, [['rename-branch', 'feature', 'updated-feature']]);
  const dropped = await run(renamed.metadata, [['delete-branch', 'updated-feature', 'false', 'true']]);
  const remaining = await run(dropped.metadata, [['branches']]);
  assert.doesNotMatch(decoder.decode(remaining.results[0]), /refs\/heads\/updated-feature/);

  const textFile = (file, text) => [file, encoder.encode(text)];
  const stashBase = Array.from({ length: 15 }, (_, index) => `line ${index + 1}\n`).join('');
  const stagedText = stashBase.replace('line 1\n', 'staged first\n');
  const unstagedText = stashBase.replace('line 15\n', 'unstaged last\n');
  const bothEdits = stagedText.replace('line 15\n', 'unstaged last\n');
  const stashRoot = await run([textFile('selected.txt', 'base\n'), textFile('partial.txt', stashBase)], [
    ['init', 'main'], ['stage', 'selected.txt'], ['stage', 'partial.txt'], ['commit', ...identity, 'Stash baseline'],
  ]);
  const stashConfig = textFile('.git/config', `[core]\nrepositoryformatversion = 0\n[user]\nname = ${identity[0]}\nemail = ${identity[1]}\n`);
  const stashMetadata = stashRoot.metadata.filter(([file]) => file !== '.git/config').concat([stashConfig]);
  const partialStage = await run(stashMetadata, [['set-index-text', 'partial.txt', 'false']], encoder.encode(stagedText));
  const dirtyFiles = [
    textFile('selected.txt', 'changed\n'), textFile('partial.txt', bothEdits),
    textFile('new.txt', 'selected new file\n'), textFile('left.txt', 'unselected new file\n'),
  ];
  const saved = await run([...partialStage.metadata, ...dirtyFiles], [
    ['stash-save', 'Selected files', 'selected.txt', 'new.txt'],
    ['stash-list'], ['read-index', 'partial.txt'],
  ]);
  assert.match(decoder.decode(saved.results[1]), /^stash@\{0\}\0[0-9a-f]{40}\0\d+\0On main: Selected files\n$/);
  assert.equal(decoder.decode(saved.results[2]), stagedText);
  assert.deepEqual(saved.worktree.removed, ['new.txt']);
  assert.deepEqual(saved.worktree.changed.map(([file, bytes]) => [file, decoder.decode(bytes)]), [
    ['selected.txt', 'base\n'],
  ]);
  const afterSave = [textFile('selected.txt', 'base\n'), ...dirtyFiles.filter(([file]) => ['partial.txt', 'left.txt'].includes(file))];
  const stagedStash = await run([...saved.metadata, ...afterSave], [
    ['stash-staged', 'Just staged'], ['stash-list'], ['read-index', 'partial.txt'],
  ]);
  assert.match(decoder.decode(stagedStash.results[1]), /On main: Just staged\n[\s\S]*On main: Selected files\n/);
  assert.equal(decoder.decode(stagedStash.results[2]), stashBase);
  assert.deepEqual(stagedStash.worktree.changed.map(([file, bytes]) => [file, decoder.decode(bytes)]), [
    ['partial.txt', unstagedText],
  ]);
  assert.deepEqual(stagedStash.worktree.removed, []);
  const savedFiles = afterSave.map(([file, bytes]) => file === 'partial.txt' ? textFile(file, unstagedText) : [file, bytes]);
  const cleanForApply = savedFiles.map(([file, bytes]) => file === 'partial.txt' ? textFile(file, stashBase) : [file, bytes]);
  const appliedStash = await run([...stagedStash.metadata, ...cleanForApply], [['stash-apply', '0'], ['stash-list']]);
  assert.match(decoder.decode(appliedStash.results[1]), /On main: Just staged/);
  assert.deepEqual(appliedStash.worktree.changed.map(([file, bytes]) => [file, decoder.decode(bytes)]), [
    ['partial.txt', stagedText],
  ]);
  await assert.rejects(run([
    ...stagedStash.metadata, ...savedFiles, textFile('new.txt', 'conflicting file\n'),
  ], [['stash-pop', '1']]), /conflict|exist|overwrite/i);
  const poppedStash = await run([...stagedStash.metadata, ...savedFiles], [['stash-pop', '1'], ['stash-list']]);
  assert.doesNotMatch(decoder.decode(poppedStash.results[1]), /Selected files/);
  assert.deepEqual(poppedStash.worktree.changed.map(([file, bytes]) => [file, decoder.decode(bytes)]).sort(), [
    ['new.txt', 'selected new file\n'], ['selected.txt', 'changed\n'],
  ]);
  const emptyStash = await run(poppedStash.metadata, [['stash-drop', '0'], ['stash-list']]);
  assert.equal(decoder.decode(emptyStash.results[1]), '');
  await assert.rejects(run(poppedStash.metadata, [['stash-drop', '-1']]), /Invalid Git stash index/);
  await assert.rejects(run(poppedStash.metadata, [['stash-save', '', '.git/HEAD']]), /Invalid Git arguments/);

  const renamedFiles = [textFile('renamed.txt', 'base\n'), textFile('partial.txt', stashBase)];
  const stagedRename = await run([...stashMetadata, ...renamedFiles], [
    ['stage-deletion', 'selected.txt'], ['stage', 'renamed.txt'], ['status'],
  ]);
  assert.match(decoder.decode(stagedRename.results[2]), /8\0renamed.txt\0selected.txt/);
  const renamedStash = await run([...stagedRename.metadata, ...renamedFiles], [
    ['stash-save', 'Rename', 'renamed.txt'], ['status'],
  ]);
  assert.equal(decoder.decode(renamedStash.results[1]), '');
  assert.deepEqual(renamedStash.worktree.removed, ['renamed.txt']);
  assert.deepEqual(renamedStash.worktree.changed.map(([file, bytes]) => [file, decoder.decode(bytes)]), [
    ['selected.txt', 'base\n'],
  ]);

  const binaryBefore = Uint8Array.of(0, 9, 0, 9);
  const binaryAfter = Uint8Array.of(0, 8, 1, 8);
  const binaryRoot = await run([...stashMetadata, ['binary.dat', binaryBefore]], [
    ['stage', 'binary.dat'], ['commit', ...identity, 'Binary baseline'],
  ]);
  const binaryStaged = await run([...binaryRoot.metadata, ['binary.dat', binaryAfter]], [
    ['stage', 'binary.dat'], ['stash-staged', 'Binary change'],
  ]);
  assert.deepEqual(binaryStaged.worktree.changed, [['binary.dat', binaryBefore]]);

  const blameCommit = decoder.decode(branchCommit.results[1]).slice(0, -1);
  const rootCommit = decoder.decode(baseline.results[2]).slice(0, -1);
  const blameRepo = [
    ...branchCommit.metadata, ...editedFiles,
    ['.git/refs/tags/feature-tip', encoder.encode(blameCommit+'\n')],
    ['.mailmap', encoder.encode('Mapped Author <mapped@example.invalid> <author@example.invalid>\n')],
  ];
  function blameRecords(bytes) {
    const fields = decoder.decode(bytes).split('\0');
    const results = { H: [], M: [], P: [], T: [] };
    const lengths = { H: 15, M: 2, P: 4, T: 2 };
    for (let i = 0; i < fields.length - 1; ) {
      const kind = fields[i++];
      assert.ok(lengths[kind], kind);
      results[kind].push(fields.slice(i, i + lengths[kind]));
      i += lengths[kind];
    }
    return results;
  }
  const historical = await run(blameRepo, [['blame-revision', hunkPath, blameCommit]]);
  assert.equal(historical.metadata, null);
  const blamed = blameRecords(historical.results[0]);
  assert.deepEqual(blamed.H.map(row=>row.slice(0,6)), [
    [blameCommit,'1','1','1',hunkPath,'0'],
    [rootCommit,'2','1','2',hunkPath,'1'],
    [blameCommit,'3','1','3',hunkPath,'0'],
  ]);
  assert.ok(blamed.H.every(row=>row[7]==='Mapped Author' && row[8]==='<mapped@example.invalid>'));
  assert.ok(blamed.M.some(([sha,message])=>sha===blameCommit && message==='Feature changes'));
  assert.deepEqual(blamed.P, [[blameCommit,hunkPath,rootCommit,hunkPath]]);
  assert.deepEqual(blamed.T, [[blameCommit,'feature-tip']]);
  const dirtyBlame = encoder.encode('first edited\r\nunsaved middle\r\nlast edited\r\n');
  const dirtyLines = await run(blameRepo, [['blame-buffer',hunkPath,String(dirtyBlame.byteLength)]],dirtyBlame);
  assert.equal(dirtyLines.metadata,null);
  const dirty = blameRecords(dirtyLines.results[0]);
  assert.deepEqual(dirty.H.map(row=>row.slice(0,2)), [
    [blameCommit,'1'],['0'.repeat(40),'2'],[blameCommit,'3'],
  ]);
  const untrackedBlame = await run(blameRepo,[['blame-revision','untracked.txt',blameCommit]]);
  assert.equal(untrackedBlame.results[0],null);
  await assert.rejects(run(blameRepo,[['blame-buffer',hunkPath,'2']],dirtyBlame), /Invalid Git file content/);

  const oldPath = 'old é file.txt';
  const newPath = 'moved file.txt';
  const renameOriginal = [
    'original content shared by both revisions',
    'a distinct line of prose to make the rename clear',
    'this line changes while the rest remains intact',
    'another stable line of code for the example',
    'old and new filenames share this further line',
    'trailing lines are kept as further evidence',
    '',
  ].join('\n');
  const renameBase = await run([[oldPath,encoder.encode(renameOriginal)]], [
    ['init','main'],['stage',oldPath],['commit',...identity,'Before moving the file'],
  ]);
  const moved = renameOriginal.replace('this line changes while the rest remains intact','edited after changing the filename');
  const renameHead = await run([...renameBase.metadata,[newPath,encoder.encode(moved)]], [
    ['stage-deletion',oldPath],['stage',newPath],['commit',...identity,'Move the file and edit a line'],
  ]);
  const beforeRename = decoder.decode(renameBase.results[2]).slice(0,-1);
  const afterRename = decoder.decode(renameHead.results[2]).slice(0,-1);
  const renames = blameRecords((await run(renameHead.metadata,[['blame-revision',newPath,afterRename]])).results[0]);
  assert.deepEqual(renames.H.map(row=>row.slice(0,6)), [
    [beforeRename,'1','2','1',oldPath,'1'],
    [afterRename,'3','1','3',newPath,'0'],
    [beforeRename,'4','3','4',oldPath,'1'],
  ]);
  assert.deepEqual(renames.P, [[afterRename,newPath,beforeRename,oldPath]]);

  const unrelated = await run([...renameHead.metadata, ['elsewhere.txt', encoder.encode('unrelated')]], [
    ['stage', 'elsewhere.txt'], ['commit', ...identity, 'Before moving the other file'],
  ]);
  const followed = await run(unrelated.metadata, [
    ['history', 'path', newPath, 'date'], ['history', 'path', newPath, 'reverse'],
    ['search-commits', 'path', newPath, 'ignore-case', 'before MOVING'],
    ['search-commits', 'path', newPath, 'hash', beforeRename.slice(0, 8)],
    ['history', 'path', 'missing.txt', 'date'],
  ]);
  const commitIds = bytes => decoder.decode(bytes).split('\0')
    .filter((value, index, fields) => index % 3 === 1 && fields[index - 1] === 'C');
  assert.deepEqual(commitIds(followed.results[0]), [afterRename, beforeRename]);
  assert.deepEqual(commitIds(followed.results[1]), [beforeRename, afterRename]);
  assert.equal(decoder.decode(followed.results[2]), beforeRename + '\0');
  assert.equal(decoder.decode(followed.results[3]), beforeRename + '\0');
  assert.deepEqual(commitIds(followed.results[4]), []);
  assert.equal(followed.metadata, null);
  await assert.rejects(run(unrelated.metadata, [['history', 'path', '../private.txt', 'date']]), /Invalid Git arguments/);

  const shallowObject = `.git/objects/${beforeRename.slice(0,2)}/${beforeRename.slice(2)}`;
  const shallowRename = [
    ...renameHead.metadata.filter(([name])=>name!==shallowObject),
    ['.git/shallow',encoder.encode(afterRename+'\n')],
  ];
  const shallowBlame = await run(shallowRename, [['blame-revision',newPath,afterRename]]);
  const shallowLines = blameRecords(shallowBlame.results[0]);
  assert.deepEqual(shallowLines.H.map(row=>row.slice(0,6)), [[afterRename,'1','6','1',newPath,'1']]);
  assert.deepEqual(shallowLines.P,[]);
  const shallowHistory = await run(shallowRename, [['history', 'path', newPath, 'date']]);
  assert.deepEqual(commitIds(shallowHistory.results[0]), [afterRename]);

  const reads = [];
  const folders = new LocalFolders();
  globalThis.zedLocalFolders = folders;
  t.after(() => { delete globalThis.zedLocalFolders; });
  const snapshotPath = await folders.mount(folderFixture([
    ...renameHead.metadata, [newPath, encoder.encode(moved + 'Line edited outside the editor.\n')],
    ['.git/hooks/unused', encoder.encode('fixture')],
    ['generated/.gitignore', encoder.encode('ignored.bin\n')],
    ['generated/ignored.bin', new Uint8Array(17 * 1024 * 1024)],
    ['untracked.txt', encoder.encode('not staged')],
  ], reads));
  const mountedWorker = new EventTarget();
  mountedWorker.terminate = () => {};
  mountedWorker.postMessage = (message, transfers) => {
    const { id, entries, operations, input } = structuredClone(message, { transfer: transfers });
    run(entries, operations, input).then(
      data => mountedWorker.dispatchEvent(new MessageEvent('message', { data: { ...data, id } })),
      error => mountedWorker.dispatchEvent(new MessageEvent('message', { data: { error: error.message, id } })),
    );
  };
  const mountedGit = new BrowserGit(() => mountedWorker);
  t.after(() => mountedGit.stop(new Error('Test finished')));
  await assert.rejects(mountedGit.requestSelectedFolder(snapshotPath, false, [['commit', ...identity, 'Write']]), /Git changes/);
  await assert.rejects(mountedGit.requestSelectedFolder(snapshotPath, false, [['remote-add', 'origin', 'https://example.invalid']]), /Git changes/);
  assert.deepEqual(reads, []);
  const remoteReads = [];
  const remoteMount = await folders.mount(folderFixture([
    ...trackingConfig,
    ['.git/objects/pack/large.fixture', new Uint8Array(17 * 1024 * 1024)],
  ], remoteReads));
  const diskRemotes = await mountedGit.requestSelectedFolder(remoteMount, false, [['remotes'], ['branch-remote', 'main', 'fetch']]);
  assert.equal(decoder.decode(diskRemotes.results[1]), 'origin\0');
  assert.match(decoder.decode(diskRemotes.results[0]), /https:\/\/github\.com\/example\/project\.git/);
  assert.ok(!remoteReads.some(path => path.startsWith('.git/objects/')));
  await assert.rejects(mountedGit.requestSelectedFolder('/home/web', false, [['head']]), /Choose a local folder/);
  const diskHistory = await mountedGit.requestSelectedFolder(snapshotPath, false, [
    ['history', 'path', newPath, 'date'], ['branches'], ['remotes'],
  ]);
  assert.deepEqual(commitIds(diskHistory.results[0]), [afterRename, beforeRename]);
  assert.equal(decoder.decode(diskHistory.results[1]).split('\0')[0], 'refs/heads/main');
  assert.equal(decoder.decode(diskHistory.results[2]), '');
  assert.ok(reads.includes('.git/config'));
  assert.ok(!reads.includes(newPath) && !reads.includes('.git/hooks/unused'));
  const diskStatus = await mountedGit.requestSelectedFolder(snapshotPath, true, [['status'], ['diff', 'index-worktree']]);
  assert.equal(diskStatus.metadata, null);
  assert.equal(diskStatus.worktree, null);
  assert.match(decoder.decode(diskStatus.results[0]), /moved file\.txt/);
  assert.match(decoder.decode(diskStatus.results[0]), /untracked\.txt/);
  assert.doesNotMatch(decoder.decode(diskStatus.results[0]), /ignored\.bin/);
  assert.match(decoder.decode(diskStatus.results[1]), /\+Line edited outside the editor\./);
  assert.ok(reads.includes('generated/.gitignore'));
  assert.ok(!reads.includes('generated/ignored.bin') && !reads.includes('untracked.txt'));

  const sourceBytes = encoder.encode(moved);
  const withExecutableIndex = await run(renameHead.metadata, [['set-index-text', newPath, 'true']], sourceBytes);
  const diskMode = folderFixture([...withExecutableIndex.metadata, [newPath, sourceBytes]], []);
  const executableMount = await folders.mount(diskMode);
  const modeStatus = await mountedGit.requestSelectedFolder(executableMount, true, [['diff', 'index-worktree']]);
  assert.equal(decoder.decode(modeStatus.results[0]), '');

});
