import { installFileDialogs } from './zed/dialogs.js?v=cf8d2baff46f';
import { installNativeTerminal } from './zed/native-terminal.js?v=cf8d2baff46f';
import { installNativeHost } from './zed/native-host.js?v=cf8d2baff46f';
import { BrowserPython } from './zed/browser-python.js?v=cf8d2baff46f';

const loading = document.querySelector('#loading');
const build = 'cf8d2baff46f';

async function downloadWasm() {
  const response = await fetch(`/assets/vendor/zed/pkg/zed_browser_probe_bg.wasm?v=${build}`);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  if (!response.body || typeof TransformStream !== 'function' || !WebAssembly.compileStreaming) {
    return response.arrayBuffer();
  }
  // Compile while bytes arrive and avoid a second copy of the full editor.
  let length = 0;
  const stream = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      length += chunk.byteLength;
      loading.textContent = `Loading Zed · ${(length / 1048576).toFixed(1)} MB`;
      controller.enqueue(chunk);
    },
  }));
  const module = await WebAssembly.compileStreaming(
    new Response(stream, { headers: { 'Content-Type': 'application/wasm' } }),
  );
  loading.textContent = 'Starting Zed…';
  return module;
}
async function start() {
  const [zed, wasm] = await Promise.all([
    import(`/assets/vendor/zed/pkg/zed_browser_probe.js?v=${build}`),
    downloadWasm(),
  ]);
  const host = installNativeHost(installNativeTerminal(), new BrowserPython(zed));
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
