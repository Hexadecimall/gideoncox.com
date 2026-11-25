import { Directory, Fd, File, OpenFile, PreopenDirectory, ConsoleStdout } from './wasi/index.js';
import { WASIFarm, wait_async_polyfill } from './wasi-threads.js';
import { browserRustProject, SYSROOT } from './project.js';
import { LspFrames, applyDocumentChanges, documentReplacement, lspFrame } from '/assets/js/zed/lsp-stream.js?v=document-edits-1';
import { createRustfmt, rustfmtConfig } from './rustfmt/format.js?v=1';

const TARGET = 'wasm32-wasip1';
const encoder = new TextEncoder();
const input = [];
const documents = new Map();
const formatRust = createRustfmt();
let waiting;
let rootPath;
let projectFiles;
const standardFiles = new Map();
let filesystem;
let settings;
let projectSignature;
let toolchain;
let initializeId;

function readStdin(length) {
  if (!length) return [];
  if (!input.length) return new Promise(resolve => { waiting = () => resolve(readStdin(length)); });
  const bytes = input[0].subarray(0, length);
  if (bytes.length === input[0].length) input.shift();
  else input[0] = input[0].subarray(bytes.length);
  return Array.from(bytes);
}

function send(message) {
  input.push(lspFrame(message));
  const callback = waiting;
  waiting = null;
  callback?.();
}

function fileParts(root, path, create) {
  const parts = path.slice(1).split('/');
  const name = parts.pop();
  let directory = root;
  for (const part of parts) {
    let child = directory.contents.get(part);
    if (!child && create) {
      child = directory.create_entry_for_path(part, true).entry;
    }
    if (!(child instanceof Directory)) return null;
    directory = child;
  }
  return { directory, name };
}

function writeFile(path, bytes) {
  const parent = fileParts(filesystem, path, bytes !== null);
  if (!parent) return;
  if (bytes === null) parent.directory.contents.delete(parent.name);
  else parent.directory.contents.set(parent.name, new File(bytes));
}

class Output extends Fd {
  constructor() {
    super();
    this.frames = new LspFrames();
  }

  fd_write(bytes) {
    for (const message of this.frames.push(bytes)) {
      if (message.method === 'workspace/configuration' && message.id !== undefined) {
        const result = message.params.items.map(item => item.section === 'rust-analyzer' ? settings : null);
        send({ jsonrpc: '2.0', id: message.id, result });
      } else {
        if (message.id === initializeId && message.result?.capabilities) {
          message.result.capabilities.documentFormattingProvider = true;
        }
        postMessage({ type: 'lsp', message });
      }
    }
    return { ret: 0, nwritten: bytes.length };
  }
}

function copySnapshot({ list, path, output, capacity }, memory) {
  const files = path === SYSROOT || path.startsWith(SYSROOT + '/') ? standardFiles : projectFiles;
  const bytes = list
    ? encoder.encode([...files.keys()].filter(key => key.startsWith(path + '/')).join('\0'))
    : files.get(path);
  if (!bytes) return -1;
  if (!output) return bytes.byteLength;
  if (bytes.byteLength > capacity || output + bytes.byteLength > memory.buffer.byteLength) return -1;
  new Uint8Array(memory.buffer, output, bytes.byteLength).set(bytes);
  return bytes.byteLength;
}

function toolQuery(args) {
  const [command, ...options] = args;
  const [first, second, third, fourth] = options;
  let stdout;
  if (command === 'rustc') {
    if (first === '-vV') stdout = toolchain.verboseVersion;
    else if (first === '--version') stdout = toolchain.version;
    else if (first === '--print' && second === 'cfg') stdout = toolchain.cfg;
    else if (first === '-Z' && second === 'unstable-options' && third === '--print' && fourth === 'target-spec-json') {
      stdout = toolchain.targetSpec;
    } else if (first === '--print' && second === 'sysroot') stdout = '/toolchain/rust\n';
  }
  if (stdout !== undefined) return { status: 0, stdout };
  return { status: 127, stderr: 'This tool command is unavailable in the browser workspace.' };
}

function rustSettings(previous = {}) {
  const project = browserRustProject(projectFiles, rootPath);
  projectSignature = JSON.stringify(project);
  return {
    ...previous,
    linkedProjects: [project],
    numThreads: 2,
    cargo: { ...previous?.cargo, sysroot: null, target: TARGET, buildScripts: { enable: false } },
    procMacro: { enable: false },
    checkOnSave: false,
    cachePriming: { enable: false },
  };
}

function refreshProject() {
  if (!settings) return;
  const previous = projectSignature;
  settings = rustSettings(settings);
  if (projectSignature !== previous) {
    send({ jsonrpc: '2.0', method: 'workspace/didChangeConfiguration', params: { settings } });
  }
}

async function formatDocument(request) {
  const { uri } = request.params.textDocument;
  const text = documents.get(uri);
  const reply = response => postMessage({ type: 'lsp', message: { jsonrpc: '2.0', id: request.id, ...response } });
  if (text === undefined) { reply({ result: null }); return; }
  try {
    const path = decodeURIComponent(new URL(uri).pathname);
    const files = request.formatFiles ? new Map(request.formatFiles) : projectFiles;
    const config = rustfmtConfig(files, rootPath, path, request.params.options);
    const formatted = await formatRust(text, config);
    if (documents.get(uri) !== text) {
      reply({ error: { code: -32801, message: 'The document changed during formatting.' } });
    } else reply({ result: documentReplacement(text, formatted) });
  } catch (error) {
    reply({ error: { code: -32603, message: error.message } });
  }
}

function handleLsp(message) {
  if (message.method === 'initialize') {
    initializeId = message.id;
    settings = rustSettings(message.params.initializationOptions);
    message.params.initializationOptions = settings;
  } else if (message.method === 'workspace/didChangeConfiguration') {
    settings = rustSettings(message.params?.settings);
    message.params = { settings };
  } else if (message.method === 'textDocument/didOpen') {
    const { uri, text } = message.params.textDocument;
    documents.set(uri, text);
  } else if (message.method === 'textDocument/didChange') {
    const { uri } = message.params.textDocument;
    const text = documents.get(uri);
    if (text !== undefined) documents.set(uri, applyDocumentChanges(text, message.params.contentChanges));
  } else if (message.method === 'textDocument/didClose') {
    documents.delete(message.params.textDocument.uri);
  } else if (message.method === 'textDocument/formatting') {
    return formatDocument(message);
  }
  send(message);
}

async function decompressed(filename, mime) {
  const response = await fetch(new URL(filename, import.meta.url));
  if (!response.ok || !response.body) throw new Error(`Could not load ${filename}.`);
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip')), {
    headers: { 'Content-Type': mime },
  });
}

async function start(root, files) {
  rootPath = root;
  projectFiles = new Map(files);
  const preopen = new PreopenDirectory('/', new Map());
  filesystem = preopen.dir;
  const [wasmModule, stdlib] = await Promise.all([
    WebAssembly.compileStreaming(decompressed('./rust-analyzer.wasm.gz?v=1', 'application/wasm')),
    decompressed('./sysroot.json.gz?v=1', 'application/json').then(response => response.json()),
  ]);
  toolchain = stdlib.info;
  for (const [name, source] of Object.entries(stdlib.source)) {
    const path = `${SYSROOT}/${name}`;
    const bytes = encoder.encode(source);
    standardFiles.set(path, bytes);
    writeFile(path, bytes);
  }
  for (const [path, bytes] of projectFiles) writeFile(path, bytes);
  wait_async_polyfill();
  const memory = new WebAssembly.Memory({ initial: 1024, maximum: 16384, shared: true });
  const stderr = ConsoleStdout.lineBuffered(line => {
    if (line.includes('thread caused non-unwinding panic')) {
      postMessage({ type: 'failed', message: 'A rust-analyzer thread panicked.' });
    }
  });
  const farm = new WASIFarm(new OpenFile(new File([])), new Output(), stderr, [preopen], {
      unknown_fn(message) {
        if (message.type === 'read') return readStdin(message.length);
        if (message.type === 'snapshot') return copySnapshot(message, memory);
        if (message.type === 'tool' && Array.isArray(message.args)) return toolQuery(message.args);
        return { status: 127 };
      },
    },
  );
  const server = new Worker(new URL('./analyzer.js', import.meta.url), { type: 'module' });
  server.onmessage = ({ data }) => {
    if (data.type === 'ready') postMessage(data);
    if (data.type === 'failed' || data.type === 'exit') {
      farm.destroy();
      server.terminate();
      postMessage({ type: 'failed', message: data.message || `rust-analyzer exited with status ${data.code}.` });
    }
  };
  server.onerror = error => {
    farm.destroy();
    server.terminate();
    postMessage({ type: 'failed', message: error.message || 'rust-analyzer could not start.' });
  };
  server.postMessage({ type: 'start', wasiRef: farm.get_ref(), wasmModule, memory });
}

addEventListener('message', async ({ data }) => {
  try {
    if (data.type === 'start') await start(data.root, data.files);
    else if (data.type === 'lsp') await handleLsp(data.message);
    else if (data.type === 'file') {
      const wasPresent = projectFiles.has(data.path);
      if (data.bytes === null) projectFiles.delete(data.path);
      else projectFiles.set(data.path, data.bytes);
      writeFile(data.path, data.bytes);
      if (wasPresent !== (data.bytes !== null) || /\/(?:Cargo.toml|rust-project.json)$/.test(data.path)) {
        refreshProject();
      }
    }
  } catch (error) {
    postMessage({ type: 'failed', message: error?.message ?? String(error) });
  }
});
