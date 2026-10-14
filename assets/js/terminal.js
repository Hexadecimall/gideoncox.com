import { request, interrupt } from './terminal/client.js';
import { createDisplay } from './terminal/display.js';
import { LineBuffer } from './terminal/line-buffer.js';

const panel = document.querySelector('.browser-terminal');
const status = panel.querySelector('.terminal-status');
const { terminal, resize } = createDisplay(panel.querySelector('.terminal-surface'));
const line = new LineBuffer();
let cwd = '/home/web';
let busy = false;
let ready = false;
let continuation = '';
let generation = 0;
let inputEpoch = 0;
let history = [];
let historyIndex = 0;
let draft = '';
let inputQueue = Promise.resolve();
try { history = JSON.parse(sessionStorage.getItem('ark-history') || '[]').filter(item => typeof item === 'string').slice(-100); } catch {}
historyIndex = history.length;

const plain = text => String(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
const prompt = () => continuation ? '> ' : `${cwd.replace(/^\/home\/web(?=\/|$)/, '~')} $ `;
const write = text => terminal.write(plain(text).replace(/\r?\n/g, '\r\n'));

function render() {
  if (busy || !ready) return;
  // Scroll long input horizontally, keeping the insertion point visible on phones.
  const fullPrompt = prompt();
  const maxPrompt = Math.max(6, Math.floor(terminal.cols / 3));
  const prefix = fullPrompt.length > maxPrompt ? '…' + fullPrompt.slice(-maxPrompt + 1) : fullPrompt;
  const room = Math.max(4, terminal.cols - prefix.length - 2);
  const offset = Math.max(0, line.cursor - room + 1);
  const visible = plain(line.text.slice(offset, offset + room));
  const marker = offset ? '‹' : '';
  terminal.write(`\r\x1b[2K\x1b[32m${prefix}\x1b[0m${marker}${visible}\r\x1b[${prefix.length + marker.length + line.cursor - offset}C`);
}

async function submit() {
  const source = continuation + line.text;
  terminal.write('\r\x1b[2K');
  write(prompt() + line.text + '\n');
  line.replace('');
  busy = true;
  status.textContent = 'Running';
  const turn = ++generation;
  try {
    const result = await request('run', { source });
    if (turn !== generation) return;
    if (result.incomplete) { continuation = source + '\n'; status.textContent = 'Continue command'; return; }
    continuation = '';
    if (source.trim() && history.at(-1) !== source) history.push(source);
    history = history.slice(-100);
    historyIndex = history.length;
    try { sessionStorage.setItem('ark-history', JSON.stringify(history)); } catch {}
    cwd = result.cwd;
    for (const action of result.actions) {
      if (action === 'clear') terminal.write('\x1b[2J\x1b[H');
      else if (action.startsWith('edit:')) write('Zed is not available yet.\n');
    }
    write(result.out);
    if (result.err) { terminal.write('\x1b[31m'); write(result.err); terminal.write('\x1b[0m'); }
    if ((result.err || result.out) && !(result.err || result.out).endsWith('\n')) write('\n');
    status.textContent = result.warning || (result.code ? `Exit ${result.code}` : 'Browser files · saved on this device');
  } catch (error) {
    if (turn === generation) { write(error.message + '\n'); status.textContent = 'Command failed'; }
  } finally {
    if (turn === generation) { busy = false; render(); }
  }
}

async function cancel() {
  const turn = ++generation;
  inputEpoch++;
  const running = busy;
  continuation = '';
  line.replace('');
  write('^C\n');
  if (running) {
    ready = false;
    try { cwd = (await interrupt()).cwd; }
    catch (error) { status.textContent = error.message; busy = false; return; }
  }
  if (turn !== generation) return;
  ready = true; busy = false;
  status.textContent = 'Browser files · saved on this device';
  render();
}

async function complete() {
  if (line.cursor !== line.text.length) return;
  const value = line.text;
  const token = value.match(/[^\s;|&]*$/)?.[0] || '';
  if (/["'\\]/.test(token)) return;
  const start = value.length - token.length;
  const matches = await request('complete', { prefix: token, command: start === 0 });
  if (line.text !== value) return;
  if (matches.length === 1) line.replace(value.slice(0, start) + matches[0].replace(/([\s'"\\$;|&()<>])/g, '\\$1'));
  else if (matches.length) write('\n' + matches.join('  ') + '\n');
  render();
}

async function input(data, epoch) {
  if (!ready || busy) return;
  if (data === '\x1b[A' || data === '\x1b[B') {
    if (historyIndex === history.length) draft = line.text;
    historyIndex = Math.max(0, Math.min(history.length, historyIndex + (data.endsWith('A') ? -1 : 1)));
    line.replace(historyIndex === history.length ? draft : history[historyIndex]);
  } else if (data === '\x1b[D') line.move(-1);
  else if (data === '\x1b[C') line.move(1);
  else if (data === '\x01' || data === '\x1b[H') line.cursor = 0;
  else if (data === '\x05' || data === '\x1b[F') line.cursor = line.text.length;
  else if (data === '\x7f' || data === '\b') line.backspace();
  else if (data === '\x1b[3~' || data === '\x04') line.delete();
  else if (data === '\x17') line.deleteWord();
  else if (data === '\x15') { line.text = line.text.slice(line.cursor); line.cursor = 0; }
  else if (data === '\x0b') line.text = line.text.slice(0, line.cursor);
  else if (data === '\x0c') terminal.write('\x1b[2J\x1b[H');
  else if (data === '\t') { await complete(); return; }
  else if (!data.startsWith('\x1b')) {
    for (const part of data.replace(/\r\n/g, '\r').split(/([\r\n])/)) {
      if (epoch !== inputEpoch) return;
      if (part === '\r' || part === '\n') await submit();
      else line.insert(plain(part));
    }
  }
  render();
}

function receive(data) {
  if (data === '\x03') { cancel(); return; }
  if (busy) return;
  const epoch = inputEpoch;
  inputQueue = inputQueue.then(() => { if (epoch === inputEpoch) return input(data, epoch); }).catch(error => { status.textContent = error.message; });
}
terminal.onData(receive);
terminal.onResize(render);
window.addEventListener('terminal-input', event => { if (!panel.hidden) { terminal.focus(); receive(event.detail); } });
window.addEventListener('terminal-mode-changed', () => { if (!panel.hidden) { resize(); render(); } });

try {
  const result = await window.siteFilesReady;
  cwd = result.cwd;
  ready = true;
  status.textContent = result.warning || 'Browser files · saved on this device';
  render();
} catch (error) { status.textContent = error.message; }
