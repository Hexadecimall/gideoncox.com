import { readFile } from 'node:fs/promises';

globalThis.fetch = async url => {
  const file = new URL(url);
  file.search = '';
  return new Response(await readFile(file));
};
if (location.searchParams.get('runtime') === 'python') {
  await import('../../editor/runtime/python/worker.js');
} else {
  await import('../../editor/runtime/ark/worker.js');
}
