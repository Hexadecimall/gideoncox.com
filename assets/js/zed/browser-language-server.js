import { isBrowserProject } from './paths.js?v=local-folders-1';
import { joinBytes, LspFrames, lspFrame } from './lsp-stream.js';

const MAX_FILE = 2 * 1024 * 1024;
export const MAX_PROJECT = 16 * 1024 * 1024;
const MAX_OUTPUT = 24 * 1024 * 1024;
const MAX_PROJECT_FILES = 4000;
const READ_BATCH = 16;
const encoder = new TextEncoder();
let webKitStartup = Promise.resolve();

function startWorker(start) {
  const agent = globalThis.navigator?.userAgent ?? '';
  const appleWebKit = /AppleWebKit\//.test(agent) && !/\b(?:Chromium|Chrome|Edg|OPR)\//.test(agent);
  if (!appleWebKit || !globalThis.navigator?.serviceWorker?.controller) return start();
  // WebKit can fail concurrent module-worker loads under the isolation service worker.
  // Queue initialization only. Servers process LSP requests independently afterward.
  const startup = webKitStartup.then(start);
  webKitStartup = startup.catch(() => {});
  return startup;
}

export function isLanguageProject(path) {
  return isBrowserProject(path) || Boolean(globalThis.zedLocalFolders?.rootFor(path));
}

function projectPath(path, root) {
  return isLanguageProject(path) && path.startsWith(root + '/') && !path.includes('\0')
    && !path.slice(root.length + 1).split('/').some(part =>
      !part || ['.', '..', '.git', '.config', '.venv', '__pycache__', 'target', 'node_modules'].includes(part));
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

export async function readProjectFile(zed, path) {
  const folders = globalThis.zedLocalFolders;
  return folders?.rootFor(path) ? folders.read(path) : zed.read_browser_file(path);
}

export async function projectFiles(zed, root, include, running = () => true, reservedBytes = 0) {
  const accepts = path => projectPath(path, root) && include(path);
  const folders = globalThis.zedLocalFolders;
  const local = folders?.rootFor(root);
  if (!local && zed.workspace_ready) {
    // Restored editors can start LSP before Zed exposes its workspace filesystem.
    const deadline = performance.now() + 30000;
    while (running() && !zed.workspace_ready()) {
      if (performance.now() >= deadline) throw new Error('The workspace filesystem did not finish opening.');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  if (!running() || reservedBytes >= MAX_PROJECT) return [];
  const paths = local
    ? await folders.listFiles(root, accepts, MAX_PROJECT_FILES)
    : JSON.parse(await zed.list_browser_paths())
      .filter(entry => !entry.isDirectory && accepts(entry.path))
      .map(entry => entry.path).slice(0, MAX_PROJECT_FILES);
  const files = [];
  let total = reservedBytes;
  for (let offset = 0; offset < paths.length && running(); offset += READ_BATCH) {
    const batch = paths.slice(offset, offset + READ_BATCH);
    const results = await Promise.allSettled(batch.map(path => readProjectFile(zed, path)));
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') continue;
      const bytes = result.value;
      if (bytes.byteLength > MAX_FILE || total + bytes.byteLength > MAX_PROJECT) continue;
      files.push([batch[index], bytes]);
      total += bytes.byteLength;
    }
    if (total === MAX_PROJECT) break;
  }
  return files;
}

class BrowserLspProcess {
  constructor(zed, root, makeWorker, command, initializeOptions, includePath, formatConfigFiles) {
    this.zed = zed;
    this.root = root;
    this.makeWorker = makeWorker;
    this.command = command;
    this.initializeOptions = initializeOptions;
    this.includePath = includePath;
    this.formatConfigFiles = formatConfigFiles;
    this.input = new LspFrames();
    this.output = [];
    this.outputLength = 0;
    this.error = new Uint8Array();
    this.exitCode = null;
    this.failure = '';
    this.ready = new Promise(resolve => { this.finishStarting = resolve; });
    this.startTimer = setTimeout(() => this.close(1, `${command} timed out while starting.`), 90000);
    this.writeQueue = Promise.resolve();
  }

  bindWorker(worker) {
    const { command } = this;
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
          if (this.outputLength > MAX_OUTPUT) throw new Error(`${command} output exceeded its buffer limit.`);
          this.output.push(frame);
          this.reader?.();
        }
      } catch (error) { this.close(1, error.message); }
    });
    worker.addEventListener('error', event => {
      event.preventDefault();
      this.close(1, event.message || `${command} worker failed.`);
    });
    worker.addEventListener('messageerror', () => this.close(1, `${command} sent an invalid message.`));
  }

  async start(prepareRuntime) {
    const [files, runtime] = await Promise.all([
      projectFiles(this.zed, this.root, this.includePath, () => this.exitCode === null),
      prepareRuntime?.(),
    ]);
    await startWorker(() => {
      if (this.exitCode !== null) return;
      const worker = this.makeWorker();
      this.worker = worker;
      this.bindWorker(worker);
      worker.postMessage({ type: 'start', root: this.root, files, ...runtime });
      return this.ready;
    });
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
      try { bytes = typeof text === 'string' ? encoder.encode(text) : await readProjectFile(this.zed, path); }
      catch { return; }
      if (bytes.byteLength > MAX_FILE) return;
    }
    if (this.exitCode === null) this.worker.postMessage({ type: 'file', path, bytes });
  }

  async readFormatConfig(uri) {
    const path = pathFromUri(uri, this.root);
    if (!path) return [];
    const paths = [];
    for (let directory = path.slice(0, path.lastIndexOf('/')); ; directory = directory.slice(0, directory.lastIndexOf('/'))) {
      for (const name of this.formatConfigFiles) paths.push(`${directory}/${name}`);
      if (directory === this.root) break;
    }
    const results = await Promise.allSettled(paths.map(path => readProjectFile(this.zed, path)));
    return results.flatMap((result, index) => result.status === 'fulfilled' && result.value.byteLength <= MAX_FILE
      ? [[paths[index], result.value]] : []);
  }

  write(bytes) {
    const data = new Uint8Array(bytes).slice();
    this.writeQueue = this.writeQueue.then(async () => {
      if (!await this.ready || this.exitCode !== null) throw new Error(this.failure || `${this.command} stopped.`);
      for (const message of this.input.push(data)) {
        const { method, params } = message;
        if (method === 'initialize' && this.initializeOptions) {
          message.params = {
            ...params,
            initializationOptions: {
              ...this.initializeOptions,
              ...params?.initializationOptions,
            },
          };
        } else if (method === 'textDocument/didOpen') {
          await this.syncFile(params?.textDocument?.uri, params?.textDocument?.text);
        } else if (method === 'textDocument/didSave') {
          await this.syncFile(params?.textDocument?.uri, params?.text);
        } else if (method === 'workspace/didChangeWatchedFiles') {
          for (const { uri, type } of params?.changes ?? []) await this.syncFile(uri, undefined, type === 3);
        } else if (method === 'textDocument/formatting' && this.formatConfigFiles) {
          message.formatFiles = await this.readFormatConfig(params?.textDocument?.uri);
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
    this.failure = reason;
    this.error = encoder.encode(reason);
    this.finishStarting(false);
    this.worker?.terminate();
    this.reader?.();
  }
}

export class BrowserLanguageServer {
  constructor(zed, { command, makeWorker, initializeOptions, includePath, formatConfigFiles, prepareRuntime }) {
    this.zed = zed;
    this.makeWorker = makeWorker;
    this.command = command;
    this.initializeOptions = initializeOptions;
    this.includePath = includePath;
    this.formatConfigFiles = formatConfigFiles;
    this.prepareRuntime = prepareRuntime;
    this.prefix = `browser-${command}:`;
    this.running = new Map();
  }

  accepts(options) { return options.command === this.command && isLanguageProject(options.cwd); }
  owns(id) { return typeof id === 'string' && id.startsWith(this.prefix); }

  async processOpen(options) {
    if (!this.accepts(options)) throw new Error(`Browser ${this.command} opens browser files only.`);
    if (!globalThis.crossOriginIsolated) throw new Error('Open the top-level Zed page to enable WebAssembly language tools.');
    const id = this.prefix + crypto.randomUUID();
    const process = new BrowserLspProcess(this.zed, options.cwd, this.makeWorker, this.command,
      this.initializeOptions, this.includePath, this.formatConfigFiles);
    this.running.set(id, process);
    process.start(this.prepareRuntime).catch(error => process.close(1, error?.message ?? String(error)));
    return { id, pid: 0 };
  }

  get(id) {
    const process = this.running.get(id);
    if (!process) throw new Error(`${this.command} stopped.`);
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
