const MAX_PENDING = 8;
const TIMEOUT = 30_000;

export class BrowserGit {
  constructor(makeWorker = () => new Worker('/editor/runtime/git/worker.js?v=1', { type: 'module' })) {
    this.makeWorker = makeWorker;
    this.pending = new Map();
    this.nextId = 0;
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

  request(entries, operations) {
    if (this.pending.size >= MAX_PENDING) return Promise.reject(new Error('Too many browser Git requests are running.'));
    this.worker ??= this.start();
    const id = ++this.nextId;
    const buffers = new Set();
    for (const [, bytes] of entries) {
      if (bytes) buffers.add(bytes.buffer);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stop(new Error('The browser Git worker did not respond.')), TIMEOUT);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.worker.postMessage({ id, entries, operations }, [...buffers]);
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }
}
