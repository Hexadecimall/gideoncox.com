import { BrowserLanguageServer } from './browser-language-server.js?v=shared-module-1';

const configFiles = new Set(['.clangd', '.clang-format', '_clang-format', 'compile_commands.json', 'compile_flags.txt']);
const flags = [
  '--target=wasm32-wasi',
  '-isystem/usr/include/c++/v1',
  '-isystem/usr/include/wasm32-wasi/c++/v1',
  '-isystem/usr/include',
  '-isystem/usr/include/wasm32-wasi',
];

async function compileClangd() {
  const response = await fetch('/editor/runtime/clangd/clangd.wasm.gz?v=21.1.0-2');
  if (!response.ok || !response.body) throw new Error('Could not download clangd.');
  return WebAssembly.compileStreaming(new Response(
    response.body.pipeThrough(new DecompressionStream('gzip')),
    { headers: { 'Content-Type': 'application/wasm' } },
  ));
}

export class BrowserClangd extends BrowserLanguageServer {
  constructor(
    zed,
    makeWorker = () => new Worker('/editor/runtime/clangd/worker.js?v=21.1.0-4', { type: 'module' }),
    compile = compileClangd,
  ) {
    let compiled;
    super(zed, {
      command: 'clangd', makeWorker, initializeOptions: { fallbackFlags: flags },
      async prepareRuntime() {
        // Reuse compiled code, while each project owns its memory and filesystem.
        compiled ??= compile().catch(error => {
          compiled = undefined;
          throw error;
        });
        return { module: await compiled };
      },
      includePath(path) {
        const name = path.slice(path.lastIndexOf('/') + 1);
        return configFiles.has(name.toLowerCase()) || !name.includes('.')
          || /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|inl|inc|ipp|tpp|ixx|cppm|m|mm)$/i.test(name);
      },
    });
  }
}
