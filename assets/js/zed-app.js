import { installFileDialogs } from './zed/dialogs.js?v=folder-memory-1';
import { installNativeTerminal } from './zed/native-terminal.js?v=run-menu-1';
import { installNativeHost } from './zed/native-host.js?v=folder-memory-1';
import { BrowserPython } from './zed/browser-python.js?v=5';

import { BrowserClangd } from './zed/browser-clangd.js?v=format-config-1';
import { BrowserRust } from './zed/browser-rust.js?v=multi-lsp-1';
import { BrowserRunBridge } from './zed/browser-run.js?v=6';
import { openBrowserDatabase } from './zed/browser-database.js?v=history-1';
import { prepareEditorIsolation } from './zed/isolation.js';
import { editorWasmResponse } from './zed/wasm-cache.js?v=3';

const loading = document.querySelector('#loading');
const build = 'fdb823b58982';
const gzip = true;

async function downloadWasm() {
  const download = await editorWasmResponse(build, { gzip });
  const { response } = download;
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const saved = download.save();
  try {
    let length = 0;
    const body = download.body(bytes => {
      length += bytes;
      loading.textContent = `Loading Zed · ${(length / 1048576).toFixed(1)} MB`;
    });
    let module;
    if (!body || !WebAssembly.compileStreaming) {
      module = await WebAssembly.compile(await new Response(body).arrayBuffer());
    } else {
      module = await WebAssembly.compileStreaming(
        new Response(body, { headers: { 'Content-Type': 'application/wasm' } }),
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
  let databaseNotice;
  let workspaceReady = false;
  const notifyDatabase = message => {
    if (workspaceReady) zed.show_database_notice(message);
    else databaseNotice = message;
  };
  try {
    globalThis.zedDatabase = await openBrowserDatabase(notifyDatabase);
  } catch (error) {
    console.warn('Could not open Zed database storage.', error);
    notifyDatabase('Zed could not open browser storage for its history.');
  }
  const terminal = installNativeTerminal(new BrowserRunBridge(zed));
  const host = installNativeHost(terminal, new BrowserPython(zed), new BrowserClangd(zed), new BrowserRust(zed));
  installFileDialogs(zed, host);
  globalThis.zedInitialFolder = await host.restoreLocalFolder().catch(() => undefined);
  const { BrowserLma } = await import('/editor/runtime/lma/client.js?v=wasm-simd-1');
  globalThis.zedLma = new BrowserLma(zed.lma_worker_event);
  await zed.default({ module_or_path: wasm });
  const deadline = performance.now() + 30000;
  while (!zed.workspace_ready()) {
    if (performance.now() >= deadline) throw new Error('The workspace did not finish starting.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  workspaceReady = true;
  loading.hidden = true;
  if (databaseNotice) notifyDatabase(databaseNotice);
  window.addEventListener('beforeunload', event => {
    if (zed.workspace_has_dirty_buffers() || globalThis.zedDatabase?.writing) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}
start().catch(error => { loading.textContent = `Zed could not start. ${error?.message || error}`; });
