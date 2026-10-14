// The pairing token stays in memory. Browser files never go to the connector.
const root = document.querySelector('#terminal');
const browserPanel = root.querySelector('.browser-terminal');
const localPanel = root.querySelector('.local-terminal');
const tabs = [...root.querySelectorAll('[data-terminal-mode]')];
const connectForm = root.querySelector('.connector-form');
const tokenInput = root.querySelector('#connector-token');
const connectButton = connectForm.querySelector('button[type=submit]');
const disconnectButton = root.querySelector('#connector-disconnect');
const status = root.querySelector('#connector-status');
const surface = root.querySelector('.local-terminal-surface');
const endpoint = 'http://127.0.0.1:8770';
let token = '';
let session = '';
let terminal;
let fit;
let pollTimer;
let inputQueue = Promise.resolve();
let connecting = false;

async function call(path, body, keepalive = false) {
  const response = await fetch(endpoint + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    credentials: 'omit',
    targetAddressSpace: 'loopback',
    signal: AbortSignal.timeout(5000),
    keepalive,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Connector error ${response.status}`);
  return result;
}
function resize() {
  if (!terminal || localPanel.hidden || surface.hidden) return;
  fit.fit();
  if (session) call('/resize', { session, columns: terminal.cols, rows: terminal.rows }).catch(fail);
}
function terminalPreferences() {
  const preferences = window.sitePreferences?.values || {};
  return {
    fontSize: preferences.terminalFontSize || 13,
    cursorStyle: preferences.terminalCursor || 'bar',
    cursorBlink: preferences.terminalBlink !== false,
    scrollback: preferences.terminalScrollback || 2500,
  };
}
window.addEventListener('site-preferences-changed', () => {
  if (!terminal) return;
  Object.assign(terminal.options, terminalPreferences());
  terminal.options.theme = { ...terminal.options.theme, cursor: window.sitePreferences.values.accent };
  resize();
});
function setupTerminal() {
  if (terminal) { terminal.reset(); return; }
  terminal = new window.Terminal({
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 2500,
    ...terminalPreferences(),
    allowProposedApi: false,
    screenReaderMode: true,
    theme: {
      background: '#0c110f', foreground: '#d6e0d2', cursor: '#c6f277', selectionBackground: '#c6f27740',
      black: '#0c110f', red: '#eb8c7b', green: '#c6f277', yellow: '#e3cb83',
      blue: '#88c9dc', magenta: '#c0adf7', cyan: '#91d5b9', white: '#edf1ef',
      brightBlack: '#758673', brightRed: '#ffb09d', brightGreen: '#d9ffa2', brightYellow: '#f8e2a0',
      brightBlue: '#b2e6f3', brightMagenta: '#d9caff', brightCyan: '#b0efcf', brightWhite: '#ffffff',
    },
  });
  fit = new window.FitAddon.FitAddon();
  terminal.loadAddon(fit);
  terminal.open(surface);
  terminal.onData(text => {
    const id = session;
    if (!id) return;
    // Preserve keystroke order even when several requests are in flight.
    inputQueue = inputQueue.then(async () => {
      if (session !== id) return;
      // Split large pastes at UTF-16 boundaries while retaining surrogate pairs.
      const chunks = Array.from(text);
      for (let offset = 0; offset < chunks.length; offset += 8192) {
        await call('/input', { session: id, text: chunks.slice(offset, offset + 8192).join('') });
      }
    }).catch(fail);
  });
  new ResizeObserver(resize).observe(surface);
}
function disconnected(message) {
  clearTimeout(pollTimer);
  session = ''; token = '';
  disconnectButton.hidden = true;
  connectForm.hidden = false;
  terminal && (terminal.options.disableStdin = true);
  status.textContent = message;
}
function fail(error) {
  const id = session;
  if (id) call('/disconnect', { session: id }).catch(() => {});
  disconnected(error instanceof TypeError ? 'Could not reach the connector. Start it locally and allow local network access if prompted.' : error.message);
}
async function poll() {
  const id = session;
  if (!id) return;
  try {
    const result = await call(`/output?session=${encodeURIComponent(id)}`);
    if (session !== id) return;
    // A write callback applies backpressure so large native output cannot
    // accumulate indefinitely in the terminal renderer.
    if (result.output) await new Promise(resolve => terminal.write(result.output, resolve));
    if (result.ended) { disconnected('Ark exited. Connect to start another session.'); return; }
    pollTimer = setTimeout(poll, result.output ? 20 : 90);
  } catch (error) { if (session === id) fail(error); }
}
connectForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (connecting || session) return;
  connecting = true; connectButton.disabled = true;
  token = tokenInput.value.trim();
  status.textContent = 'Connecting…';
  try {
    surface.hidden = false;
    setupTerminal();
    fit.fit();
    const result = await call('/connect', { columns: terminal.cols, rows: terminal.rows });
    session = result.session;
    tokenInput.value = '';
    terminal.options.disableStdin = false;
    connectForm.hidden = true;
    disconnectButton.hidden = false;
    status.textContent = 'Connected to this computer · Ark';
    terminal.focus();
    poll();
  } catch (error) { fail(error); }
  finally { connecting = false; connectButton.disabled = false; }
});
disconnectButton.addEventListener('click', async () => {
  const id = session;
  try { if (id) await call('/disconnect', { session: id }); }
  catch { /* The connector may already have stopped. */ }
  disconnected('Disconnected');
});
tabs.forEach(tab => tab.addEventListener('click', () => {
  const local = tab.dataset.terminalMode === 'local';
  browserPanel.hidden = local;
  localPanel.hidden = !local;
  tabs.forEach(button => button.setAttribute('aria-pressed', String(button === tab)));
  resize();
}));
window.addEventListener('pagehide', () => {
  if (session) call('/disconnect', { session }, true).catch(() => {});
});
