import { isBrowserProject } from './paths.js?v=local-folders-1';
import { isLanguageProject, projectFiles, readProjectFile } from './browser-language-server.js?v=workspace-ready-1';
import { joinBytes, LspFrames, lspFrame } from './lsp-stream.js';
import { applyDocumentChanges, documentReplacement, formatPython } from './python-format.js?v=2';

const VENDOR = new URL('../../vendor/pyright/', import.meta.url);
const VERSION = '1.1.299';
const WORKER = `/editor/runtime/python/pyright-worker.js?v=${VERSION}-1`;
const COMMAND = 'zed-browser-pyright';
const MAX_FILE = 2 * 1024 * 1024;
const MAX_OUTPUT = 24 * 1024 * 1024;
const MAX_SESSIONS = 4;
const textDecoder = new TextDecoder();

let stdlib;
function loadTypeshed() {
  if (!stdlib) {
    stdlib = fetch(new URL(`typeshed-stdlib.json?v=${VERSION}`, VENDOR)).then(response => {
      if (!response.ok) throw new Error('Could not load the Python standard library stubs.');
      return response.json();
    }).catch(error => { stdlib = undefined; throw error; });
  }
  return stdlib;
}

export { isBrowserProject };

function isPythonInput(path) {
  return isLanguageProject(path) && /(?:\.py[wi]?|\/pyrightconfig\.json|\/pyproject\.toml)$/.test(path)
    && !path.split('/').some(part => part === '.git' || part === '.venv' || part === '__pycache__');
}

function filePath(uri) {
  try {
    const url = new URL(uri);
    if (url.protocol === 'file:' && !url.host) {
      const path = decodeURIComponent(url.pathname);
      return isPythonInput(path) ? path : null;
    }
  } catch { /* Ignore non-project URIs. */ }
  return null;
}

class PyrightProcess {
  constructor(zed, worker, typeshed, root, format) {
    this.zed = zed;
    this.worker = worker;
    this.typeshed = typeshed;
    this.root = root;
    this.format = format;
    this.documents = new Map();
    this.input = new LspFrames();
    this.output = [];
    this.outputLength = 0;
    this.error = new Uint8Array();
    this.exitCode = null;
    this.reader = null;
    worker.addEventListener('message', ({ data }) => {
      if (this.exitCode !== null || data?.jsonrpc !== '2.0') return;
      try {
        if (data.method === 'workspace/configuration') {
          // Pyright sends an empty scope URI for the default workspace.
          // Zed requires an absolute URI on configuration requests.
          for (const item of data.params.items) {
            try { new URL(item.scopeUri); }
            catch { item.scopeUri = this.rootUri; }
          }
        }
        if (data.id === this.initializeId && data.result?.capabilities) {
          data.result.capabilities.documentFormattingProvider = true;
        }
        this.receive(data);
      } catch (error) { this.close(1, error.message); }
    });
    worker.addEventListener('error', event => {
      event.preventDefault();
      this.close(1, event.message || 'Python language server failed to start.');
    });
    worker.addEventListener('messageerror', () => this.close(1, 'Python worker sent an invalid message.'));
    worker.postMessage({ type: 'browser/boot', mode: 'foreground' });
  }

  receive(message) {
    if (this.exitCode !== null) return;
    const frame = lspFrame(message);
    if (frame.byteLength + this.outputLength > MAX_OUTPUT) {
      throw new Error('Python language server output exceeded its buffer limit.');
    }
    this.output.push(frame);
    this.outputLength += frame.byteLength;
    this.reader?.();
  }

  async formatDocument(id, { textDocument: { uri }, options }) {
    const text = this.documents.get(uri);
    const send = response => this.receive({ jsonrpc: '2.0', id, ...response });
    if (text === undefined) { send({ result: null }); return; }
    try {
      const settings = { format: { 'indent-style': options?.insertSpaces === false ? 'tab' : 'space' } };
      if (Number.isInteger(options?.tabSize) && options.tabSize > 0 && options.tabSize <= 32) {
        settings['indent-width'] = options.tabSize;
      }
      const formatted = await this.format(text, settings);
      if (this.documents.get(uri) !== text) {
        send({ error: { code: -32801, message: 'The document changed during formatting.' } });
      } else send({ result: documentReplacement(text, formatted) });
    } catch (error) {
      send({ error: { code: -32603, message: error.message } });
    }
  }

  read() {
    if (!this.outputLength && this.exitCode === null) {
      return new Promise(resolve => {
        this.reader = () => { this.reader = null; resolve(this.takeOutput()); };
      });
    }
    return Promise.resolve(this.takeOutput());
  }

  takeOutput() {
    const stdout = joinBytes(this.output);
    const stderr = this.error;
    this.output = [];
    this.outputLength = 0;
    this.error = new Uint8Array();
    return { stdout, stderr, ended: this.exitCode !== null, exitCode: this.exitCode, signal: null };
  }

  send(message) {
    if (this.exitCode === null) this.worker.postMessage(message);
  }

  updateFile(uri, text) {
    this.send({ jsonrpc: '2.0', method: 'pyright/createFile', params: { uri, text } });
  }

  async updateSavedFile(uri, text) {
    const path = filePath(uri);
    if (!path || !path.startsWith(this.root + '/')) return;
    if (typeof text !== 'string') {
      try {
        const bytes = await readProjectFile(this.zed, path);
        if (bytes.byteLength > MAX_FILE) return;
        text = textDecoder.decode(bytes);
      } catch { return; }
    }
    this.updateFile(uri, text);
  }

  async write(bytes) {
    if (this.exitCode !== null) throw new Error('Python language server stopped.');
    for (const message of this.input.push(bytes)) {
      const { method, params } = message;
      if (method === 'initialize') {
        this.initializeId = message.id;
        const [stubs, bytes] = await Promise.all([
          this.typeshed(), projectFiles(this.zed, this.root, isPythonInput, () => this.exitCode === null),
        ]);
        const files = Object.fromEntries(bytes.map(([path, source]) => [path, textDecoder.decode(source)]));
        this.rootUri = params.rootUri;
        // Each worker owns one virtual project. The pinned worker waits
        // indefinitely for named workspace folders to finish initialization.
        message.params = {
          ...params,
          workspaceFolders: null,
          capabilities: {
            ...params?.capabilities,
            workspace: { ...params?.capabilities?.workspace, workspaceFolders: false },
          },
          initializationOptions: { ...params?.initializationOptions, files: { ...stubs, ...files } },
        };
      } else if (method === 'workspace/didChangeWorkspaceFolders') {
        continue;
      } else if (method === 'textDocument/didOpen' && filePath(params?.textDocument?.uri)) {
        this.documents.set(params.textDocument.uri, params.textDocument.text);
        this.updateFile(params.textDocument.uri, params.textDocument.text);
      } else if (method === 'textDocument/didChange') {
        const uri = params.textDocument.uri;
        if (this.documents.has(uri)) {
          this.documents.set(uri, applyDocumentChanges(this.documents.get(uri), params.contentChanges));
        }
      } else if (method === 'textDocument/didClose') {
        this.documents.delete(params.textDocument.uri);
      } else if (method === 'textDocument/formatting') {
        this.formatDocument(message.id, params).catch(error => this.close(1, error.message));
        continue;
      } else if (method === 'textDocument/didSave') {
        await this.updateSavedFile(params?.textDocument?.uri, params?.text);
      } else if (method === 'workspace/didChangeWatchedFiles') {
        for (const { uri, type } of params?.changes ?? []) {
          if (!filePath(uri)) continue;
          if (type === 3) this.send({ jsonrpc: '2.0', method: 'pyright/deleteFile', params: { uri } });
          else await this.updateSavedFile(uri);
        }
      } else if (method === 'exit') {
        this.close();
        return;
      }
      this.send(message);
    }
  }

  close(code = 0, message = '') {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.error = new TextEncoder().encode(message);
    this.worker.terminate();
    this.reader?.();
  }
}

export class BrowserPython {
  constructor(zed, makeWorker = () => new Worker(WORKER), typeshed = loadTypeshed, format = formatPython) {
    this.zed = zed;
    this.makeWorker = makeWorker;
    this.typeshed = typeshed;
    this.format = format;
    this.running = new Map();
  }

  owns(id) { return typeof id === 'string' && id.startsWith('browser-python:'); }
  accepts(options) {
    return (options.command === COMMAND && isBrowserProject(options.cwd))
      || (options.command === 'pyright-langserver' && Boolean(globalThis.zedLocalFolders?.rootFor(options.cwd)));
  }

  async processOpen(options) {
    if (!this.accepts(options)) throw new Error('The Python worker opens browser files only.');
    if (this.running.size >= MAX_SESSIONS) throw new Error('Too many Python projects are open.');
    const id = 'browser-python:' + crypto.randomUUID();
    this.running.set(id, new PyrightProcess(this.zed, this.makeWorker(), this.typeshed, options.cwd, this.format));
    return { id, pid: 0 };
  }

  async processRead(id) {
    const process = this.get(id);
    const result = await process.read();
    if (result.ended) this.running.delete(id);
    return result;
  }

  get(id) {
    const process = this.running.get(id);
    if (!process) throw new Error('Python language server stopped.');
    return process;
  }

  async processWrite(id, bytes) {
    const process = this.get(id);
    try { await process.write(bytes); }
    catch (error) { process.close(1, error.message); throw error; }
  }

  async processEndInput(id) { this.running.get(id)?.close(); }
  async processKill(id) { this.running.get(id)?.close(1); }
  async processClose(id) {
    this.running.get(id)?.close();
    this.running.delete(id);
  }

  close() {
    for (const process of this.running.values()) process.close();
    this.running.clear();
  }
}
