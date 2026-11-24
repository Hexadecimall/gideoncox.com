import { installFileDialogs } from './zed/dialogs.js?v=f7007990361a';
import { installNativeTerminal } from './zed/native-terminal.js?v=f7007990361a';
import { installNativeHost } from './zed/native-host.js?v=f7007990361a';

const loading = document.querySelector('#loading');
const build = 'f7007990361a';

async function downloadWasm() {
  const response = await fetch(`/assets/vendor/zed/pkg/zed_browser_probe_bg.wasm?v=${build}`);
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
  const [zed, wasm] = await Promise.all([
    import(`/assets/vendor/zed/pkg/zed_browser_probe.js?v=${build}`),
    downloadWasm(),
  ]);
  const host = installNativeHost(installNativeTerminal());
  installFileDialogs(zed, host);
  await zed.default({ module_or_path: wasm });
  const deadline = performance.now() + 30000;
  while (!zed.workspace_ready()) {
    if (performance.now() >= deadline) throw new Error('The workspace did not finish starting.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  loading.hidden = true;
  window.addEventListener('beforeunload', event => {
    if (zed.workspace_has_dirty_buffers()) { event.preventDefault(); event.returnValue = ''; }
  });
}
start().catch(error => { loading.textContent = `Zed could not start. ${error?.message || error}`; });
