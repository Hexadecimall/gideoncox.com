const WORKER = '/editor/runtime/python/format-worker.js?v=2';

let formatter;
let nextRequest = 0;
const pending = new Map();

function stop(message) {
  formatter?.terminate();
  formatter = undefined;
  for (const request of pending.values()) request.reject(new Error(message));
  pending.clear();
}

export function formatPython(text, options) {
  if (!formatter) {
    formatter = new Worker(WORKER, { type: 'module' });
    formatter.onmessage = ({ data }) => {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data.text);
    };
    formatter.onerror = error => stop(error.message || 'Ruff could not start.');
    formatter.onmessageerror = () => stop('Ruff sent an invalid response.');
  }
  return new Promise((resolve, reject) => {
    const id = ++nextRequest;
    pending.set(id, { resolve, reject });
    formatter.postMessage({ id, text, options });
  });
}

export { applyDocumentChanges, documentReplacement } from './lsp-stream.js?v=document-edits-1';
