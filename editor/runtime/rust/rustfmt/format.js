import { ConsoleStdout, File, OpenFile, PreopenDirectory, WASI } from '../wasi/index.js';
import { parse as parseToml } from '../toml/index.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const formatterUrl = new URL('./rust_fmt.wasm.gz?v=0.5.0', import.meta.url);
const editions = new Set(['2015', '2018', '2021', '2024']);

async function loadRustfmt() {
  const response = await fetch(formatterUrl);
  if (!response.ok || !response.body) throw new Error('Could not download rustfmt.');
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  return WebAssembly.compileStreaming(new Response(stream, {
    headers: { 'Content-Type': 'application/wasm' },
  }));
}

export function createRustfmt(load = loadRustfmt) {
  let compiled;
  let reactor;
  return async function format(text, config) {
    compiled ??= Promise.resolve().then(load).catch(error => { compiled = undefined; throw error; });
    const module = await compiled;
    if (!reactor) {
      const files = new Map();
      const diagnostics = [];
      const wasi = new WASI(['rust_fmt'], [], [
        new OpenFile(new File([])),
        new OpenFile(new File([])),
        new ConsoleStdout(bytes => diagnostics.push(decoder.decode(bytes))),
        new PreopenDirectory('/work', files),
      ], { debug: false });
      const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasi.wasiImport });
      wasi.initialize(instance);
      reactor = { files, diagnostics, run: instance.exports.run };
    }
    const { files, diagnostics, run } = reactor;
    try {
      files.set('input.rs', new File(encoder.encode(text)));
      files.set('config', new File(encoder.encode(config)));
      let status;
      try {
        status = run();
      } catch (error) {
        reactor = undefined;
        throw new Error(`rustfmt stopped: ${error.message}`);
      }
      if (status) throw new Error(diagnostics.join('').trim() || `rustfmt exited with status ${status}.`);
      const output = files.get('output.rs');
      if (!output) throw new Error('rustfmt returned no formatted output.');
      return decoder.decode(output.data);
    } finally {
      files.clear();
      diagnostics.length = 0;
    }
  };
}

function projectDirectories(root, path) {
  const directories = [];
  if (!path.startsWith(root + '/') || path.slice(root.length + 1).split('/').some(
    part => !part || part === '.' || part === '..',
  )) return directories;
  for (let directory = path.slice(0, path.lastIndexOf('/')); ; directory = directory.slice(0, directory.lastIndexOf('/'))) {
    directories.push(directory);
    if (directory === root) return directories;
  }
}

export function rustfmtConfig(files, root, path, options = {}) {
  const directories = projectDirectories(root, path);
  const defaults = new Map();
  if (Number.isInteger(options.tabSize) && options.tabSize >= 1 && options.tabSize <= 32) {
    defaults.set('tab_spaces', String(options.tabSize));
  }
  if (typeof options.insertSpaces === 'boolean') defaults.set('hard_tabs', String(!options.insertSpaces));

  let edition;
  for (const directory of directories) {
    const bytes = files.get(`${directory}/Cargo.toml`);
    if (!bytes) continue;
    try {
      const manifest = parseToml(decoder.decode(bytes));
      if (edition?.workspace) {
        if (manifest.workspace) { edition = manifest.workspace.package?.edition ?? '2015'; break; }
      } else if (manifest.package) {
        edition = manifest.package.edition ?? '2015';
        if (!edition?.workspace) break;
        if (manifest.workspace) { edition = manifest.workspace.package?.edition ?? '2015'; break; }
      }
    } catch { /* An incomplete manifest can be formatted using the standalone edition. */ }
  }
  defaults.set('edition', editions.has(edition) ? edition : '2024');

  for (const directory of directories) {
    const config = files.get(`${directory}/.rustfmt.toml`) ?? files.get(`${directory}/rustfmt.toml`);
    if (!config) continue;
    const parsed = parseToml(decoder.decode(config));
    for (const [key, value] of Object.entries(parsed)) {
      const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
      if (!/^[a-z_]+$/.test(key) || /[\r\n]/.test(serialized)) {
        throw new Error(`Invalid rustfmt option: ${JSON.stringify(key)}`);
      }
      defaults.set(key, serialized);
    }
    break;
  }
  return Array.from(defaults, ([key, value]) => `${key}=${value}`).join('\n');
}
