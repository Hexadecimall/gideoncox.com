import { prepareEditorIsolation } from './zed/isolation.js';
import { editorWasmResponse } from './zed/wasm-cache.js?v=3';

const loading = document.querySelector('#loading');
const build = '9a073ff882c4';
const gzip = true;

function fitVisualViewport() {
  const viewport = window.visualViewport;
  if (window.top !== window || !viewport) return;

  function resize() {
    if (viewport.scale === 1 && viewport.height > 0) {
      document.documentElement.style.setProperty('--editor-height', `${Math.round(viewport.height)}px`);
      document.documentElement.style.setProperty('--editor-top', `${Math.round(viewport.offsetTop)}px`);
    }
  }

  viewport.addEventListener('resize', resize);
  viewport.addEventListener('scroll', resize);
  resize();
}

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
    return module;
  } catch (error) {
    await saved;
    await download.discard();
    throw error;
  }
}

async function prepareRuntime(notifyDatabase) {
  const [zed, { prepareEditorServices }] = await Promise.all([
    import(`/assets/vendor/zed/pkg/zed_browser_probe.js?v=${build}`),
    import('./zed/startup-services.js?v=model-size-2'),
  ]);
  await prepareEditorServices(zed, notifyDatabase);
  return zed;
}

async function start() {
  if (await prepareEditorIsolation().catch(() => false)) return;
  fitVisualViewport();
  let databaseNotice;
  let readyZed;
  const notifyDatabase = message => {
    if (readyZed) readyZed.show_database_notice(message);
    else databaseNotice = message;
  };
  const [wasm, zed] = await Promise.all([downloadWasm(), prepareRuntime(notifyDatabase)]);
  loading.textContent = 'Starting Zed…';
  await zed.default({ module_or_path: wasm });
  const deadline = performance.now() + 30000;
  while (!zed.workspace_ready()) {
    if (performance.now() >= deadline) throw new Error('The workspace did not finish starting.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  readyZed = zed;
  loading.hidden = true;
  if (databaseNotice) zed.show_database_notice(databaseNotice);
  window.addEventListener('beforeunload', event => {
    if (zed.workspace_has_dirty_buffers() || globalThis.zedDatabase?.writing) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}
start().catch(error => { loading.textContent = `Zed could not start. ${error?.message || error}`; });
