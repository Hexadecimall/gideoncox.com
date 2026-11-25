import { WASI, Directory, File, OpenFile, PreopenDirectory, ConsoleStdout } from '../rust/wasi/index.js';
import { makeStdinReader } from './stdin.js';

const MAX_OUTPUT = 2 * 1024 * 1024;

async function decompress(path, type) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok || !response.body) throw new Error(`Could not load ${path}.`);
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip')), {
    headers: { 'Content-Type': type },
  });
}

function writeFile(root, path, data, readonly = false) {
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

class TerminalOutput {
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
    if (this.total > MAX_OUTPUT) throw new Error('Python exceeded the output limit.');
    for (const byte of bytes) {
      if (byte === 10 && this.previous !== 13) this.enqueue(13);
      this.enqueue(byte);
      this.previous = byte;
    }
    if (!this.lastFlush || performance.now() - this.lastFlush > 16) this.flush();
  }
}

class TerminalStdin extends OpenFile {
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

async function run({ cwd, script, files, stdin }, output) {
  const [module, stdlib] = await Promise.all([
    WebAssembly.compileStreaming(decompress('./python.wasm.gz?v=3.14.10', 'application/wasm')),
    decompress('./python314.zip.gz?v=3.14.10', 'application/zip').then(response => response.arrayBuffer()),
  ]);
  const root = new PreopenDirectory('/', new Map());
  writeFile(root.dir, '/usr/lib/python314.zip', stdlib, true);
  for (const [path, data] of files) writeFile(root.dir, path, data);

  const bootstrap = `import os, runpy, sys
cwd, script = sys.argv[1:3]
os.chdir(cwd)
sys.argv = [script]
sys.path[0] = os.path.dirname(script)
runpy.run_path(script, run_name="__main__")`;
  const tty = new ConsoleStdout(bytes => output.write(bytes));
  const wasi = new WASI(['python3', '-B', '-u', '-c', bootstrap, cwd, script], ['PYTHONHOME=/usr'], [
    new TerminalStdin(stdin, output), tty, tty, root,
  ]);
  const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });
  return wasi.start(instance);
}

self.addEventListener('message', async ({ data }) => {
  const output = new TerminalOutput();
  try {
    const code = await run(data, output);
    output.flush();
    postMessage({ code });
  } catch (error) {
    output.flush();
    postMessage({ error: error.message });
  } finally {
    self.close();
  }
}, { once: true });
