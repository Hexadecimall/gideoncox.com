import { isBrowserProject } from './browser-python.js?v=cf8d2baff46f';
import { joinBytes, LspFrames, lspFrame } from './lsp-stream.js';

const PREFIX = 'browser-clangd:';
const MAX_FILE = 2 * 1024 * 1024;
const MAX_PROJECT = 16 * 1024 * 1024;
const MAX_OUTPUT = 24 * 1024 * 1024;
const MAX_PROJECT_FILES = 4000;
const encoder = new TextEncoder();
const flags = [
  '--target=wasm32-wasi',
  '-isystem/usr/include/c++/v1',
  '-isystem/usr/include/wasm32-wasi/c++/v1',
  '-isystem/usr/include',
  '-isystem/usr/include/wasm32-wasi',
];

function projectPath(path, root) {
  return isBrowserProject(path) && path.startsWith(root + '/') && !path.includes('\0')
    && !path.split('/').includes('.git') && !path.startsWith('/home/web/.config/');
}

function pathFromUri(uri, root) {
  try {
    const url = new URL(uri);
    if (url.protocol === 'file:' && !url.host) {
      const path = decodeURIComponent(url.pathname);
      if (projectPath(path, root)) return path;
    }
  } catch { /* Ignore paths outside the virtual project. */ }
  return null;
}

async function projectFiles(zed, root) {
  const entries = JSON.parse(await zed.list_browser_paths());
  const files = [];
  let total = 0;
  for (const { path, isDirectory } of entries) {
    if (isDirectory || !projectPath(path, root)) continue;
    let bytes;
    try { bytes = await zed.read_browser_file(path); }
    catch { continue; }
    if (bytes.byteLength > MAX_FILE || total + bytes.byteLength > MAX_PROJECT) continue;
    files.push([path, bytes]);
    total += bytes.byteLength;
    if (files.length >= MAX_PROJECT_FILES) break;
  }
  return files;
}

class ClangdProcess {
  constructor(zed, root, worker) {
    this.zed = zed;
    this.root = root;
    this.worker = worker;
    this.input = new LspFrames();
    this.output = [];
    this.outputLength = 0;
    this.error = new Uint8Array();
    this.exitCode = null;
    this.ready = new Promise(resolve => { this.finishStarting = resolve; });
    this.startTimer = setTimeout(() => this.close(1, 'clangd timed out while starting.'), 90000);
    this.writeQueue = Promise.resolve();
    worker.addEventListener('message', ({ data }) => {
      if (this.exitCode !== null) return;
      try {
        if (data.type === 'ready') {
          clearTimeout(this.startTimer);
          this.finishStarting(true);
        } else if (data.type === 'failed') {
          this.close(1, data.message);
        } else if (data.type === 'lsp') {
          const frame = lspFrame(data.message);
          this.outputLength += frame.byteLength;
          if (this.outputLength > MAX_OUTPUT) throw new Error('clangd output exceeded its buffer limit.');
          this.output.push(frame);
          this.reader?.();
        }
      } catch (error) { this.close(1, error.message); }
    });
    worker.addEventListener('error', event => {
      event.preventDefault();
      this.close(1, event.message || 'clangd worker failed.');
    });
    worker.addEventListener('messageerror', () => this.close(1, 'clangd sent an invalid message.'));
  }

  async start() {
    const files = await projectFiles(this.zed, this.root);
    if (this.exitCode === null) this.worker.postMessage({ type: 'start', root: this.root, files });
  }

  read() {
    if (this.outputLength || this.exitCode !== null) return Promise.resolve(this.takeOutput());
    return new Promise(resolve => {
      this.reader = () => { this.reader = null; resolve(this.takeOutput()); };
    });
  }

  takeOutput() {
    const stdout = joinBytes(this.output);
    const stderr = this.error;
    this.output = [];
    this.outputLength = 0;
    this.error = new Uint8Array();
    return { stdout, stderr, ended: this.exitCode !== null, exitCode: this.exitCode, signal: null };
  }

  async syncFile(uri, text, removed = false) {
    const path = pathFromUri(uri, this.root);
    if (!path) return;
    let bytes = null;
    if (!removed) {
      try { bytes = typeof text === 'string' ? encoder.encode(text) : await this.zed.read_browser_file(path); }
      catch { return; }
      if (bytes.byteLength > MAX_FILE) return;
    }
    if (this.exitCode === null) this.worker.postMessage({ type: 'file', path, bytes });
  }

  write(bytes) {
    const data = new Uint8Array(bytes).slice();
    this.writeQueue = this.writeQueue.then(async () => {
      if (!await this.ready || this.exitCode !== null) throw new Error('clangd stopped.');
      for (const message of this.input.push(data)) {
        const { method, params } = message;
        if (method === 'initialize') {
          message.params = {
            ...params,
            initializationOptions: {
              fallbackFlags: flags,
              ...params?.initializationOptions,
            },
          };
        } else if (method === 'textDocument/didOpen') {
          await this.syncFile(params?.textDocument?.uri, params?.textDocument?.text);
        } else if (method === 'textDocument/didSave') {
          await this.syncFile(params?.textDocument?.uri, params?.text);
        } else if (method === 'workspace/didChangeWatchedFiles') {
          for (const { uri, type } of params?.changes ?? []) await this.syncFile(uri, undefined, type === 3);
        } else if (method === 'exit') {
          this.close();
          return;
        }
        if (this.exitCode === null) this.worker.postMessage({ type: 'lsp', message });
      }
    });
    return this.writeQueue.catch(error => { this.close(1, error.message); throw error; });
  }

  close(code = 0, reason = '') {
    if (this.exitCode !== null) return;
    clearTimeout(this.startTimer);
    this.exitCode = code;
    this.error = encoder.encode(reason);
    this.finishStarting(false);
    this.worker.terminate();
    this.reader?.();
  }
}

export class BrowserClangd {
  constructor(zed, makeWorker = () => new Worker('/editor/runtime/clangd/worker.js?v=21.1.0-2', { type: 'module' })) {
    this.zed = zed;
    this.makeWorker = makeWorker;
    this.running = new Map();
  }

  accepts(options) { return options.command === 'clangd' && isBrowserProject(options.cwd); }
  owns(id) { return typeof id === 'string' && id.startsWith(PREFIX); }

  async processOpen(options) {
    if (!this.accepts(options)) throw new Error('Browser clangd opens browser files only.');
    if (!globalThis.crossOriginIsolated) throw new Error('Open the top-level Zed page to enable WebAssembly language tools.');
    if (this.running.size) throw new Error('A browser clangd project is already open.');
    const id = PREFIX + crypto.randomUUID();
    const process = new ClangdProcess(this.zed, options.cwd, this.makeWorker());
    this.running.set(id, process);
    process.start().catch(error => process.close(1, error.message));
    return { id, pid: 0 };
  }

  get(id) {
    const process = this.running.get(id);
    if (!process) throw new Error('clangd stopped.');
    return process;
  }

  async processRead(id) {
    const result = await this.get(id).read();
    if (result.ended) this.running.delete(id);
    return result;
  }

  processWrite(id, bytes) { return this.get(id).write(bytes); }
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
