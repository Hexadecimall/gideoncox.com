import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/js/editor.js', import.meta.url), 'utf8');

class Element {
  value = '';
  textContent = '';
  dataset = {};
  hidden = false;
  disabled = false;
  selectionStart = 0;
  selectionEnd = 0;
  scrollTop = 0;
  children = [];
  listeners = new Map();
  selectors = new Map();
  querySelector(selector) {
    if (!this.selectors.has(selector)) this.selectors.set(selector, new Element());
    return this.selectors.get(selector);
  }
  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  async dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) await listener({preventDefault() {}, ...event});
  }
  replaceChildren(...children) { this.children = children; }
  append(child) { this.children.push(child); }
  setAttribute(name, value) { this[name] = value; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  focus() {}
  select() {}
  scrollIntoView() {}
}

async function harness() {
  const root = new Element();
  const files = new Map([['/home/web/demo.txt', 'first\nline']]);
  const window = new Element();
  window.confirm = () => true;
  window.siteFilesReady = Promise.resolve();
  window.siteFiles = {async request(action, args) {
    if (action === 'list') return [...files.keys()].filter(path => path.slice(0, path.lastIndexOf('/')) === args.path).map(path => ({name: path.slice(path.lastIndexOf('/') + 1), path, directory: false}));
    if (action === 'read') {
      if (!files.has(args.path)) throw new Error('File not found');
      return files.get(args.path);
    }
    if (action === 'write') { files.set(args.path, args.text); return; }
    if (action === 'rename') {
      files.set(args.to, files.get(args.from));
      files.delete(args.from);
      return;
    }
    throw new Error(`Unexpected action: ${action}`);
  }};
  root.querySelector('[role="status"]').parentElement = new Element();
  vm.runInNewContext(source, {
    document: {querySelector: () => root, createElement: () => new Element()},
    window, matchMedia: () => ({matches: true}), console, setTimeout,
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  const element = selector => root.querySelector(selector);
  const click = async action => {
    await root.dispatch('click', {target: {closest: () => ({dataset: {action}})}});
    await settle();
  };
  const open = path => window.dispatch('open-site-editor', {detail: {path}});
  const type = async value => {
    element('.editor-text').value = value;
    await element('.editor-text').dispatch('input');
  };
  return {root, window, files, element, click, open, type, settle};
}

test('open and save update the shared filesystem and clear the dirty state', async () => {
  const editor = await harness();
  await editor.open('/home/web/demo.txt');
  assert.equal(editor.element('.editor-text').value, 'first\nline');
  assert.equal(editor.element('.editor-gutter').textContent, '1\n2');
  await editor.type('changed\ncontents');
  assert.equal(editor.element('.editor-path').dataset.dirty, 'true');
  await editor.click('save');
  assert.equal(editor.files.get('/home/web/demo.txt'), 'changed\ncontents');
  assert.equal(editor.element('.editor-path').dataset.dirty, 'false');
});

test('an external edit is preserved and reload reads its latest contents', async () => {
  const editor = await harness();
  await editor.open('/home/web/demo.txt');
  await editor.type('unsaved local edit');
  editor.files.set('/home/web/demo.txt', 'terminal edit');
  await editor.click('save');
  assert.equal(editor.files.get('/home/web/demo.txt'), 'terminal edit');
  assert.match(editor.element('[role="status"]').textContent, /changed in Terminal/);
  assert.equal(editor.element('.editor-text').value, 'unsaved local edit');
  await editor.click('reload');
  assert.equal(editor.element('.editor-text').value, 'terminal edit');
});

test('creating an existing filename never overwrites it', async () => {
  const editor = await harness();
  await editor.open('/home/web/demo.txt');
  await editor.click('new');
  editor.element('#editor-filename').value = 'demo.txt';
  await editor.element('.editor-name-form').dispatch('submit');
  assert.equal(editor.files.get('/home/web/demo.txt'), 'first\nline');
  assert.equal(editor.element('[role="status"]').textContent, 'That name already exists.');
});

test('rename keeps unsaved contents in the buffer until Save', async () => {
  const editor = await harness();
  await editor.open('/home/web/demo.txt');
  await editor.type('unsaved');
  await editor.click('rename');
  editor.element('#editor-filename').value = 'renamed.txt';
  await editor.element('.editor-name-form').dispatch('submit');
  assert.equal(editor.files.has('/home/web/demo.txt'), false);
  assert.equal(editor.files.get('/home/web/renamed.txt'), 'first\nline');
  assert.equal(editor.element('.editor-text').value, 'unsaved');
  await editor.click('save');
  assert.equal(editor.files.get('/home/web/renamed.txt'), 'unsaved');
});

test('canceling the unsaved-change prompt preserves the current file', async () => {
  const editor = await harness();
  editor.files.set('/home/web/other.txt', 'other');
  await editor.open('/home/web/demo.txt');
  await editor.type('unsaved');
  editor.window.confirm = () => false;
  await editor.open('/home/web/other.txt');
  assert.equal(editor.element('.editor-text').value, 'unsaved');
  assert.match(editor.element('.editor-path').textContent, /demo\.txt/);
});

test('find advances and wraps through literal matches', async () => {
  const editor = await harness();
  await editor.open('/home/web/demo.txt');
  await editor.type('one two one');
  editor.element('#editor-search').value = 'one';
  await editor.element('.editor-find-form').dispatch('submit');
  assert.equal(editor.element('.editor-text').selectionStart, 0);
  await editor.element('.editor-find-form').dispatch('submit');
  assert.equal(editor.element('.editor-text').selectionStart, 8);
  await editor.element('.editor-find-form').dispatch('submit');
  assert.equal(editor.element('.editor-text').selectionStart, 0);
});
