import { WASI, PreopenDirectory, ConsoleStdout } from '../rust/wasi/index.js';
import { TerminalOutput, TerminalStdin, writeFile } from '../terminal-wasi.js';

async function decompress(path, type) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok || !response.body) throw new Error(`Could not load ${path}.`);
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip')), {
    headers: { 'Content-Type': type },
  });
}

async function run({ cwd, script, files, stdin, programArgs = [] }, output) {
  const [module, stdlib] = await Promise.all([
    WebAssembly.compileStreaming(decompress('./python.wasm.gz?v=3.14.10', 'application/wasm')),
    decompress('./python314.zip.gz?v=3.14.10', 'application/zip').then(response => response.arrayBuffer()),
  ]);
  const root = new PreopenDirectory('/', new Map());
  writeFile(root.dir, '/usr/lib/python314.zip', stdlib, true);
  for (const [path, data] of files) writeFile(root.dir, path, data);

  const bootstrap = `import os, runpy, sys
cwd, script, *arguments = sys.argv[1:]
os.chdir(cwd)
sys.argv = [script, *arguments]
sys.path[0] = os.path.dirname(script)
runpy.run_path(script, run_name="__main__")`;
  const tty = new ConsoleStdout(bytes => output.write(bytes));
  const wasi = new WASI(['python3', '-B', '-u', '-c', bootstrap, cwd, script, ...programArgs], ['PYTHONHOME=/usr'], [
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
    postMessage({ code, ranProgram: true });
  } catch (error) {
    output.flush();
    postMessage({ error: error.message });
  } finally {
    self.close();
  }
}, { once: true });
