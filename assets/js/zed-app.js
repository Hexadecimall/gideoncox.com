const filename = document.querySelector('#filename');
const files = document.querySelector('#files');
const status = document.querySelector('#status');
const loading = document.querySelector('#loading');
const root = '/home/web/';
let zed;
let savedText = '';
let currentPath = '';
let knownFiles = new Set();
let statusTimer;

function report(message) {
  clearTimeout(statusTimer);
  status.textContent = message;
  statusTimer = setTimeout(() => { status.textContent = ''; }, 3500);
}
const safely = callback => async event => {
  try { await callback(event); }
  catch (error) { report(error?.message || String(error)); }
};
function ask(message, action) {
  const dialog = document.querySelector('#file-confirm');
  if (dialog.open) return Promise.resolve(false);
  document.querySelector('#confirm-message').textContent = message;
  document.querySelector('#confirm-action').textContent = action;
  dialog.returnValue = 'cancel';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
  });
}
const discard = async () => zed.editor_text() === savedText || await ask('Discard unsaved changes?', 'Discard');
function filePath() {
  const name = filename.value.trim();
  if (!name || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Enter a file name or a relative folder/file path.');
  }
  return root + name;
}
async function refreshFiles() {
  knownFiles = new Set(JSON.parse(await zed.list_files()));
  files.replaceChildren(new Option('files', ''));
  for (const path of [...knownFiles].sort()) files.append(new Option(path.slice(root.length), path));
  files.value = currentPath;
}
async function save() {
  const path = filePath();
  if (knownFiles.has(path) && path !== currentPath && !await ask(`Replace ${filename.value}?`, 'Replace')) return;
  await zed.save_file(path);
  savedText = zed.editor_text();
  currentPath = path;
  await refreshFiles();
  report('Saved');
}
async function newFile() {
  if (!await discard()) return;
  zed.set_editor_text('');
  savedText = ''; currentPath = ''; filename.value = 'untitled.txt'; files.value = '';
  zed.set_file_path(root + filename.value);
}
async function downloadWasm() {
  const response = await fetch('/assets/vendor/zed/pkg/zed_browser_probe_bg.wasm');
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  if (!response.body) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.byteLength;
    loading.textContent = `Loading Zed · ${(length / 1048576).toFixed(1)} MB`;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  loading.textContent = 'Starting Zed…';
  return bytes;
}
async function start() {
  const [module, wasm] = await Promise.all([
    import('/assets/vendor/zed/pkg/zed_browser_probe.js'),
    downloadWasm(),
  ]);
  zed = module;
  await zed.default({ module_or_path: wasm });
  const deadline = performance.now() + 20000;
  for (;;) {
    try { zed.editor_text(); break; }
    catch (error) {
      const message = error?.message || String(error);
      if (!/^Editor (?:window )?is not ready$/.test(message)) throw error;
      if (performance.now() >= deadline) throw new Error('The editor did not finish starting.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  await refreshFiles();
  loading.hidden = true;
  document.querySelectorAll('button, input, select').forEach(control => { control.disabled = false; });
  document.querySelector('#save').addEventListener('click', safely(save));
  document.querySelector('#new').addEventListener('click', safely(newFile));
  filename.addEventListener('input', safely(() => zed.set_file_path(root + filename.value)));
  files.addEventListener('change', safely(async () => {
    const path = files.value;
    if (!path) return;
    if (!await discard()) { files.value = currentPath; return; }
    await zed.open_file(path);
    currentPath = path; filename.value = path.slice(root.length); savedText = zed.editor_text();
  }));
  document.querySelector('#font-size').addEventListener('input', safely(event => {
    const size = Number(event.target.value);
    if (!Number.isInteger(size) || size < 10 || size > 32) return;
    zed.set_font_size(size);
    localStorage.setItem('zed.browser.font-size', String(size));
  }));
  const fontSize = Number(localStorage.getItem('zed.browser.font-size'));
  if (fontSize >= 10 && fontSize <= 32) {
    document.querySelector('#font-size').value = fontSize;
    zed.set_font_size(fontSize);
  }
  document.querySelector('#import-button').addEventListener('click', () => document.querySelector('#import').click());
  document.querySelector('#import').addEventListener('change', safely(async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file || !await discard()) return;
    zed.set_editor_text(await file.text());
    filename.value = file.name; currentPath = ''; files.value = ''; savedText = '';
    zed.set_file_path(root + file.name);
  }));
  document.querySelector('#export').addEventListener('click', safely(() => {
    const url = URL.createObjectURL(new Blob([zed.editor_text()], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = filename.value.split('/').pop() || 'untitled.txt'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
  window.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (!['s', 'n', 'o'].includes(key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (key === 'n') safely(newFile)();
    else if (key === 'o') document.querySelector('#import').click();
    else if (event.shiftKey) { filename.focus(); filename.select(); }
    else safely(save)();
  }, true);
  window.addEventListener('beforeunload', event => {
    if (zed.editor_text() !== savedText) { event.preventDefault(); event.returnValue = ''; }
  });
}
start().catch(error => { loading.textContent = `Zed could not start. ${error?.message || error}`; });
