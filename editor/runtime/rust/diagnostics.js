const encoder = new TextEncoder();

export async function sourceDigest(source) {
  const bytes = typeof source === 'string' ? encoder.encode(source) : source;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function fileUri(path) {
  return 'file://' + path.split('/').map(encodeURIComponent).join('/');
}

export function filePath(uri) {
  const url = new URL(uri);
  return decodeURIComponent(url.pathname);
}

function diagnosticKey({ range, code, message }) {
  return JSON.stringify([range.start.line, range.start.character, range.end.line, range.end.character, code ?? message]);
}

/** Keep the compiler's results and rust-analyzer's own diagnostics independent. */
export class RustDiagnostics {
  constructor(publish, currentSource, version) {
    this.publish = publish;
    this.currentSource = currentSource;
    this.version = version;
    this.compiler = new Map();
    this.analyzer = new Map();
    this.revision = 0;
  }

  initialize() {
    this.initialized = true;
    for (const uri of this.compiler.keys()) this.send(uri);
  }

  fromAnalyzer(message) {
    const { uri: original, diagnostics } = message.params;
    const uri = fileUri(filePath(original));
    if (diagnostics.length) this.analyzer.set(uri, message.params);
    else this.analyzer.delete(uri);
    if (this.compiler.has(uri) && this.initialized) this.send(uri);
    else this.publish(message);
  }

  async replace(files) {
    const revision = ++this.revision;
    const results = await Promise.all(files.map(async ({ path, digest, items }) => {
      const uri = fileUri(path);
      const source = this.currentSource(uri);
      if (source === undefined || await sourceDigest(source) !== digest) return null;
      return [uri, { digest, items }, source];
    }));
    if (this.revision !== revision) return;
    const changed = new Set(this.compiler.keys());
    this.compiler.clear();
    for (const result of results) {
      if (!result) continue;
      const [uri, diagnostics, source] = result;
      if (source !== this.currentSource(uri)) continue;
      this.compiler.set(uri, diagnostics);
      changed.add(uri);
    }
    if (this.initialized) for (const uri of changed) this.send(uri);
  }

  invalidate(uri) {
    if (this.compiler.delete(uri) && this.initialized) this.send(uri);
  }

  async verify(uri) {
    const diagnostics = this.compiler.get(uri);
    if (!diagnostics) return;
    const source = this.currentSource(uri);
    const digest = source === undefined ? undefined : await sourceDigest(source);
    if (this.compiler.get(uri) === diagnostics && source === this.currentSource(uri)) {
      if (digest !== diagnostics.digest) this.invalidate(uri);
    }
  }

  send(uri) {
    const version = this.version(uri);
    const native = this.analyzer.get(uri);
    const analyzerItems = native && (version === undefined || native.version === undefined || native.version === version)
      ? native.diagnostics : [];
    const compilerItems = this.compiler.get(uri)?.items ?? [];
    const keys = new Set(compilerItems.map(diagnosticKey));
    this.publish({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: {
      uri, version: version ?? native?.version,
      diagnostics: [...compilerItems, ...analyzerItems.filter(item => !keys.has(diagnosticKey(item)))],
    } });
  }
}
