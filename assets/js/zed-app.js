import { installFileDialogs } from './zed/dialogs.js?v=workspace-controls-1';
import { installNativeTerminal } from './zed/native-terminal.js?v=project-fs-1';
import { installNativeHost } from './zed/native-host.js?v=folder-memory-1';
import { BrowserPython } from './zed/browser-python.js?v=workspace-ready-1';

import { BrowserClangd } from './zed/browser-clangd.js?v=clangd-startup-1';
import { BrowserRust } from './zed/browser-rust.js?v=quickfix-1';
import { BrowserRunBridge } from './zed/browser-run.js?v=warm-builds-1';
import { BrowserGit } from './zed/browser-git.js?v=git-worktree-1';
import { openBrowserDatabase } from './zed/browser-database.js?v=history-1';
import { prepareEditorIsolation } from './zed/isolation.js';
import { editorWasmResponse } from './zed/wasm-cache.js?v=3';

const loading = document.querySelector('#loading');
const build = '68be4ef8672a';
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
  const [zed, wasm, lma] = await Promise.all([
    import(`/assets/vendor/zed/pkg/zed_browser_probe.js?v=${build}`),
    downloadWasm(),
    import('/editor/runtime/lma/client.js?v=library-1').catch(error => {
      console.warn('LMA provider could not load.', error);
      return undefined;
    }),
  ]);
  if (lma && typeof zed.lma_worker_event === 'function') {
    globalThis.zedLma = new lma.BrowserLma(zed.lma_worker_event);
  }
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
  const rust = new BrowserRust(zed, undefined, (root, path) => builds.scheduleRustCheck(root, path));
  const builds = new BrowserRunBridge(zed, undefined, (root, result) => rust.publishCargo(root, result));
  globalThis.zedBrowserGit = new BrowserGit();
  const terminal = installNativeTerminal(builds, zed);
  const host = installNativeHost(terminal, new BrowserPython(zed), new BrowserClangd(zed), rust);
  installFileDialogs(zed, host);
  globalThis.zedInitialFolder = await host.restoreLocalFolder().catch(() => undefined);
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
