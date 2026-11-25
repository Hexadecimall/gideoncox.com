// One request at a time, from the Ark worker to Zed's asynchronous filesystem.
export const RESPONSE_BYTES = 2 * 1024 * 1024;
const LENGTH_BYTES = Int32Array.BYTES_PER_ELEMENT;

export function createProjectChannel() {
  return new SharedArrayBuffer(LENGTH_BYTES + RESPONSE_BYTES);
}

export function projectChannel(buffer) {
  const length = new Int32Array(buffer, 0, 1);
  const bytes = new Uint8Array(buffer, LENGTH_BYTES);
  return {
    begin() { Atomics.store(length, 0, 0); },
    wait() {
      if (Atomics.wait(length, 0, 0, 10_000) === 'timed-out') return null;
      return bytes.subarray(0, Atomics.load(length, 0));
    },
    reply(data) {
      bytes.set(data);
      Atomics.store(length, 0, data.length);
      Atomics.notify(length, 0);
    },
  };
}
