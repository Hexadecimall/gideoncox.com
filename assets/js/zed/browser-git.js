const MAX_PENDING = 8;
const TIMEOUT = 30_000;
const decoder = new TextDecoder();
const pathDecoder = new TextDecoder('utf-8', { fatal: true });
const READ_OPERATIONS = new Set([
  'head', 'status', 'branches', 'show', 'read-index', 'read-head', 'read-tree', 'read-blob',
  'resolve', 'diff', 'diff-stat', 'blame-revision', 'blame-buffer', 'history',
  'search-commits', 'read-commit', 'commit-files',
  'remotes', 'branch-remote', 'stash-list',
]);

function needsOnlyTrackedContents(operations) {
  return operations.length > 0 && operations.every(([operation, range]) =>
    operation === 'status' || (operation === 'diff' || operation === 'diff-stat') && range === 'index-worktree');
}

export class BrowserGit {
  constructor(makeWorker = () => new Worker('/editor/runtime/git/worker.js?v=git-stash-1', { type: 'module' })) {
    this.makeWorker = makeWorker;
    this.pending = new Map();
    this.nextId = 0;
    this.folderSnapshots = 0;
  }

  start() {
    const worker = this.makeWorker();
    worker.addEventListener('message', ({ data }) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id);
      clearTimeout(request.timer);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data);
    });
    worker.addEventListener('error', event => {
      event.preventDefault();
      this.stop(new Error(event.message || 'The browser Git worker stopped.'));
    });
    worker.addEventListener('messageerror', () => this.stop(new Error('Could not read the browser Git worker response.')));
    return worker;
  }

  stop(error) {
    this.worker?.terminate();
    this.worker = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  async trackedPaths(snapshot) {
    const config = snapshot.find(([name]) => name === '.git/config')?.[1];
    // Custom ignore rules, worktree configuration, and included config files can
    // refer to arbitrary paths that need their real contents in the snapshot.
    if (config && /excludesfile|include|worktree|objectformat/i.test(decoder.decode(config))) return undefined;
    const index = snapshot.find(([name]) => name === '.git/index')?.[1];
    if (!index) return new Set();
    const { results: [paths] } = await this.send([['.git/index', index.slice()]], [['index-paths']], null);
    if (paths === null) return undefined;
    try { return new Set(pathDecoder.decode(paths).split('\0').filter(Boolean)); }
    catch { return undefined; }
  }

  async requestSelectedFolder(root, includeTree, operations, input) {
    if (operations.some(([operation]) => !READ_OPERATIONS.has(operation))) {
      throw new Error('Git changes to folders opened from disk are unavailable.');
    }
    if (this.pending.size + this.folderSnapshots >= MAX_PENDING) {
      throw new Error('Too many browser Git requests are running.');
    }
    const folders = globalThis.zedLocalFolders;
    if (!folders) throw new Error('Open a local folder before reading its Git history.');
    this.folderSnapshots++;
    let entries;
    try {
      const selectContents = includeTree && needsOnlyTrackedContents(operations)
        ? snapshot => this.trackedPaths(snapshot) : undefined;
      const configOnly = !includeTree && operations.every(([operation]) =>
        operation === 'remotes' || operation === 'branch-remote');
      entries = await folders.gitSnapshot(root, includeTree, { selectContents, configOnly });
    } finally {
      this.folderSnapshots--;
    }
    return this.request(entries, operations, input);
  }

  request(entries, operations, input = null) {
    if (this.pending.size + this.folderSnapshots >= MAX_PENDING) return Promise.reject(new Error('Too many browser Git requests are running.'));
    return this.send(entries, operations, input);
  }

  send(entries, operations, input) {
    this.worker ??= this.start();
    const id = ++this.nextId;
    const buffers = new Set();
    if (input) buffers.add(input.buffer);
    for (const [, bytes] of entries) {
      if (bytes) buffers.add(bytes.buffer);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stop(new Error('The browser Git worker did not respond.')), TIMEOUT);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.worker.postMessage({ id, entries, operations, input }, [...buffers]);
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }
}
