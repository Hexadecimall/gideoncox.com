import { BrowserLanguageServer } from './browser-language-server.js?v=format-config-1';

export class BrowserRust extends BrowserLanguageServer {
  constructor(zed, makeWorker = () => new Worker('/editor/runtime/rust/worker.js?v=rustfmt-1', { type: 'module' })) {
    super(zed, {
      command: 'rust-analyzer', makeWorker,
      includePath: path => /\.(?:rs|toml|json|md|txt)$/.test(path),
      formatConfigFiles: ['.rustfmt.toml', 'rustfmt.toml', 'Cargo.toml'],
    });
  }
}
