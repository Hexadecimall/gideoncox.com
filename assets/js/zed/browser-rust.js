import { BrowserLanguageServer } from './browser-language-server.js?v=1';

export class BrowserRust extends BrowserLanguageServer {
  constructor(zed, makeWorker = () => new Worker('/editor/runtime/rust/worker.js?v=1', { type: 'module' })) {
    super(zed, { command: 'rust-analyzer', makeWorker });
  }
}
