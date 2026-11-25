import { createStdin } from '../../../editor/runtime/python/stdin.js';
import { BUILD_CONFIG, CLANG_TARGETS, parseBuildConfig, clangLibraryPaths } from '../../../editor/runtime/compiler/build-settings.js?v=1';
import { MAX_PROJECT, isLanguageProject, projectFiles, readProjectFile } from './browser-language-server.js?v=project-libs-1';
import { joinBytes } from './lsp-stream.js';

const PROGRAMS = new Map([
  ['browser-python', { label: 'Python', worker: '/editor/runtime/python/worker.js?v=2', targets: ['python'] }],
  ['browser-cc', { label: 'Clang', worker: '/editor/runtime/compiler/worker.js?v=project-libs-1',
    targets: CLANG_TARGETS }],
  ['browser-zig', { label: 'Zig', worker: '/editor/runtime/compiler/worker.js?v=6', targets: ['wasi'] }],
  ['browser-rust', { label: 'Rust', worker: '/editor/runtime/compiler/worker.js?v=cargo-diagnostics-3', targets: ['wasi'] }],
]);
const SESSION_PREFIX = 'browser-run:';
const MAX_FILE = 2 * 1024 * 1024;
const INPUT_LIMIT = 8192;
const encoder = new TextEncoder();

function projectPath(path, root) {
  return isLanguageProject(path) && path.startsWith(root + '/') && !path.includes('\0')
    && !path.slice(root.length + 1).split('/').some(part => !part || part === '.' || part === '..');
}

async function readProject(zed, { cwd: root, script, source, command, target }, running) {
  const inputs = new Map([[script, encoder.encode(source)]]);
  let reserved = inputs.get(script).byteLength;
  let config;
  if (target === 'wasi' || command === 'browser-cc') {
    const configPath = `${root}/${BUILD_CONFIG}`;
    config = await readProjectFile(zed, configPath).catch(() => undefined);
    if (config) {
      if (config.byteLength > MAX_FILE) throw new Error(`${BUILD_CONFIG} exceeds the 2 MB limit.`);
      inputs.set(configPath, config);
      reserved += config.byteLength;
    }
  }
  if (command === 'browser-cc') {
    const libraries = new Set(clangLibraryPaths(parseBuildConfig(config), target));
    for (const path of libraries) {
      if (!running()) return [];
      const absolute = `${root}/${path}`;
      const bytes = await readProjectFile(zed, absolute).catch(() => undefined);
      if (!bytes) throw new Error(`Could not read library ${path} in the project.`);
      reserved += bytes.byteLength;
      if (reserved > MAX_PROJECT) throw new Error(`Library ${path} exceeds the 16 MB project snapshot budget.`);
      inputs.set(absolute, bytes);
    }
  }
  const files = await projectFiles(zed, root, path => !inputs.has(path), running, reserved);
  return [...inputs, ...files];
}

/** Binary terminal transport backed by a sandboxed WASI worker. */
class BrowserTaskProcess {
  constructor(worker, label, showExitCode, onArtifact, onBuild) {
    this.worker = worker;
    this.showExitCode = showExitCode;
    this.stdin = createStdin();
    this.decoder = new TextDecoder();
    this.output = [];
    this.line = '';
    this.exitCode = null;
    this.timer = setTimeout(() => this.fail(`${label} exceeded the five-minute task limit.`), 300000);
    worker.addEventListener('message', ({ data }) => {
      if (this.exitCode !== null) return;
      if (data.chunk instanceof Uint8Array) this.append(data.chunk);
      else if (data.buildOutput || data.cargoDiagnostics) onBuild?.(data);
      else if (data.artifact instanceof Uint8Array) {
        try { onArtifact(data.artifact); }
        catch (error) { this.fail(error.message); }
      }
      else if (typeof data.code === 'number') {
        this.finish(data.code, data.ranProgram ? 'Exit code' : 'Build exit code');
      }
      else if (typeof data.error === 'string') this.fail(data.error);
    });
    worker.addEventListener('error', event => {
      event.preventDefault();
      this.fail(event.message || `${label} worker stopped.`);
    });
    worker.addEventListener('messageerror', () => this.fail(`${label} returned an invalid message.`));
  }

  fail(message) {
    if (this.exitCode !== null) return;
    this.append(encoder.encode(`\r\n${message}\r\n`));
    this.finish(1);
  }

  finish(code, statusLabel = 'Task exit code') {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    if (this.showExitCode) this.append(encoder.encode(`\r\n${statusLabel}: ${code}\r\n`));
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
  constructor(zed, makeWorker = path => new Worker(path, { type: 'module' }), onRustBuild) {
    this.zed = zed;
    this.makeWorker = makeWorker;
    this.onRustBuild = onRustBuild;
    this.sessions = new Map();
  }

  accepts(options) { return PROGRAMS.has(options.command); }
  owns(id) { return id.startsWith(SESSION_PREFIX); }

  async open({ cwd, command, args, env }) {
    const program = PROGRAMS.get(command);
    const source = env?.ZED_BROWSER_SOURCE;
    const script = args?.[0];
    const target = args?.[1] ?? (command === 'browser-python' ? 'python' : undefined);
    if (!program?.targets.includes(target)) throw new Error('Unsupported browser build target.');
    let programArgs;
    if (args?.length > 2) {
      if (target !== 'wasi' || args[2] !== '--') throw new Error('Invalid browser task arguments.');
      programArgs = args.slice(3);
      if (programArgs.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
        throw new Error('WebAssembly arguments must be strings without NUL characters.');
      }
    }
    if (!globalThis.crossOriginIsolated) throw new Error('Open the top-level Zed page to run browser tasks.');
    if (!isLanguageProject(cwd) || !projectPath(script, cwd) || typeof source !== 'string'
      || encoder.encode(source).length > MAX_FILE) throw new Error('The file is outside the browser project or too large.');
    if (this.sessions.size >= 3 || (command !== 'browser-python' && this.compiling)) {
      throw new Error('Finish the running browser build or close a browser task terminal first.');
    }
    const id = SESSION_PREFIX + crypto.randomUUID();
    const onBuild = command === 'browser-rust' ? snapshot => this.onRustBuild?.(cwd, snapshot) : undefined;
    const process = new BrowserTaskProcess(this.makeWorker(program.worker), program.label, target === 'wasi', data => {
      if (target !== 'linux-x86_64' && target !== 'linux-x86_64-static') {
        throw new Error('Unexpected browser build artifact.');
      }
      const stem = script.split('/').pop().replace(/\.[^.]+$/, '').replace(/[^\w.-]/g, '_');
      const link = document.createElement('a');
      const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
      link.href = url;
      link.download = `${stem || 'program'}-${target}.elf`;
      link.hidden = true;
      document.body.append(link);
      try { link.click(); }
      finally { link.remove(); }
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      process.append(encoder.encode(`Built ${link.download}\r\n`));
    }, onBuild);
    if (command !== 'browser-python') this.compiling = id;
    this.sessions.set(id, process);
    process.append(encoder.encode(`Starting ${program.label}…\r\n`));
    const running = () => process.exitCode === null;
    readProject(this.zed, { cwd, script, source, command, target }, running).then(files => {
      if (running()) process.worker.postMessage({
        cwd, script, files, command, target, programArgs, stdin: process.stdin.buffer,
      });
    }).catch(error => process.fail(error.message));
    return id;
  }

  async read(id) {
    const process = this.sessions.get(id);
    if (!process) return { data: new Uint8Array(), ended: true };
    const result = await process.read();
    if (result.ended) {
      this.sessions.delete(id);
      if (this.compiling === id) this.compiling = undefined;
    }
    return result;
  }

  async write(id, data) { this.sessions.get(id)?.write(data); }
  async close(id) {
    this.sessions.get(id)?.finish(130);
    this.sessions.delete(id);
    if (this.compiling === id) this.compiling = undefined;
  }
}
