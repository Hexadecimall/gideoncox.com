// Single-writer terminal input buffer shared with a blocking WASI worker.
const SIZE = 65_536;
const WORDS = 4;
const TAIL = 0;
const HEAD = 1;
const FINISHED = 2;
const CHANGE = 3;

export function createStdin() {
  const buffer = new SharedArrayBuffer(WORDS * Int32Array.BYTES_PER_ELEMENT + SIZE);
  const state = new Int32Array(buffer, 0, WORDS);
  const data = new Uint8Array(buffer, state.byteLength);

  function wake() {
    Atomics.add(state, CHANGE, 1);
    Atomics.notify(state, CHANGE);
  }

  return {
    buffer,
    write(bytes) {
      if (Atomics.load(state, FINISHED)) return false;
      const tail = Atomics.load(state, TAIL) >>> 0;
      const used = (tail - (Atomics.load(state, HEAD) >>> 0)) >>> 0;
      if (bytes.length > SIZE - used) return false;
      const offset = tail % SIZE;
      const first = Math.min(bytes.length, SIZE - offset);
      data.set(bytes.subarray(0, first), offset);
      data.set(bytes.subarray(first), 0);
      Atomics.store(state, TAIL, tail + bytes.length);
      wake();
      return true;
    },
    close() {
      Atomics.store(state, FINISHED, 1);
      wake();
    },
  };
}

export function makeStdinReader(buffer) {
  const state = new Int32Array(buffer, 0, WORDS);
  const data = new Uint8Array(buffer, state.byteLength);

  return length => {
    if (!length) return new Uint8Array();
    while (true) {
      const change = Atomics.load(state, CHANGE);
      const head = Atomics.load(state, HEAD) >>> 0;
      const available = ((Atomics.load(state, TAIL) >>> 0) - head) >>> 0;
      if (available) {
        const count = Math.min(length, available);
        const offset = head % SIZE;
        const first = Math.min(count, SIZE - offset);
        const result = new Uint8Array(count);
        result.set(data.subarray(offset, offset + first));
        result.set(data.subarray(0, count - first), first);
        Atomics.store(state, HEAD, head + count);
        return result;
      }
      if (Atomics.load(state, FINISHED)) return new Uint8Array();
      Atomics.wait(state, CHANGE, change);
    }
  };
}
