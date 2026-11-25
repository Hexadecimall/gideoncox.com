import { createStdin } from '../../../editor/runtime/python/stdin.js';
import { isBrowserProject } from './browser-python.js?v=cf8d2baff46f';
import { joinBytes } from './lsp-stream.js';

const PROGRAM = 'browser-python';
const MAX_FILE = 2 * 1024 * 1024;
const MAX_PROJECT = 24 * 1024 * 1024;
const MAX_FILES = 3000;
const INPUT_LIMIT = 8192;
const encoder = new TextEncoder();

function projectPath(path, root) {
  return isBrowserProject(path) && path.startsWith(root + '/') && !path.includes('\0')
    && !path.split('/').some(part => ['.git', '.config', '.venv', '__pycache__'].includes(part));
}

async function readProject(zed, root, script, source, running) {
  const files = [[script, encoder.encode(source)]];
  let total = files[0][1].length;
  const paths = JSON.parse(await zed.list_browser_paths());
  for (const { path, isDirectory } of paths) {
    if (!running()) break;
    if (isDirectory || path === script || !projectPath(path, root)) continue;
    let bytes;
    try { bytes = await zed.read_browser_file(path); }
    catch { continue; }
    if (bytes.byteLength > MAX_FILE || total + bytes.byteLength > MAX_PROJECT) continue;
    files.push([path, bytes]);
    total += bytes.byteLength;
    if (files.length === MAX_FILES) break;
  }
  return files;
}

/** Binary terminal transport backed by a sandboxed CPython worker. */
class BrowserPythonProcess {
  constructor(worker) {
    this.worker = worker;
    this.stdin = createStdin();
    this.decoder = new TextDecoder();
    this.output = [];
    this.line = '';
    this.exitCode = null;
    this.timer = setTimeout(() => this.fail('Python exceeded the five-minute run limit.'), 300000);
    worker.addEventListener('message', ({ data }) => {
      if (data.chunk instanceof Uint8Array) this.append(data.chunk);
      else if (typeof data.code === 'number') this.finish(data.code);
      else if (typeof data.error === 'string') this.fail(data.error);
    });
    worker.addEventListener('error', event => {
      event.preventDefault();
      this.fail(event.message || 'Python worker stopped.');
    });
    worker.addEventListener('messageerror', () => this.fail('Python returned an invalid message.'));
  }

  fail(message) {
    if (this.exitCode !== null) return;
    this.append(encoder.encode(`\r\n${message}\r\n`));
    this.finish(1);
  }

  finish(code) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    clearTimeout(this.timer);
    this.stdin.close();
    this.worker.terminate();
    this.onOutput?.();
  }

  write(bytes) {
    if (this.exitCode !== null) return;
    const input = this.decoder.decode(bytes, { stream: true }).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    let echo = '';
    for (const key of input) {
      if (key === '\x03') {
        this.append(encoder.encode(echo + '^C\r\n'));
        this.finish(130);
        return;
      }
      if (key === '\x04') {
        if (this.line) this.stdin.write(encoder.encode(this.line));
        this.stdin.close();
        break;
      }
      if (key === '\r' || key === '\n') {
        if (key === '\n' && this.previousKey === '\r') continue;
        if (!this.stdin.write(encoder.encode(this.line + '\n'))) break;
        this.line = '';
        echo += '\r\n';
      } else if (key === '\x7f' || key === '\b') {
        if (this.line) {
          this.line = Array.from(this.line).slice(0, -1).join('');
          echo += '\b \b';
        }
      } else if ((key >= ' ' || key === '\t') && this.line.length < INPUT_LIMIT) {
        this.line += key;
        echo += key;
      }
      this.previousKey = key;
    }
    if (echo) this.append(encoder.encode(echo));
  }

  append(bytes) {
    this.output.push(bytes);
    this.onOutput?.();
  }

  async read() {
    if (!this.output.length && this.exitCode === null) {
      await new Promise(resolve => { this.onOutput = resolve; });
      this.onOutput = undefined;
    }
    const data = joinBytes(this.output);
    this.output.length = 0;
    return { data, ended: this.exitCode !== null, exitCode: this.exitCode, signal: null };
  }
}

export class BrowserRunBridge {
  constructor(zed, makeWorker = () => new Worker('/editor/runtime/python/worker.js?v=1', { type: 'module' })) {
    this.zed = zed;
    this.makeWorker = makeWorker;
    this.sessions = new Map();
  }

  accepts(options) { return options.command === PROGRAM; }
  owns(id) { return id.startsWith(PROGRAM + ':'); }

  async open({ cwd, args, env }) {
    const source = env?.ZED_BROWSER_SOURCE;
    const script = args?.[0];
    if (!globalThis.crossOriginIsolated) throw new Error('Open the top-level Zed page to run Python.');
    if (!isBrowserProject(cwd) || !projectPath(script, cwd) || typeof source !== 'string'
      || encoder.encode(source).length > MAX_FILE) throw new Error('The Python file is outside the browser project or too large.');
    if (this.sessions.size >= 3) throw new Error('Close a running Python terminal first.');
    const id = PROGRAM + ':' + crypto.randomUUID();
    const process = new BrowserPythonProcess(this.makeWorker());
    this.sessions.set(id, process);
    process.append(encoder.encode('Starting Python…\r\n'));
    const running = () => process.exitCode === null;
    readProject(this.zed, cwd, script, source, running).then(files => {
      if (running()) process.worker.postMessage({ cwd, script, files, stdin: process.stdin.buffer });
    }).catch(error => process.fail(error.message));
    return id;
  }

  async read(id) {
    const process = this.sessions.get(id);
    if (!process) return { data: new Uint8Array(), ended: true };
    const result = await process.read();
    if (result.ended) this.sessions.delete(id);
    return result;
  }

  async write(id, data) { this.sessions.get(id)?.write(data); }
  async close(id) {
    this.sessions.get(id)?.finish(130);
    this.sessions.delete(id);
  }
}
