// A small binary protocol keeps the Rust module independent of browser APIs.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export function pack(values) {
  const strings = values.map(value => encoder.encode(String(value)));
  const bytes = new Uint8Array(4 + strings.reduce((size, text) => size + 4 + text.length, 0));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, strings.length, true);
  let offset = 4;
  for (const text of strings) {
    view.setUint32(offset, text.length, true);
    bytes.set(text, offset + 4);
    offset += 4 + text.length;
  }
  return bytes;
}
export function unpack(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = [];
  let offset = 4;
  for (let count = view.getUint32(0, true); count; count--) {
    const length = view.getUint32(offset, true);
    offset += 4;
    values.push(decoder.decode(bytes.subarray(offset, offset + length)));
    offset += length;
  }
  return values;
}

export class Files {
  constructor(module) { this.api = new WebAssembly.Instance(module).exports; }
  call(name, values = []) {
    const bytes = pack(values);
    const pointer = this.api.runtime_input(bytes.length);
    new Uint8Array(this.api.memory.buffer).set(bytes, pointer);
    this.api[name]();
    return unpack(new Uint8Array(this.api.memory.buffer, this.api.runtime_output(), this.api.runtime_output_len()));
  }
  request(action, ...args) {
    const [code, ...values] = this.call('runtime_files', [action, ...args]);
    if (code !== '0') throw new Error(values[0]);
    return values;
  }
  command(args, input) {
    const [out, err, code, cwd, action] = this.call('runtime_command', [input, ...args]);
    return { out, err, code: Number(code), cwd, action };
  }
  snapshot() { return this.call('runtime_snapshot'); }
  restore(values) {
    const [code, error] = this.call('runtime_restore', values);
    if (code !== '0') throw new Error(error);
  }
}

export class Ark {
  constructor(module, host) { this.module = module; this.host = host; this.reset(); }
  reset() {
    let response = new Uint8Array();
    const memory = () => new Uint8Array(this.api.memory.buffer);
    const view = () => new DataView(this.api.memory.buffer);
    const home = encoder.encode('HOME=/home/web\0');
    this.api = new WebAssembly.Instance(this.module, {
      wasi_snapshot_preview1: {
        fd_close: () => 8,
        fd_seek: () => 8,
        fd_write: (_fd, _iov, _count, written) => { view().setUint32(written, 0, true); return 8; },
        environ_sizes_get: (count, size) => { view().setUint32(count, 1, true); view().setUint32(size, home.length, true); return 0; },
        environ_get: (entries, buffer) => { view().setUint32(entries, buffer, true); memory().set(home, buffer); return 0; },
        proc_exit: code => { throw new Error(`Ark stopped (${code})`); },
      },
      ark_host: {
        error: (pointer, length, line, col, incomplete) => {
          const error = new Error(`${decoder.decode(memory().subarray(pointer, pointer + length))} (${line}:${col})`);
          error.incomplete = Boolean(incomplete);
          throw error;
        },
        call: (kind, pointer, length) => {
          const text = decoder.decode(memory().subarray(pointer, pointer + length));
          response = kind === 0 ? encoder.encode(this.host.capture(text)) : pack(this.host.glob(text));
          return response.length;
        },
        copy: pointer => memory().set(response, pointer),
      },
    }).exports;
    this.api._initialize();
  }
  call(name, bytes, ...args) {
    try {
      const pointer = this.api.ark_input(bytes.length);
      new Uint8Array(this.api.memory.buffer).set(bytes, pointer);
      this.api[name](...args);
      return JSON.parse(decoder.decode(new Uint8Array(this.api.memory.buffer, this.api.ark_output(), this.api.ark_output_len())));
    } catch (error) {
      // Host exceptions cannot unwind C++ frames. Discard that instance so a
      // malformed command never leaves its stack or allocator in a bad state.
      this.reset();
      throw error;
    }
  }
  parse(source) { return this.call('ark_parse', encoder.encode(source)); }
  expand(words, env, args, status, single = false) {
    const entries = Object.entries(env);
    const encodedEnv = pack(entries.flat());
    new DataView(encodedEnv.buffer).setUint32(0, entries.length, true);
    const pieces = [encodedEnv, pack(args), pack(words)];
    const bytes = new Uint8Array(pieces.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of pieces) { bytes.set(part, offset); offset += part.length; }
    return this.call('ark_expand', bytes, Number(single), status);
  }
}
