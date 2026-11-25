import { BrowserLanguageServer } from './browser-language-server.js?v=2';

const flags = [
  '--target=wasm32-wasi',
  '-isystem/usr/include/c++/v1',
  '-isystem/usr/include/wasm32-wasi/c++/v1',
  '-isystem/usr/include',
  '-isystem/usr/include/wasm32-wasi',
];

export class BrowserClangd extends BrowserLanguageServer {
  constructor(zed, makeWorker = () => new Worker('/editor/runtime/clangd/worker.js?v=21.1.0-2', { type: 'module' })) {
    super(zed, {
      command: 'clangd', makeWorker, initializeOptions: { fallbackFlags: flags },
      includePath(path) {
        const name = path.slice(path.lastIndexOf('/') + 1);
        return !name.includes('.') || /(?:\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|inl|inc|ipp|tpp|ixx|cppm|m|mm)$|^\.clangd$|^compile_commands\.json$|^compile_flags\.txt$)/i.test(name);
      },
    });
  }
}
