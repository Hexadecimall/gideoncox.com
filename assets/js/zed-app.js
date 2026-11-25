import { installFileDialogs } from './zed/dialogs.js?v=folder-memory-1';
import { installNativeTerminal } from './zed/native-terminal.js?v=run-menu-1';
import { installNativeHost } from './zed/native-host.js?v=folder-memory-1';
import { BrowserPython } from './zed/browser-python.js?v=4';

import { BrowserClangd } from './zed/browser-clangd.js?v=multi-lsp-1';
import { BrowserRust } from './zed/browser-rust.js?v=multi-lsp-1';
import { BrowserRunBridge } from './zed/browser-run.js?v=5';
import { prepareEditorIsolation } from './zed/isolation.js';
import { editorWasmResponse } from './zed/wasm-cache.js?v=1';

const loading = document.querySelector('#loading');
const build = '45325469f3e5';

async function downloadWasm() {
  const download = await editorWasmResponse(build);
  const { response } = download;
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const saved = download.save();
  try {
    let module;
    if (!response.body || typeof TransformStream !== 'function' || !WebAssembly.compileStreaming) {
      module = await WebAssembly.compile(await response.arrayBuffer());
    } else {
      let length = 0;
      const stream = response.body.pipeThrough(new TransformStream({
        transform(chunk, controller) {
          length += chunk.byteLength;
          loading.textContent = `Loading Zed · ${(length / 1048576).toFixed(1)} MB`;
          controller.enqueue(chunk);
        },
      }));
      module = await WebAssembly.compileStreaming(
        new Response(stream, { headers: { 'Content-Type': 'application/wasm' } }),
      );
    }
    loading.textContent = 'Starting Zed…';
    return module;
  } catch (error) {
    await saved;
    await download.discard();
    throw error;
  }
}
async function start() {
  if (await prepareEditorIsolation().catch(() => false)) return;
  const [zed, wasm] = await Promise.all([
    import(`/assets/vendor/zed/pkg/zed_browser_probe.js?v=${build}`),
    downloadWasm(),
  ]);
  const terminal = installNativeTerminal(new BrowserRunBridge(zed));
  const host = installNativeHost(terminal, new BrowserPython(zed), new BrowserClangd(zed), new BrowserRust(zed));
  installFileDialogs(zed, host);
  globalThis.zedInitialFolder = await host.restoreLocalFolder().catch(() => undefined);
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
