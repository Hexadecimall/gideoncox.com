import { request, interrupt } from './terminal/client.js';

const root = document.querySelector('#terminal');
const output = root.querySelector('.terminal-output');
const input = root.querySelector('#terminal-input');
const form = root.querySelector('.terminal-form');
const prompt = root.querySelector('.terminal-prompt');
const status = root.querySelector('.browser-terminal .terminal-status');
const stop = root.querySelector('[data-terminal-stop]');
let cwd = '/home/web';
let busy = false;
let continuation = '';
let history = [];
let historyIndex = 0;
let draft = '';
let generation = 0;
try { history = JSON.parse(sessionStorage.getItem('ark-history') || '[]').filter(item => typeof item === 'string').slice(-100); } catch {}
historyIndex = history.length;

function line(text, className = '') {
  if (!text) return;
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  output.append(element);
  while (output.childNodes.length > 300) output.firstChild.remove();
  output.scrollTop = output.scrollHeight;
}
function updatePrompt() {
  prompt.textContent = continuation ? '>' : `${cwd.replace(/^\/home\/web(?=\/|$)/, '~')} $`;
  stop.disabled = !busy && !continuation;
  input.readOnly = busy;
  input.setAttribute('aria-busy', String(busy));
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || input.disabled) return;
  const text = input.value;
  const source = continuation + text;
  line(`${prompt.textContent} ${text}`, 'terminal-command');
  input.value = '';
  busy = true;
  updatePrompt();
  status.textContent = 'Running';
  const turn = ++generation;
  try {
    const result = await request('run', { source });
    if (turn !== generation) return;
    if (result.incomplete) { continuation = source + '\n'; status.textContent = 'Continue command'; return; }
    continuation = '';
    if (source.trim() && history.at(-1) !== source) history.push(source);
    history = history.slice(-100); historyIndex = history.length;
    try { sessionStorage.setItem('ark-history', JSON.stringify(history)); } catch {}
    cwd = result.cwd;
    for (const action of result.actions) {
      if (action === 'clear') output.replaceChildren();
      else if (action.startsWith('edit:')) line('The Zed browser build is not ready. Use cat to read browser files.\n');
    }
    line(result.out);
    line(result.err, 'terminal-error');
    status.textContent = result.warning || (result.code ? `Exit ${result.code}` : 'Ready');
  } catch (error) { if (turn === generation) { line(error.message + '\n', 'terminal-error'); status.textContent = 'Command failed'; } }
  finally { if (turn === generation) { busy = false; updatePrompt(); } }
});
async function cancel() {
  generation++;
  const wasBusy = busy;
  continuation = ''; busy = false;
  line('^C\n', 'terminal-command');
  if (wasBusy) {
    input.disabled = true;
    try { const result = await interrupt(); cwd = result.cwd; }
    catch (error) { status.textContent = error.message; return; }
    input.disabled = false;
  }
  status.textContent = 'Ready'; updatePrompt(); input.focus({ preventScroll: true });
}
stop.addEventListener('click', cancel);
input.addEventListener('keydown', async event => {
  if (event.ctrlKey && event.key.toLowerCase() === 'c' && input.selectionStart === input.selectionEnd) { event.preventDefault(); cancel(); return; }
  if (event.ctrlKey && event.key.toLowerCase() === 'l') { event.preventDefault(); output.replaceChildren(); return; }
  if (busy) return;
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    if (historyIndex === history.length) draft = input.value;
    historyIndex = Math.max(0, Math.min(history.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
    input.value = historyIndex === history.length ? draft : history[historyIndex];
    input.setSelectionRange(input.value.length, input.value.length);
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    const value = input.value;
    if (input.selectionStart !== value.length) return;
    const token = value.match(/[^\s;|&]*$/)?.[0] || '';
    if (/["'\\]/.test(token)) return;
    const start = value.length - token.length;
    try {
      const matches = await request('complete', { prefix: token, command: start === 0 });
      if (input.value !== value) return;
      if (matches.length === 1) input.value = value.slice(0, start) + matches[0].replace(/([\s'"\\$;|&()<>])/g, '\\$1');
      else if (matches.length) line(matches.join('  ') + '\n');
    } catch (error) { status.textContent = error.message; }
  }
});
try {
  const result = await window.siteFilesReady;
  cwd = result.cwd;
  input.disabled = false;
  status.textContent = result.warning || 'Files saved in this browser';
  line('Ark · type help for commands\n');
  updatePrompt();
} catch (error) { status.textContent = error.message; }
