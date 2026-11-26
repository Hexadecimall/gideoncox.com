import loadClangd from './clangd.js?v=21.1.0-2';
import { LspFrames, lspFrame } from '/assets/js/zed/lsp-stream.js';
import { projectBuildFlags } from './build-flags.js';

const responses = new LspFrames();
const output = new Uint8Array(16384);
const pending = [];
let clangd;
let outputLength = 0;
let stdinOffset = 0;
let wakeStdin;
let flushQueued = false;

function flush() {
  flushQueued = false;
  if (!outputLength) return;
  for (const message of responses.push(output.subarray(0, outputLength))) {
    postMessage({ type: 'lsp', message });
  }
  outputLength = 0;
}

function writeStdin(message) {
  const frame = lspFrame(message);
  const newline = frame.indexOf(10) + 1;
  // The upstream transport awaits stdin separately for the header, blank line and body.
  pending.push(frame.subarray(0, newline), frame.subarray(newline, newline + 2), frame.subarray(newline + 2));
  wakeStdin?.();
  wakeStdin = undefined;
}

async function start({ root, files, module }) {
  clangd = await loadClangd({
    thisProgram: '/usr/bin/clangd',
    wasmMemory: new WebAssembly.Memory({ initial: 4096, maximum: 16384, shared: true }),
    instantiateWasm(imports, receive) {
      receive(new WebAssembly.Instance(module, imports), module);
    },
    onAbort(error) { postMessage({ type: 'failed', message: String(error) }); },
    async stdinReady() {
      if (!pending.length) await new Promise(resolve => { wakeStdin = resolve; });
    },
    stdin() {
      const input = pending[0];
      if (!input) return null;
      if (stdinOffset === input.length) {
        pending.shift();
        stdinOffset = 0;
        return null;
      }
      return input[stdinOffset++];
    },
    stdout(byte) {
      if (!flushQueued) {
        flushQueued = true;
        queueMicrotask(flush);
      }
      output[outputLength++] = byte;
      if (outputLength === output.length) flush();
    },
    stderr() {},
  });
  clangd.FS.mkdirTree(root);
  for (const [path, bytes] of files) updateFile(path, bytes);
  const buildFlags = projectBuildFlags(root, files);
  if (buildFlags) updateFile(`${root}/.clangd`, buildFlags);
  clangd.FS.chdir(root);
  postMessage({ type: 'ready' });
  clangd.callMain(['--log=error', '--background-index=false', '--pch-storage=memory', '-j=2']);
}

function updateFile(path, bytes) {
  if (bytes === null) {
    if (clangd.FS.analyzePath(path).exists) clangd.FS.unlink(path);
    return;
  }
  clangd.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
  clangd.FS.writeFile(path, bytes);
}

addEventListener('message', async ({ data }) => {
  try {
    if (data.type === 'start') await start(data);
    else if (data.type === 'file') updateFile(data.path, data.bytes);
    else if (data.type === 'lsp') writeStdin(data.message);
  } catch (error) {
    postMessage({ type: 'failed', message: error?.message || String(error) });
  }
});
