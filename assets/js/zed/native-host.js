import { isBrowserProject } from './paths.js?v=local-folders-1';
import { LocalFolders } from './local-folders.js?v=git-remotes-1';

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
    this.activeRoot = null;
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
      if (info.root === '/browser-folders' || info.root.startsWith('/browser-folders/')) {
        throw new Error('This folder overlaps a browser folder mount. Choose another folder.');
      }
      if (this.projectRoot && this.projectRoot !== info.root) {
        throw new Error('Reload Zed before connecting a different project.');
      }
      this.projectRoot = info.root;
      this.activeRoot = info.root;
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

export function installNativeHost(transport, ...browserServices) {
  const host = new NativeHostBridge(transport);
  const folders = new LocalFolders();
  globalThis.zedLocalFolders = folders;
  host.folders = folders;
  host.openLocalFolder = async () => {
    const root = await folders.pick();
    host.activeRoot = root;
    return root;
  };
  host.reopenLocalFolder = async record => {
    const root = await folders.reauthorize(record);
    host.activeRoot = root;
    return root;
  };
  host.restoreLocalFolder = async () => {
    const root = await folders.restore();
    if (root) host.activeRoot = root;
    return root;
  };
  const processOwner = id => browserServices.find(service => service.owns(id)) ?? host;
  globalThis.zedHost = {
    // WASM uses this to check that a process service is available. Native
    // filesystem access still requires a paired, explicitly mounted root.
    connected: () => host.active || folders.mounts.size > 0 || browserServices.length > 0,
    root: () => host.activeRoot,
    nativeInfo: () => host.active ? host.nativeInfo : null,
    connect: () => host.connect(),
    disconnect: () => host.disconnect(),
    fs: async (operation, args) => {
      if (operation === 'watch') {
        const paths = await folders.drainChanges();
        if (host.active) {
          const native = await host.fs(operation, args).catch(error => {
            if (!paths.length) throw error;
            return [];
          });
          paths.push(...(native.paths ?? native));
        }
        return { paths };
      }
      const source = folders.rootFor(args.path ?? args.source);
      const target = folders.rootFor(args.target);
      if (source || target) {
        if (operation === 'copy' && (!source || !target)) throw new Error('Copy within browser-selected folders only.');
        return folders.fs(operation, args);
      }
      return host.fs(operation, args);
    },
    processOpen: options => {
      const service = browserServices.find(service => service.accepts(options));
      if (service) return service.processOpen(options);
      if (isBrowserProject(options.cwd) || folders.rootFor(options.cwd)) {
        throw new Error('This command is not available in browser projects.');
      }
      return host.processOpen(options);
    },
    processRead: id => processOwner(id).processRead(id),
    processWrite: (id, bytes) => processOwner(id).processWrite(id, bytes),
    processEndInput: id => processOwner(id).processEndInput(id),
    processKill: id => processOwner(id).processKill(id),
    processClose: id => processOwner(id).processClose(id),
  };
  window.addEventListener('pagehide', () => {
    folders.stopWatching();
    for (const service of browserServices) service.close();
    host.disconnect(true);
  });
  return host;
}
