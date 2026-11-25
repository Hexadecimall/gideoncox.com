// Exercise shipped browser workers in Node with their WebAssembly engines.
import { MessageChannel, MessagePort, parentPort, workerData, Worker } from 'node:worker_threads';

export class WorkerHost {
  constructor(url) {
    this.thread = new Worker(new URL(import.meta.url), {
      workerData: url.toString(),
      stdout: true,
      stderr: true,
    });
    this.thread.stdout.resume();
    this.thread.stderr.resume();
    this.thread.on('message', data => this.onmessage?.({ data }));
    this.thread.on('messageerror', error => this.onmessageerror?.(error));
  }

  set onerror(listener) {
    if (this.handleError) this.thread.off('error', this.handleError);
    this.handleError = listener;
    if (listener) this.thread.on('error', listener);
  }

  addEventListener(type, listener) {
    if (type === 'message') this.thread.on(type, data => listener({ data }));
    else if (type === 'error') this.thread.on(type, error => listener({
      message: error.message,
      preventDefault() {},
    }));
    else this.thread.on(type, listener);
  }

  postMessage(message, transfer) { this.thread.postMessage(message, transfer); }
  terminate() { return this.thread.terminate(); }
}

if (parentPort) {
  Object.assign(globalThis, {
    self: globalThis,
    location: new URL(workerData),
    Worker: WorkerHost,
    MessageChannel,
    MessagePort,
    name: '',
    postMessage: (message, transfer) => parentPort.postMessage(message, transfer),
    addEventListener: (type, listener) => parentPort.on(type, data => listener({ data })),
    close: () => parentPort.close(),
  });
  await import(workerData);
  parentPort.on('message', data => globalThis.onmessage?.({ data }));
}
