import { recommendedModel } from './model-cache.js';

const MAX_QUEUED = 8;

export class BrowserLma {
  constructor(receive, createWorker = () => new Worker(new URL('./worker.js?v=wasm-simd-1', import.meta.url), { type: 'module' })) {
    this.receive = receive;
    this.createWorker = createWorker;
    this.queue = [];
    this.ready = false;
  }

  async selectModel() {
    const file = await new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.gguf';
      input.hidden = true;
      const finish = file => { input.remove(); resolve(file); };
      input.addEventListener('change', () => finish(input.files[0]), { once: true });
      input.addEventListener('cancel', () => finish(undefined), { once: true });
      document.body.append(input);
      input.click();
    });
    return file && this.loadModel(file);
  }

  async loadRecommendedModel() {
    if (this.active || this.loading || this.queue.length) {
      throw new Error('Finish the current LMA request first.');
    }
    return this.loadModel(await recommendedModel());
  }

  loadModel(file) {
    if (this.active || this.loading || this.queue.length) {
      return Promise.reject(new Error('Finish the current LMA request first.'));
    }
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      this.loading = { id, resolve, reject, name: file.name };
      try {
        this.workerForModel().postMessage({ type: 'load', id, file });
      } catch (error) {
        this.loading = undefined;
        reject(error);
      }
    });
  }

  start(id, options) {
    if (!this.ready || this.loading) throw new Error('Choose a GGUF model first.');
    if (this.queue.length >= MAX_QUEUED) throw new Error('LMA request queue is full.');
    this.queue.push({ ...options, type: 'complete', id });
    this.runNext();
  }

  cancel(id) {
    if (this.active?.id === id) {
      this.active.cancelled = true;
      this.worker.postMessage({ type: 'cancel', id });
    } else {
      this.queue = this.queue.filter(job => job.id !== id);
    }
  }

  workerForModel() {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    this.worker = worker;
    worker.addEventListener('message', ({ data }) => this.onMessage(data));
    worker.addEventListener('error', event => {
      event.preventDefault();
      this.onFailure(event.message || 'LMA stopped.');
    });
    worker.addEventListener('messageerror', () => this.onFailure('LMA returned an invalid response.'));
    return worker;
  }

  runNext() {
    if (this.active) return;
    this.active = this.queue.shift();
    if (this.active) this.worker.postMessage(this.active);
  }

  onMessage(data) {
    if (this.loading?.id === data.id) {
      const { resolve, reject, name } = this.loading;
      this.loading = undefined;
      this.ready = data.loaded === true;
      if (this.ready) resolve(name);
      else reject(new Error(data.error || 'LMA could not load the model.'));
      return;
    }
    if (this.active?.id !== data.id) return;
    if (!this.active.cancelled) this.receive(data.id, JSON.stringify(data));
    if (data.done || data.error) {
      this.active = undefined;
      this.runNext();
    }
  }

  onFailure(message) {
    this.worker?.terminate();
    this.worker = undefined;
    this.ready = false;
    this.loading?.reject(new Error(message));
    this.loading = undefined;
    const requests = this.active ? [this.active, ...this.queue] : this.queue;
    this.active = undefined;
    this.queue = [];
    for (const { id, cancelled } of requests) {
      if (!cancelled) this.receive(id, JSON.stringify({ error: message }));
    }
  }
}
