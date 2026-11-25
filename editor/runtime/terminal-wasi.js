import { Directory, File, OpenFile } from './rust/wasi/index.js';
import { makeStdinReader } from './python/stdin.js';

const MAX_OUTPUT = 2 * 1024 * 1024;

export function writeFile(root, path, data, readonly = false) {
  const parts = path.slice(1).split('/');
  if (!path.startsWith('/') || parts.some(part => !part || part === '..' || part === '.')) {
    throw new Error('Invalid virtual file path.');
  }
  const filename = parts.pop();
  let parent = root;
  for (const part of parts) {
    const dir = parent.contents.get(part) || parent.create_entry_for_path(part, true).entry;
    if (!(dir instanceof Directory)) throw new Error('Conflicting virtual file path.');
    parent = dir;
  }
  parent.contents.set(filename, new File(data, { readonly }));
}

export class TerminalOutput {
  buffer = new Uint8Array(4096);
  length = 0;
  total = 0;
  previous = 0;
  lastFlush = 0;

  flush() {
    if (!this.length) return;
    const chunk = this.buffer.slice(0, this.length);
    this.length = 0;
    this.lastFlush = performance.now();
    postMessage({ chunk }, [chunk.buffer]);
  }

  enqueue(byte) {
    this.buffer[this.length++] = byte;
    if (this.length === this.buffer.length) this.flush();
  }

  write(bytes) {
    this.total += bytes.length;
    if (this.total > MAX_OUTPUT) throw new Error('The program exceeded the terminal output limit.');
    for (const byte of bytes) {
      if (byte === 10 && this.previous !== 13) this.enqueue(13);
      this.enqueue(byte);
      this.previous = byte;
    }
    if (!this.lastFlush || performance.now() - this.lastFlush > 16) this.flush();
  }
}

export class TerminalStdin extends OpenFile {
  constructor(buffer, output) {
    super(new File([]));
    this.input = makeStdinReader(buffer);
    this.output = output;
  }

  fd_read(length) {
    this.output.flush();
    return { ret: 0, data: this.input(length) };
  }
}
