import { BrowserLanguageServer } from './browser-language-server.js?v=workspace-ready-1';

const configFiles = new Set(['.clangd', '.clang-format', '_clang-format', 'compile_commands.json', 'compile_flags.txt']);
const flags = [
  '--target=wasm32-wasi',
  '-isystem/usr/include/c++/v1',
  '-isystem/usr/include/wasm32-wasi/c++/v1',
  '-isystem/usr/include',
  '-isystem/usr/include/wasm32-wasi',
];

export class BrowserClangd extends BrowserLanguageServer {
  constructor(zed, makeWorker = () => new Worker('/editor/runtime/clangd/worker.js?v=21.1.0-3', { type: 'module' })) {
    super(zed, {
      command: 'clangd', makeWorker, initializeOptions: { fallbackFlags: flags },
      includePath(path) {
        const name = path.slice(path.lastIndexOf('/') + 1);
        return configFiles.has(name.toLowerCase()) || !name.includes('.')
          || /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|inl|inc|ipp|tpp|ixx|cppm|m|mm)$/i.test(name);
      },
    });
  }
}
