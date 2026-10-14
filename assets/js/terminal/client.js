const pending = new Map();
let worker;
let sequence = 0;
let stopped = false;

export function request(type, args = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, ...args });
  });
}
function start() {
  stopped = false;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const task = pending.get(data.id);
    if (!task) return;
    pending.delete(data.id);
    if (data.changed) window.dispatchEvent(new Event('site-files-changed'));
    if (data.error) task.reject(new Error(data.error));
    else task.resolve(data.value);
  };
  worker.onerror = () => {
    for (const task of pending.values()) task.reject(new Error('Terminal could not load. Use the HTTP preview and reload to retry.'));
    pending.clear();
  };
  return request('init');
}
export function interrupt() {
  if (stopped) return window.siteFilesReady;
  stopped = true;
  worker.terminate();
  for (const task of pending.values()) task.reject(new Error('Interrupted'));
  pending.clear();
  window.siteFilesReady = start();
  return window.siteFilesReady;
}
window.siteFiles = { request: (action, args) => request('files', { action, args }) };
window.siteFilesReady = start();
// The UI reports initialization failures; avoid an unhandled rejection before
// the editor's module has attached its own error handler.
window.siteFilesReady.catch(() => {});
