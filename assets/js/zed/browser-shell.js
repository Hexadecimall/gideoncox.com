import { LineBuffer } from '../terminal/line-buffer.js';
import { joinBytes } from './lsp-stream.js';
import { isBrowserProject } from './paths.js';

const WORKER = '/editor/runtime/ark/worker.js?v=2';
const SESSION_PREFIX = 'browser-shell:';
const LINE_LIMIT = 16_384;
const encoder = new TextEncoder();
const plain = text => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const lineEndings = text => plain(text).replace(/\n/g, '\r\n');
const clearLine = '\r\x1b[2K';
const inputPreview = text => text.replace(/\n/g, '↵').replace(/\t/g, ' ');

// Approximate terminal column widths for left and right clipping.
function columns(text) {
  let width = 0;
  for (const character of text) {
    if (/[\p{Mark}\u200d]/u.test(character)) continue;
    width += /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Emoji_Presentation}\uff01-\uff60\uffe0-\uffe6]/u.test(character) ? 2 : 1;
  }
  return width;
}

class BrowserShellProcess {
  constructor(worker, size, project, mount) {
    this.worker = worker;
    this.size = size;
    this.project = project;
    this.mount = mount;
    this.line = new LineBuffer();
    this.decoder = new TextDecoder();
    this.output = [];
    this.requests = new Map();
    this.sequence = 0;
    this.input = Promise.resolve();
    this.inputEpoch = 0;
    this.history = [];
    this.historyIndex = 0;
    this.continuation = '';
    this.exitCode = null;
    this.interrupt = typeof SharedArrayBuffer === 'function' ? new Int32Array(new SharedArrayBuffer(4)) : null;
    worker.addEventListener('message', ({ data }) => {
      if (data.type === 'project-fs' && this.mount) {
        this.project.reply(this.mount, data.operation, data.args, () => this.exitCode === null);
        return;
      }
      const request = this.requests.get(data.id);
      if (!request) return;
      this.requests.delete(data.id);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data.value);
    });
    worker.addEventListener('error', event => {
      event.preventDefault();
      this.fail(event.message || 'Browser Ark stopped.');
    });
    worker.addEventListener('messageerror', () => this.fail('Browser Ark returned an invalid response.'));
  }

  request(type, data = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.requests.set(id, { resolve, reject });
      try { this.worker.postMessage({ id, type, ...data }); }
      catch (error) { this.requests.delete(id); reject(error); }
    });
  }

  async start() {
    const { cwd, warning } = await this.request('init', { mount: this.mount });
    this.cwd = cwd;
    this.append('\x1b]2;Browser Ark\x07\x1b[?2004h');
    if (this.project && !this.mount) this.append('Project files require browser isolation.\r\n');
    if (warning) this.append(lineEndings(warning + '\n'));
    this.render();
  }

  append(text) {
    if (text) this.output.push(encoder.encode(text));
    this.wake?.();
  }

  async read() {
    if (!this.output.length && this.exitCode === null) {
      await new Promise(resolve => { this.wake = resolve; });
      this.wake = undefined;
    }
    const data = joinBytes(this.output);
    this.output.length = 0;
    return { data, ended: this.exitCode !== null, exitCode: this.exitCode, signal: null };
  }

  finish(code, message = 'Browser Ark closed.') {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.worker.terminate();
    for (const request of this.requests.values()) request.reject(new Error(message));
    this.requests.clear();
    this.wake?.();
  }

  fail(message) {
    if (this.exitCode !== null) return;
    this.append(lineEndings(message + '\n'));
    this.finish(1, message);
  }

  prompt() {
    if (this.continuation) return '> ';
    const home = this.mount?.root ?? '/home/web';
    const abbreviation = this.cwd === home || this.cwd.startsWith(home + '/') ? '~' + this.cwd.slice(home.length) : this.cwd;
    return 'ark:' + plain(abbreviation).replace(/\s/g, ' ') + ' $ ';
  }

  render() {
    if (!this.cwd || this.running || this.exitCode !== null) return;
    const width = Math.max(12, this.size.columns || 80);
    const maxPrompt = Math.max(8, Math.floor(width / 3));
    let prefix = this.prompt();
    while (columns(prefix) > maxPrompt) prefix = '…' + Array.from(prefix).slice(2).join('');
    const room = width - columns(prefix) - 2;
    const left = Array.from(inputPreview(this.line.text.slice(0, this.line.cursor)));
    const right = Array.from(inputPreview(this.line.text.slice(this.line.cursor)));
    // Limit the work to characters that can fit on the screen.
    let visibleLeft = left.slice(-room).join('');
    while (columns(visibleLeft) > room) visibleLeft = Array.from(visibleLeft).slice(1).join('');
    let visibleRight = right.slice(0, room).join('');
    while (columns(visibleLeft + visibleRight) > room) visibleRight = Array.from(visibleRight).slice(0, -1).join('');
    const marker = visibleLeft.length < this.line.cursor ? '‹' : '';
    const cursor = columns(prefix + marker + visibleLeft);
    this.append(`${clearLine}\x1b[32m${prefix}\x1b[0m${marker}${visibleLeft}${visibleRight}\r\x1b[${cursor}C`);
  }

  async submit() {
    const source = this.continuation + this.line.text;
    this.append(clearLine + lineEndings(this.prompt() + this.line.text + '\n'));
    this.line.replace('');
    if (!source.trim()) return;
    this.running = true;
    if (this.interrupt) Atomics.store(this.interrupt, 0, 0);
    try {
      const result = await this.request('run', { source, interrupt: this.interrupt?.buffer });
      if (result.incomplete && !this.cancelled) {
        this.continuation = source + '\n';
        return;
      }
      this.continuation = '';
      if (source !== this.history.at(-1)) this.history.push(source);
      if (this.history.length > 100) this.history.shift();
      this.historyIndex = this.history.length;
      this.draft = '';
      if (result.incomplete) return;
      this.cwd = result.cwd;
      for (const action of result.actions) {
        if (action === 'clear') this.append('\x1b[2J\x1b[H');
        if (action.startsWith('edit:') && this.mount) {
          try { await this.project.open(this.mount, action.slice(5)); }
          catch (error) { this.append(lineEndings(`${error?.message ?? error}\n`)); }
        }
      }
      this.append(lineEndings(result.out));
      if (result.err) this.append(`\x1b[31m${lineEndings(result.err)}\x1b[0m`);
      const last = result.err || result.out;
      if (last && !last.endsWith('\n')) this.append('\r\n');
      if (result.warning) this.append(lineEndings(result.warning + '\n'));
      if (result.exited) this.finish(result.code);
    } finally {
      this.running = false;
      this.cancelled = false;
      this.render();
    }
  }

  async complete() {
    if (this.line.cursor !== this.line.text.length) return;
    const text = this.line.text;
    const token = text.match(/[^\s;|&]*$/)[0];
    if (/["'\\]/.test(token)) return;
    const start = text.length - token.length;
    const matches = await this.request('complete', { prefix: token, command: start === 0 });
    if (this.line.text !== text) return;
    if (matches.length === 1) this.line.replace(text.slice(0, start) + matches[0].replace(/([\s'"\\$;|&()<>])/g, '\\$1'));
    else if (matches.length) this.append(lineEndings('\n' + matches.join('  ') + '\n'));
  }

  insert(text) {
    const room = LINE_LIMIT - this.continuation.length - this.line.text.length;
    if (room > 0 && text.length <= room) this.line.insert(text);
  }

  async key(key) {
    if (key === '\x1b[200~') { this.pasting = true; return; }
    if (key === '\x1b[201~') { this.pasting = false; return; }
    if (this.pasting) {
      this.insert(key === '\r' ? '\n' : plain(key.startsWith('\x1b') ? '' : key));
      return;
    }
    switch (key) {
      case '\r': case '\n': return this.submit();
      case '\t': return this.complete();
      case '\x1b[A': case '\x1bOA': case '\x1b[B': case '\x1bOB': {
        if (this.historyIndex === this.history.length) this.draft = this.line.text;
        this.historyIndex += key.endsWith('A') ? -1 : 1;
        this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex));
        this.line.replace(this.history[this.historyIndex] ?? this.draft);
        break;
      }
      case '\x1b[D': case '\x1bOD': this.line.move(-1); break;
      case '\x1b[C': case '\x1bOC': this.line.move(1); break;
      case '\x01': case '\x1b[H': case '\x1bOH': this.line.cursor = 0; break;
      case '\x05': case '\x1b[F': case '\x1bOF': this.line.cursor = this.line.text.length; break;
      case '\x7f': case '\b': this.line.backspace(); break;
      case '\x04':
        if (!this.line.text && !this.continuation) { this.append('\r\n'); this.finish(0); break; }
        this.line.delete(); break;
      case '\x1b[3~': this.line.delete(); break;
      case '\x17': this.line.deleteWord(); break;
      case '\x15': this.line.text = this.line.text.slice(this.line.cursor); this.line.cursor = 0; break;
      case '\x0b': this.line.text = this.line.text.slice(0, this.line.cursor); break;
      case '\x0c': this.append('\x1b[2J\x1b[H'); break;
      default:
        if (key.startsWith('\x1b')) break;
        this.insert(plain(key));
    }
  }

  cancel() {
    if (this.running && (!this.interrupt || this.cancelled)) return;
    this.inputEpoch++;
    this.pasting = false;
    this.line.replace('');
    this.continuation = '';
    if (this.running) {
      this.cancelled = true;
      Atomics.store(this.interrupt, 0, 1);
    }
    this.append('^C\r\n');
    this.render();
  }

  write(bytes) {
    if (this.exitCode !== null) return;
    const text = this.decoder.decode(bytes, { stream: true });
    if (text === '\x03') return this.cancel();
    const epoch = this.inputEpoch;
    this.input = this.input.then(async () => {
      for (const [key] of text.matchAll(/\x1b(?:\[[0-?]*[ -/]*[@-~]|O.)?|[^\x00-\x1f\x7f]+|[\s\S]/gu)) {
        if (epoch !== this.inputEpoch || this.exitCode !== null) return;
        const previous = this.previousKey;
        this.previousKey = key;
        if (key === '\n' && previous === '\r') continue;
        await this.key(key);
      }
      this.render();
    }).catch(error => this.fail(error.message));
  }
}

export class BrowserShellBridge {
  constructor(makeWorker = () => new Worker(WORKER, { type: 'module' }), project) {
    this.makeWorker = makeWorker;
    this.project = project;
    this.sessions = new Map();
  }

  static accepts({ command, cwd }) {
    if (command) return command === 'browser-ark';
    return !cwd || isBrowserProject(cwd) || Boolean(globalThis.zedLocalFolders?.rootFor(cwd));
  }

  owns(id) { return id.startsWith(SESSION_PREFIX); }

  async open(options) {
    const id = SESSION_PREFIX + crypto.randomUUID();
    const mount = typeof SharedArrayBuffer === 'function' ? this.project?.mount(options.cwd) : undefined;
    const process = new BrowserShellProcess(this.makeWorker(), options, this.project, mount);
    this.sessions.set(id, process);
    try { await process.start(); }
    catch (error) { this.close(id); throw error; }
    return id;
  }

  async read(id) {
    const process = this.sessions.get(id);
    if (!process) return { data: new Uint8Array(), ended: true };
    const result = await process.read();
    if (result.ended) this.sessions.delete(id);
    return result;
  }

  write(id, bytes) { this.sessions.get(id)?.write(bytes); }
  resize(id, size) {
    const process = this.sessions.get(id);
    if (process) { process.size = size; process.render(); }
  }
  close(id) {
    this.sessions.get(id)?.finish(130);
    this.sessions.delete(id);
  }
}
