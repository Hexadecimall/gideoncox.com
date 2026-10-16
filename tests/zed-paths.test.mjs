import test from 'node:test';
import assert from 'node:assert/strict';
import { browserPath, importPaths } from '../assets/js/zed/paths.js';

test('browser save paths stay inside the virtual root', () => {
  assert.equal(browserPath('src/main.rs'), '/home/web/src/main.rs');
  assert.equal(browserPath('main.rs', '/home/web/src'), '/home/web/src/main.rs');
  assert.equal(browserPath('main.rs', '/native/path'), '/home/web/main.rs');
  for (const path of ['../secret', '/home/web/../secret', '/home/web-other/file', '/etc/passwd', 'src//file', 'src/./file', 'src\\file', 'bad\u0000name']) {
    assert.throws(() => browserPath(path));
  }
});

test('folder import retains hierarchy and rejects duplicate or unsafe destinations', () => {
  assert.deepEqual(importPaths([{ name: 'lib.rs', webkitRelativePath: 'project/src/lib.rs' }]), ['/home/web/project/src/lib.rs']);
  assert.throws(() => importPaths([{ name: 'a' }, { name: 'a' }]));
  assert.throws(() => importPaths([{ name: 'a', webkitRelativePath: '../a' }]));
});
