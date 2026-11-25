import { BrowserLanguageServer } from './browser-language-server.js?v=2';

export class BrowserRust extends BrowserLanguageServer {
  constructor(zed, makeWorker = () => new Worker('/editor/runtime/rust/worker.js?v=2', { type: 'module' })) {
    super(zed, {
      command: 'rust-analyzer', makeWorker,
      includePath: path => /\.(?:rs|toml|json|md|txt)$/.test(path),
    });
  }
}
