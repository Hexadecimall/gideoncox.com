import { Shell } from './shell.js';

let shell;
let database;
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

const ready = (async () => {
  const modules = await Promise.all(['ark-core', 'terminal'].map(async name => {
    const response = await fetch(new URL(`../../wasm/${name}.wasm`, import.meta.url));
    if (!response.ok) throw new Error(`Could not load ${name}`);
    return WebAssembly.compile(await response.arrayBuffer());
  }));
  shell = new Shell(...modules);
  try {
    database = await openDatabase();
    const snapshot = await savedFiles();
    if (snapshot) shell.files.restore(snapshot);
  } catch (error) {
    database?.close(); database = null;
    storageWarning = `Files are temporary: ${error.message || 'browser storage unavailable'}`;
  }
})();

async function handle(message) {
  await ready;
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
      try { value = shell.run(message.source); }
      catch (error) {
        if (error.incomplete) return { value: { incomplete: true }, changed: false };
        value = { out: '', err: `${error.message}\n`, code: 1, actions: [], cwd: shell.files.request('cwd')[0] };
      }
      changed = true;
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
      if (message.command) value = [...new Set([...builtins.filter(name => name.startsWith(prefix)), ...value])].sort();
    } else throw new Error('Unknown terminal request');
    if (changed) {
      try { await savedFiles(shell.files.snapshot()); }
      catch (error) {
        if (message.type === 'files') throw new Error(`Could not save files: ${error.message}`);
        value.warning = `Could not save files: ${error.message}`;
      }
    }
    return { value, changed };
  };
  return navigator.locks ? navigator.locks.request('ark-workspace-files', transaction) : transaction();
}

// Serializing requests also serializes IndexedDB transactions and editor saves.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try { const result = await handle(data); self.postMessage({ id: data.id, ...result }); }
    catch (error) { self.postMessage({ id: data.id, error: error.message || String(error) }); }
  });
};
