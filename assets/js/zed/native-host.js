function encode(bytes) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(text);
}

function decode(text) {
  return Uint8Array.from(atob(text), value => value.charCodeAt(0));
}

/** Platform IO for Zed. The native workspace and language tooling remain in Rust. */
export class NativeHostBridge {
  constructor(transport) {
    this.transport = transport;
    this.projectRoot = null;
    this.active = false;
    this.canRunProcesses = false;
    this.nativeInfo = null;
    this.processes = new Map();
  }

  async connect() {
    this.transport.opening++;
    try {
      await this.transport.ensurePaired('project');
      const info = await this.transport.call('/workspace/info');
      if (info.protocol < 3 || typeof info.root !== 'string' || !info.root.startsWith('/')) {
        throw new Error('Start the updated connector with --project to share a folder.');
      }
      const browserRoot = '/home/web';
      if (info.root === '/' || info.root === browserRoot || browserRoot.startsWith(info.root + '/') || info.root.startsWith(browserRoot + '/')) {
        throw new Error('This folder overlaps the browser workspace. Choose another folder.');
      }
      if (this.projectRoot && this.projectRoot !== info.root) {
        throw new Error('Reload Zed before connecting a different project.');
      }
      this.projectRoot = info.root;
      this.canRunProcesses = Boolean(info.processes);
      this.nativeInfo = info.native || null;
      this.active = true;
      this.transport.hostConnected = true;
      return this.projectRoot;
    } catch (error) {
      this.active = false;
      this.nativeInfo = null;
      this.transport.hostConnected = false;
      throw error;
    } finally {
      this.transport.opening--;
      this.transport.forgetIfUnused();
    }
  }

  requireConnection() {
    if (!this.active) throw new Error('Local project disconnected. Reconnect before accessing its files.');
  }

  async fs(operation, args = {}) {
    this.requireConnection();
    const body = { ...args, operation };
    if (operation === 'write') body.data = encode(new Uint8Array(args.data));
    const result = await this.transport.call('/workspace/fs', body);
    return operation === 'read' ? decode(result) : result;
  }

  async processOpen(options) {
    this.requireConnection();
    if (!this.canRunProcesses) throw new Error('Restart the connector with --allow-processes to run development tools.');
    const result = await this.transport.call('/process/open', options);
    this.processes.set(result.id, { queue: Promise.resolve(), read: null });
    return result;
  }

  async processRead(id) {
    this.requireConnection();
    const process = this.processes.get(id);
    if (!process) throw new Error('Process disconnected.');
    if (!process.read) {
      process.read = this.transport.call('/process/read', { id }).then(async result => {
        const stdout = decode(result.stdout || '');
        const stderr = decode(result.stderr || '');
        if (result.ended) this.processes.delete(id);
        else if (!stdout.length && !stderr.length) await new Promise(resolve => setTimeout(resolve, 30));
        return { ...result, stdout, stderr };
      }).catch(async error => {
        await this.processClose(id);
        throw error;
      }).finally(() => { process.read = null; });
    }
    return process.read;
  }

  enqueue(id, operation) {
    this.requireConnection();
    const process = this.processes.get(id);
    if (!process) return Promise.reject(new Error('Process disconnected.'));
    const next = process.queue.then(() => {
      if (!this.processes.has(id)) throw new Error('Process disconnected.');
      return operation();
    });
    process.queue = next.catch(() => {});
    return next;
  }

  processWrite(id, bytes) {
    const data = new Uint8Array(bytes).slice();
    return this.enqueue(id, async () => {
      let lastProgress = performance.now();
      for (let offset = 0; offset < data.length;) {
        this.requireConnection();
        if (!this.processes.has(id)) throw new Error('Process disconnected.');
        const chunk = data.subarray(offset, offset + 32768);
        const result = await this.transport.call('/process/write', { id, data: encode(chunk) });
        // Older protocol-3 connectors acknowledge only complete writes.
        const written = result.written ?? chunk.length;
        if (!Number.isInteger(written) || written < 0 || written > chunk.length) {
          throw new Error('Invalid process write acknowledgement.');
        }
        offset += written;
        if (written) lastProgress = performance.now();
        else {
          if (performance.now() - lastProgress > 30000) throw new Error('Process input is busy.');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    });
  }

  processEndInput(id) {
    return this.enqueue(id, () => this.transport.call('/process/end-input', { id }));
  }

  async processKill(id) {
    this.requireConnection();
    if (!this.processes.has(id)) return;
    await this.transport.call('/process/kill', { id });
  }

  async processClose(id, keepalive = false) {
    if (!this.processes.delete(id)) return;
    try { await this.transport.call('/process/close', { id }, keepalive); }
    catch { /* A stopped connector already closed its children. */ }
  }

  async disconnect(keepalive = false) {
    this.active = false;
    this.nativeInfo = null;
    await Promise.all([...this.processes.keys()].map(id => this.processClose(id, keepalive)));
    this.transport.hostConnected = false;
    this.transport.forgetIfUnused();
    // Keep the mount identity: disconnected host paths must never become browser files.
  }
}

export function installNativeHost(transport) {
  const host = new NativeHostBridge(transport);
  globalThis.zedHost = {
    connected: () => host.active,
    root: () => host.projectRoot,
    nativeInfo: () => host.active ? host.nativeInfo : null,
    connect: () => host.connect(),
    disconnect: () => host.disconnect(),
    fs: (operation, args) => host.fs(operation, args),
    processOpen: options => host.processOpen(options),
    processRead: id => host.processRead(id),
    processWrite: (id, bytes) => host.processWrite(id, bytes),
    processEndInput: id => host.processEndInput(id),
    processKill: id => host.processKill(id),
    processClose: id => host.processClose(id),
  };
  window.addEventListener('pagehide', () => host.disconnect(true));
  return host;
}
