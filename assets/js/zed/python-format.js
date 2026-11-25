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

function offset(text, { line, character }) {
  let index = 0;
  for (let count = 0; count < line; count++) {
    const lineEnd = text.indexOf('\n', index);
    if (lineEnd === -1) return text.length;
    index = lineEnd + 1;
  }
  const nextLine = text.indexOf('\n', index);
  return Math.min(index + character, nextLine < 0 ? text.length : nextLine);
}

export function applyDocumentChanges(text, changes) {
  for (const { range, text: replacement } of changes) {
    text = range ? text.slice(0, offset(text, range.start)) + replacement
      + text.slice(offset(text, range.end)) : replacement;
  }
  return text;
}

export function documentReplacement(text, formatted) {
  if (text === formatted) return [];
  const lines = text.split('\n');
  const end = { line: lines.length - 1, character: lines.at(-1).length };
  return [{ range: { start: { line: 0, character: 0 }, end }, newText: formatted }];
}
