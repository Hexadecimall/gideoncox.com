import { BrowserShellBridge } from './browser-shell.js?v=python-argv-1';
import { BrowserTerminalProject } from './terminal-project.js?v=1';

const ENDPOINT = 'http://127.0.0.1:8770';
const INPUT_CHUNK = 32768;

function encode(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function decode(text) {
  return Uint8Array.from(atob(text), character => character.charCodeAt(0));
}

/** Authenticated PTY transport. Zed owns the terminal grid, rendering and input. */
export class NativeTerminalBridge {
  constructor(pair, request = fetch) {
    this.pair = pair;
    this.request = request;
    this.token = '';
    this.pairing = null;
    this.opening = 0;
    this.sessions = new Map();
    this.hostConnected = false;
  }

  async call(path, body, keepalive = false) {
    const response = await this.request(ENDPOINT + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store', credentials: 'omit', targetAddressSpace: 'loopback',
      signal: AbortSignal.timeout(5000), keepalive,
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) this.token = '';
      const error = new Error(result.error || `Connector error ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return result;
  }

  forgetIfUnused() {
    if (!this.sessions.size && !this.opening && !this.hostConnected) this.token = '';
  }

  async ensurePaired(purpose = 'terminal') {
    if (!this.token) {
      if (!this.pairing) this.pairing = this.pair(purpose).finally(() => { this.pairing = null; });
      this.token = await this.pairing;
      if (!this.token) throw new Error('Connection canceled.');
    }
  }

  async open({ columns, rows, cwd, command, args, env }) {
    if (typeof cwd === 'string' && cwd.startsWith('/browser-folders/')) {
      throw new Error('The local connector cannot run commands in a browser-selected folder.');
    }
    this.opening++;
    try {
      await this.ensurePaired();
      const result = await this.call('/connect', { columns, rows, cwd, command, args, env, encoding: 'base64' });
      if (result.protocol !== 2 || result.encoding !== 'base64') {
        if (result.session) await this.call('/disconnect', { session: result.session }).catch(() => {});
        throw new Error('Update the local connector to use Zed terminals.');
      }
      this.sessions.set(result.session, { queue: Promise.resolve(), reading: null });
      return result.session;
    } catch (error) {
      if (error instanceof TypeError) throw new Error('Connector unreachable at 127.0.0.1:8770.');
      throw error;
    } finally {
      this.opening--;
      this.forgetIfUnused();
    }
  }

  async read(id) {
    const session = this.sessions.get(id);
    if (!session) return { data: new Uint8Array(), ended: true };
    if (!session.reading) {
      session.reading = this.call(`/output?session=${encodeURIComponent(id)}`).then(async result => {
        if (!this.sessions.has(id)) return { data: new Uint8Array(), ended: true };
        const data = decode(result.data || '');
        if (result.ended) {
          this.sessions.delete(id);
          this.forgetIfUnused();
        } else if (!data.length) {
          await new Promise(resolve => setTimeout(resolve, 60));
        }
        return { data, ended: Boolean(result.ended), exitCode: result.exitCode ?? null, signal: result.signal ?? null };
      }).catch(async error => {
        await this.close(id);
        throw error;
      }).finally(() => { session.reading = null; });
    }
    return session.reading;
  }

  enqueue(id, operation) {
    const session = this.sessions.get(id);
    if (!session) return Promise.reject(new Error('Terminal disconnected.'));
    const next = session.queue.then(() => {
      if (this.sessions.has(id)) return operation();
    });
    session.queue = next.catch(() => {});
    return next;
  }

  write(id, bytes) {
    // Copy before awaiting: the caller's buffer may live in WebAssembly memory.
    const data = new Uint8Array(bytes).slice();
    return this.enqueue(id, async () => {
      for (let offset = 0; offset < data.length && this.sessions.has(id); offset += INPUT_CHUNK) {
        await this.call('/input', { session: id, data: encode(data.subarray(offset, offset + INPUT_CHUNK)) });
      }
    });
  }

  resize(id, { columns, rows }) {
    return this.enqueue(id, () => this.call('/resize', { session: id, columns, rows }));
  }

  async close(id, keepalive = false) {
    if (!this.sessions.delete(id)) return;
    try { await this.call('/disconnect', { session: id }, keepalive); }
    catch { /* A stopped connector already closed its PTYs. */ }
    finally { this.forgetIfUnused(); }
  }
}

function pair(purpose = 'terminal') {
  const dialog = document.createElement('dialog');
  dialog.className = 'browser-file-dialog terminal-pair-dialog';
  dialog.setAttribute('aria-labelledby', 'terminal-pair-title');
  dialog.innerHTML = `
    <form method="dialog">
      <h2 id="terminal-pair-title">Connect terminal</h2>
      <p>Commands run on this computer through the local Ark connector. A folder shared with --project can be edited directly; --allow-processes also enables development tools. Browser-only files stay in the browser.</p>
      <details><summary>Connector setup</summary>
        <p>Requires Ark and Python 3.9+ on macOS, Linux, or WSL.</p>
        <p><a href="/connector/ark_connector.py" download>Download connector</a>, then run:</p>
        <pre>python3 ark_connector.py</pre>
      </details>
      <label>Pairing token<input name="token" type="password" autocomplete="off" spellcheck="false" required></label>
      <div class="dialog-actions"><button type="button">Cancel</button><button type="submit">Connect</button></div>
    </form>`;
  if (location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname)) {
    dialog.querySelector('pre').textContent += ` --origin ${location.origin}`;
  }
  if (purpose === 'project') {
    dialog.querySelector('h2').textContent = 'Connect project';
    dialog.querySelector('pre').textContent += ' --project . --allow-processes';
  }
  document.body.append(dialog);
  return new Promise((resolve, reject) => {
    let token = '';
    const input = dialog.querySelector('input');
    dialog.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      token = input.value.trim();
      if (token) dialog.close();
    });
    dialog.querySelector('button[type=button]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      input.value = '';
      dialog.remove();
      if (token) resolve(token);
      else reject(new Error('Connection canceled.'));
    }, { once: true });
    dialog.showModal();
    input.focus();
  });
}

export function terminalTransport(bridge, browser, shell) {
  const route = id => browser?.owns(id) ? browser : shell.owns(id) ? shell : bridge;
  return {
    open: options => {
      if (browser?.accepts(options)) return browser.open(options);
      if (BrowserShellBridge.accepts(options)) return shell.open(options);
      if (options.command === 'ark-connector') {
        const { cwd } = options;
        const browserCwd = BrowserShellBridge.accepts({ cwd });
        return bridge.open({ ...options, cwd: browserCwd ? null : cwd, command: null, args: [] });
      }
      return bridge.open(options);
    },
    read: id => route(id).read(id),
    write: (id, data) => route(id).write(id, data),
    resize: (id, size) => route(id).resize?.(id, size),
    close: id => route(id).close(id),
  };
}

export function installNativeTerminal(browser = null, zed = null) {
  const bridge = new NativeTerminalBridge(pair);
  const shell = new BrowserShellBridge(undefined, zed && new BrowserTerminalProject(zed), browser);
  globalThis.zedNativeTerminal = terminalTransport(bridge, browser, shell);
  window.addEventListener('pagehide', () => {
    for (const id of [...bridge.sessions.keys()]) bridge.close(id, true);
    for (const id of browser?.sessions.keys() ?? []) browser.close(id);
    for (const id of shell.sessions.keys()) shell.close(id);
  });
  return bridge;
}
