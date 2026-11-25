import init, { PositionEncoding, Workspace } from '../../../assets/vendor/ruff/ruff_wasm.js?v=0.17.6';

let ruff;

self.addEventListener('message', async ({ data: { id, text, options } }) => {
  try {
    ruff ??= init({ module_or_path: new URL('../../../assets/vendor/ruff/ruff_wasm_bg.wasm?v=0.17.6-1', import.meta.url) });
    await ruff;
    const workspace = new Workspace(options, PositionEncoding.Utf16);
    try { postMessage({ id, text: workspace.format(text) }); }
    finally { workspace.free(); }
  } catch (error) {
    postMessage({ id, error: error.message || String(error) });
  }
});
