import assert from 'node:assert/strict';
import test from 'node:test';
import { FolderWatch } from '../assets/js/zed/folder-watch.js';
import { installNativeHost } from '../assets/js/zed/native-host.js';

const missing = () => new DOMException('Missing entry', 'NotFoundError');

function fixture() {
  const originals = new Map([['old.py', { revision: 10, text: 'print(1)' }]]);
  const root = {
    name: 'watch-fixture', kind: 'directory',
    async isSameEntry(other) { return this === other; },
    async *keys() { yield* originals.keys(); },
    async getDirectoryHandle() { throw missing(); },
    async getFileHandle(name) {
      if (!originals.has(name)) throw missing();
      return {
        kind: 'file', name,
        async getFile() {
          const record = originals.get(name);
          if (!record) throw missing();
          if (record.error) throw new DOMException('Unavailable', 'NotAllowedError');
          const file = new Blob([record.text]);
          file.lastModified = record.revision;
          return file;
        },
      };
    },
  };
  return { originals, root };
}

test('folder polling feeds the native watch route for edits, moves, and removals', async t => {
  globalThis.window = { addEventListener() {} };
  t.after(() => {
    delete globalThis.window;
    delete globalThis.zedHost;
    delete globalThis.zedLocalFolders;
  });
  const { originals, root } = fixture();
  const host = installNativeHost({});
  const path = await host.folders.mount(root);
  const fs = (op, args = {}) => globalThis.zedHost.fs(op, args);
  const oldFile = `${path}/old.py`;
  const renamed = `${path}/moved.py`;

  assert.deepEqual(await fs('read_dir', { path }), [oldFile]);
  await fs('read', { path: oldFile });
  assert.deepEqual((await fs('watch')).paths, []);

  originals.set('old.py', { revision: 11, text: 'print(2)' });
  assert.deepEqual((await fs('watch')).paths, [oldFile]);
  assert.deepEqual((await fs('watch')).paths, []);

  originals.set('old.py', { error: true });
  assert.deepEqual((await fs('watch')).paths, []);

  originals.delete('old.py');
  originals.set('moved.py', { revision: 12, text: 'print(2)' });
  assert.deepEqual(new Set((await fs('watch')).paths), new Set([oldFile, renamed]));
  assert.deepEqual(await fs('read_dir', { path }), [renamed]);
  assert.deepEqual((await fs('watch')).paths, []);
});

test('the browser observer reports exact paths and falls back after dropped events', async t => {
  let callback;
  let disconnected = false;
  const handle = {};
  globalThis.FileSystemObserver = class {
    constructor(listener) { callback = listener; }
    async observe(target, options) {
      assert.equal(target, handle);
      assert.deepEqual(options, { recursive: true });
    }
    disconnect() { disconnected = true; }
  };
  t.after(() => { delete globalThis.FileSystemObserver; });
  const root = '/browser-folders/fixture';
  const changed = [];
  let checks = 0;
  const watch = new FolderWatch(root, async () => {
    checks++;
    return { type: 'file', revision: 'new' };
  }, path => changed.push(path));
  watch.remember(`${root}/old.py`, 'file', 'old', true);
  await watch.start(handle);
  await watch.poll();
  assert.equal(checks, 0);
  callback([
    { type: 'moved', relativePathComponents: ['src', 'new.py'], relativePathMovedFrom: ['old.py'] },
    { type: 'modified', relativePathComponents: ['..', 'private'] },
  ]);
  assert.deepEqual(changed, [`${root}/src/new.py`, `${root}/old.py`]);
  callback([{ type: 'unknown', relativePathComponents: [] }]);
  assert.equal(disconnected, true);
  await watch.poll();
  assert.equal(checks, 1);
  assert.deepEqual(changed, [`${root}/src/new.py`, `${root}/old.py`, `${root}/old.py`]);
});

test('fallback batches stay bounded while recently read files get checked first', async () => {
  const checked = [];
  const watch = new FolderWatch('/fixture', async path => {
    checked.push(path);
    return { type: 'file', revision: 'same' };
  }, () => assert.fail('Unexpected change'));
  for (let index = 0; index < 60; index++) watch.remember(`/fixture/${index}`, 'file', 'same');
  watch.remember('/fixture/recent', 'file', 'same', true);
  await watch.poll();
  assert.equal(checked[0], '/fixture/recent');
  assert.equal(checked.length, 25);
  await watch.poll();
  await watch.poll();
  assert.equal(new Set(checked).size, 61);
});
