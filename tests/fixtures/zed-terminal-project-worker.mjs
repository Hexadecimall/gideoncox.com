import { readFile } from 'node:fs/promises';

globalThis.fetch = async url => {
  const file = new URL(url);
  file.search = '';
  return new Response(await readFile(file));
};
await import('../../editor/runtime/ark/worker.js');
