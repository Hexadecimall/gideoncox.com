import {
  deleteModel, hasCachedModel, installedModels, installModel, modelFiles, recommendedModel, searchModels,
} from './model-cache.js?v=model-download-3';
import { DesktopLma } from './desktop.js?v=library-1';
import { downloadWarning, memoryWarning } from './resource-warning.js?v=1';

const MAX_QUEUED = 8;
const IDLE_MODEL_MS = 120_000;
const SELECTED_MODEL = 'zed.lma.selected-model';
const version = new URL(import.meta.url).search;

export class BrowserLma {
  constructor(receive, createWorker = () => new Worker(new URL(`./worker.js${version}`, import.meta.url), { type: 'module' }), warn) {
    this.receive = receive;
    this.createWorker = createWorker;
    this.warn = warn;
    this.queue = [];
    this.ready = false;
    this.desktop = new DesktopLma(receive);
  }

  async manage(operation, input) {
    switch (operation) {
      case 'search': return searchModels(input);
      case 'files': return modelFiles(input);
      case 'library': return installedModels();
      case 'install': {
        this.warnAbout(await downloadWarning(input?.bytes));
        await installModel(input);
        return installedModels();
      }
      case 'use': return this.loadRecommendedModel(input);
      case 'remove': {
        this.checkModelSwitch();
        this.downloading = true;
        try {
          await deleteModel(input);
          if (this.selectedModel === input) {
            this.onFailure('The installed model was removed.');
            this.selectedModel = undefined;
            try { globalThis.localStorage?.removeItem(SELECTED_MODEL); } catch { /* optional storage */ }
          }
        } finally {
          this.downloading = false;
        }
        return installedModels();
      }
      case 'connect': return this.desktop.connect(input.url, input.key);
      case 'disconnect': this.desktop.disconnect(); return [];
      default: throw new Error('Unknown model library action.');
    }
  }

  warnAbout(message) {
    if (!message) return;
    try { this.warn?.(message); } catch { /* Advisory only. */ }
  }

  async selectModel() {
    const files = await new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.gguf';
      input.multiple = true;
      input.hidden = true;
      const finish = file => { input.remove(); resolve(file); };
      input.addEventListener('change', () => finish(Array.from(input.files)), { once: true });
      input.addEventListener('cancel', () => finish(undefined), { once: true });
      document.body.append(input);
      input.click();
    });
    return files?.length ? this.loadModel(files) : undefined;
  }

  async loadRecommendedModel(kind = 'coder') {
    this.checkModelSwitch();
    if (this.ready && this.loadedModel?.kind === kind) return this.loadedModel.name;
    this.downloading = true;
    let file;
    try {
      file = await recommendedModel(kind);
    } finally {
      this.downloading = false;
    }
    return this.loadModel(file, kind);
  }

  loadModel(file, modelKind) {
    this.checkModelSwitch();
    return this.replaceModel(file, modelKind);
  }

  checkModelSwitch() {
    if (this.active || this.loading || this.downloading || this.restoring || this.queue.length) {
      throw new Error('Finish the current LMA request first.');
    }
  }

  async restoreModel() {
    try {
      const saved = globalThis.localStorage?.getItem(SELECTED_MODEL);
      if (saved && await hasCachedModel(saved) && !this.ready && !this.loading && !this.downloading) {
        this.selectedModel = saved;
        return saved;
      }
    } catch {
      // A manually selected model can still be used when browser storage is blocked.
    }
  }

  replaceModel(file, modelKind) {
    const files = Array.isArray(file) ? [...file].sort((left, right) => left.name.localeCompare(right.name)) : [file];
    this.warnAbout(memoryWarning(files.reduce((bytes, member) => bytes + member.size, 0)));
    // WebAssembly memory cannot shrink. A fresh worker releases the old model's heap.
    clearTimeout(this.idleTimer);
    this.worker?.terminate();
    this.worker = undefined;
    this.loadedModel = undefined;
    this.ready = false;
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      this.loading = { id, resolve, reject, name: files[0].name, kind: modelKind };
      try {
        this.workerForModel().postMessage({ type: 'load', id, files, modelKind });
      } catch (error) {
        this.loading = undefined;
        reject(error);
      }
    });
  }

  start(id, options) {
    if (options.desktopModel !== undefined) {
      this.desktop.start(id, options);
      return;
    }
    if (!this.restoring && (this.loading || this.downloading)) throw new Error('LMA is loading a model.');
    if (!this.ready && !this.selectedModel) throw new Error('Choose a GGUF model first.');
    if (this.queue.length >= MAX_QUEUED) throw new Error('LMA request queue is full.');
    clearTimeout(this.idleTimer);
    this.queue.push({ ...options, type: 'complete', id });
    this.runNext();
  }

  cancel(id) {
    if (this.desktop.cancel(id)) return;
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
    worker.addEventListener('message', ({ data }) => {
      if (this.worker === worker) this.onMessage(data);
    });
    worker.addEventListener('error', event => {
      event.preventDefault();
      if (this.worker === worker) this.onFailure(event.message || 'LMA stopped.');
    });
    worker.addEventListener('messageerror', () => {
      if (this.worker === worker) this.onFailure('LMA returned an invalid response.');
    });
    return worker;
  }

  runNext() {
    if (this.active || this.restoring || !this.queue.length) return;
    if (!this.ready) {
      this.restoring = true;
      const kind = this.selectedModel;
      recommendedModel(kind, { download: false })
        .then(file => this.queue.length ? this.replaceModel(file, kind) : undefined)
        .catch(error => this.onFailure(error.message))
        .finally(() => {
          this.restoring = false;
          this.runNext();
        });
      return;
    }
    this.active = this.queue.shift();
    try {
      this.worker.postMessage(this.active);
    } catch (error) {
      this.onFailure(error.message);
    }
  }

  releaseIdleModel() {
    if (!this.ready || !this.selectedModel || this.active || this.queue.length) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.worker?.terminate();
      this.worker = undefined;
      this.loadedModel = undefined;
      this.ready = false;
    }, IDLE_MODEL_MS);
    this.idleTimer.unref?.();
  }

  onMessage(data) {
    if (this.loading?.id === data.id) {
      const { resolve, reject, name, kind } = this.loading;
      this.loading = undefined;
      this.ready = data.loaded === true;
      if (this.ready) {
        this.loadedModel = { name, kind };
        this.selectedModel = kind;
        try {
          if (kind) globalThis.localStorage?.setItem(SELECTED_MODEL, kind);
          else globalThis.localStorage?.removeItem(SELECTED_MODEL);
        } catch {
          // Storage permissions only affect restoration after reload.
        }
        resolve(name);
        this.releaseIdleModel();
      }
      else reject(new Error(data.error || 'LMA could not load the model.'));
      return;
    }
    if (this.active?.id !== data.id) return;
    if (!this.active.cancelled) this.receive(data.id, JSON.stringify(data));
    if (data.done || data.error) {
      this.active = undefined;
      this.runNext();
      this.releaseIdleModel();
    }
  }

  onFailure(message) {
    clearTimeout(this.idleTimer);
    this.worker?.terminate();
    this.worker = undefined;
    this.loadedModel = undefined;
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
