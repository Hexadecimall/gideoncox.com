import { Interrupted, Shell } from './shell.js?v=python-argv-1';
import { projectChannel } from './project-ipc.js?v=1';
import { pack } from './wasm.js?v=project-fs-1';

let shell;
let database;
let localProject = false;
let storageWarning = '';
const mutations = new Set(['write', 'append', 'mkdir', 'remove', 'rename']);

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ark-workspace', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function savedFiles(write) {
  if (!database) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('files', write ? 'readwrite' : 'readonly');
    const store = transaction.objectStore('files');
    const request = write ? store.put(write, 'snapshot') : store.get('snapshot');
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Saving files failed'));
  });
}

const modules = Promise.all(['ark-core.wasm', 'terminal.wasm?v=project-fs-1'].map(async file => {
  const response = await fetch(new URL(`../../wasm/${file}`, import.meta.url));
  if (!response.ok) throw new Error(`Could not load ${file.split('?')[0]}`);
  return WebAssembly.compile(await response.arrayBuffer());
}));

async function initialize(mount) {
  const loaded = await modules;
  localProject = Boolean(mount);
  if (mount) {
    const channel = projectChannel(mount.buffer);
    let unavailable = false;
    shell = new Shell(...loaded, ([operation, ...args]) => {
      if (unavailable) return pack(['1', 'Reopen the terminal to reconnect to project files.']);
      channel.begin();
      self.postMessage({ type: 'project-fs', operation, args });
      const response = channel.wait();
      unavailable = !response;
      return response ?? pack(['1', 'The project filesystem did not respond.']);
    });
    shell.files.mount(mount.root, mount.cwd);
    shell.env.HOME = mount.root;
    return;
  }
  shell = new Shell(...loaded);
  try {
    database = await openDatabase();
    const snapshot = await savedFiles();
    if (snapshot) shell.files.restore(snapshot);
  } catch (error) {
    database?.close(); database = null;
    storageWarning = `Files are temporary: ${error.message || 'browser storage unavailable'}`;
  }
}

async function handle(message) {
  if (message.type === 'init' && !shell) await initialize(message.mount);
  if (!shell) throw new Error('The terminal has not started.');
  // Browser locks keep another tab from saving a stale copy of the workspace.
  const transaction = async () => {
    const cwd = shell.files.request('cwd')[0];
    const snapshot = await savedFiles();
    if (snapshot) {
      shell.files.restore(snapshot);
      try { shell.files.request('chdir', cwd); } catch { shell.files.request('chdir', '/home/web'); }
    }
    shell.env.PWD = shell.files.request('cwd')[0];
    let value;
    let changed = false;
    if (message.type === 'init') value = { cwd: shell.env.PWD, warning: storageWarning };
    else if (message.type === 'run') {
      try {
        const interrupt = message.interrupt && new Int32Array(message.interrupt);
        value = shell.run(message.source, interrupt, localProject && message.browserPython);
      }
      catch (error) {
        if (error.incomplete) return { value: { incomplete: true }, changed: false };
        const interrupted = error instanceof Interrupted;
        const code = interrupted ? 130 : 1;
        shell.status = code;
        value = { out: '', err: interrupted ? '' : `${error.message}\n`, code, actions: [], cwd: shell.files.request('cwd')[0] };
      }
      changed = true;
    } else if (message.type === 'status' && localProject) {
      shell.status = message.code;
    } else if (message.type === 'files') {
      const { action, args = {} } = message;
      const parameters = action === 'rename' ? [args.from, args.to] : action === 'write' ? [args.path, args.text] : [args.path];
      const result = shell.files.request(action, ...parameters);
      if (action === 'list') {
        value = [];
        for (let i = 0; i < result.length; i += 3) value.push({ name: result[i], path: result[i + 1], directory: result[i + 2] === '1' });
      } else value = result[0];
      changed = mutations.has(action);
    } else if (message.type === 'complete') {
      const prefix = message.prefix;
      const builtins = 'help pwd cd ls mkdir touch cat cp mv rm rmdir edit echo printf grep head tail wc sort uniq seq export unset alias unalias env true false test clear source ark'.split(' ');
      value = shell.glob(prefix + '*');
      if (message.browserPython && localProject) builtins.push('python', 'python3');
      if (message.command) value = [...new Set([...builtins.filter(name => name.startsWith(prefix)), ...value])].sort();
    } else throw new Error('Unknown terminal request');
    if (changed && !localProject) {
      try { await savedFiles(shell.files.snapshot()); }
      catch (error) {
        if (message.type === 'files') throw new Error(`Could not save files: ${error.message}`);
        value.warning = `Could not save files: ${error.message}`;
      }
    }
    return { value, changed };
  };
  return !localProject && navigator.locks ? navigator.locks.request('ark-workspace-files', transaction) : transaction();
}

// Serializing requests also serializes IndexedDB transactions and editor saves.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try { const result = await handle(data); self.postMessage({ id: data.id, ...result }); }
    catch (error) { self.postMessage({ id: data.id, error: error.message || String(error) }); }
  });
};
