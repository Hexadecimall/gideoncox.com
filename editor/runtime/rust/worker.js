import { Directory, Fd, File, OpenFile, PreopenDirectory, ConsoleStdout } from './wasi/index.js';
import { WASIFarm, wait_async_polyfill } from './wasi-threads.js';
import { browserRustProject, SYSROOT } from './project.js?v=build-output-1';
import { LspFrames, applyDocumentChanges, documentReplacement, lspFrame } from '/assets/js/zed/lsp-stream.js?v=document-edits-1';
import { createRustfmt, rustfmtConfig } from './rustfmt/format.js?v=1';
import { filePath, fileUri, RustDiagnostics } from './diagnostics.js?v=quickfix-1';

const TARGET = 'wasm32-wasip1';
const GENERATED = '/zed-generated';
const encoder = new TextEncoder();
const input = [];
const documents = new Map();
const documentVersions = new Map();
const codeActionRequests = new Map();
const formatRust = createRustfmt();
let waiting;
let rootPath;
let projectFiles;
const standardFiles = new Map();
const generatedFiles = new Map();
const buildOutputs = new Map();
let buildRevision = 0;
let filesystem;
let settings;
let clippyOnSave = false;
let projectSignature;
let toolchain;
let initializeId;

const publish = message => postMessage({ type: 'lsp', message });
const diagnostics = new RustDiagnostics(publish, uri => documents.get(uri) ?? projectFiles?.get(filePath(uri)),
  uri => documentVersions.get(uri));

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
      } else if (message.method === 'textDocument/publishDiagnostics') {
        diagnostics.fromAnalyzer(message);
      } else {
        if (message.id === initializeId && message.result?.capabilities) {
          message.result.capabilities.documentFormattingProvider = true;
        }
        const request = message.method === undefined && codeActionRequests.get(message.id);
        if (request) {
          codeActionRequests.delete(message.id);
          diagnostics.quickFixes(request).then(fixes => {
            if (!fixes.length) publish(message);
            else publish({ jsonrpc: '2.0', id: message.id, result: [...(message.result ?? []), ...fixes] });
          }).catch(() => publish(message));
        } else publish(message);
      }
    }
    return { ret: 0, nwritten: bytes.length };
  }
}

function copySnapshot({ list, path, output, capacity }, memory) {
  let files = projectFiles;
  if (path === SYSROOT || path.startsWith(SYSROOT + '/')) files = standardFiles;
  else if (path === GENERATED || path.startsWith(GENERATED + '/')) files = generatedFiles;
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
  const project = browserRustProject(projectFiles, rootPath, buildOutputs);
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

function applySettings(options) {
  clippyOnSave = options?.checkOnSave !== false
    && (options?.check?.command ?? options?.checkOnSave?.command) === 'clippy';
  return rustSettings(options);
}

function updateBuildOutput(packages) {
  if (!packages.length && !buildOutputs.size) return;
  buildRevision++;
  buildOutputs.clear();
  generatedFiles.clear();
  filesystem.contents.delete(GENERATED.slice(1));
  for (const [index, output] of packages.entries()) {
    if (!projectFiles.has(output.manifest)) continue;
    const outDir = `${GENERATED}/${buildRevision}/${index}`;
    const translate = value => {
      if (value === output.outDir || value.startsWith(output.outDir + '/')) {
        return outDir + value.slice(output.outDir.length);
      }
      if (value === '/workspace' || value.startsWith('/workspace/')) {
        return output.root + value.slice('/workspace'.length);
      }
      return value;
    };
    const env = Object.fromEntries(output.env.map(([name, value]) => [name, translate(value)]));
    buildOutputs.set(output.manifest, { env: { ...env, OUT_DIR: outDir }, cfg: output.cfg });
    for (const [file, bytes] of output.files) {
      const path = `${outDir}/${file}`;
      generatedFiles.set(path, bytes);
      writeFile(path, bytes);
    }
  }
  refreshProject();
}

async function formatDocument(request) {
  const { uri } = request.params.textDocument;
  const path = filePath(uri);
  const key = fileUri(path);
  const text = documents.get(key);
  const reply = response => postMessage({ type: 'lsp', message: { jsonrpc: '2.0', id: request.id, ...response } });
  if (text === undefined) { reply({ result: null }); return; }
  try {
    const files = request.formatFiles ? new Map(request.formatFiles) : projectFiles;
    const config = rustfmtConfig(files, rootPath, path, request.params.options);
    const formatted = await formatRust(text, config);
    if (documents.get(key) !== text) {
      reply({ error: { code: -32801, message: 'The document changed during formatting.' } });
    } else reply({ result: documentReplacement(text, formatted) });
  } catch (error) {
    reply({ error: { code: -32603, message: error.message } });
  }
}

function handleLsp(message) {
  if (message.method === 'initialize') {
    initializeId = message.id;
    settings = applySettings(message.params.initializationOptions);
    message.params.initializationOptions = settings;
  } else if (message.method === 'initialized') {
    diagnostics.initialize();
  } else if (message.method === 'workspace/didChangeConfiguration') {
    const options = message.params?.settings;
    settings = options && typeof options === 'object' && ('check' in options || 'checkOnSave' in options)
      ? applySettings(options) : rustSettings(options);
    message.params = { settings };
  } else if (message.method === 'textDocument/didOpen') {
    const { uri, text, version } = message.params.textDocument;
    const key = fileUri(filePath(uri));
    documents.set(key, text);
    documentVersions.set(key, version);
    diagnostics.verify(key).catch(() => {});
  } else if (message.method === 'textDocument/didChange') {
    const { uri, version } = message.params.textDocument;
    const key = fileUri(filePath(uri));
    const text = documents.get(key);
    if (text !== undefined) documents.set(key, applyDocumentChanges(text, message.params.contentChanges));
    documentVersions.set(key, version);
    diagnostics.invalidate(key);
  } else if (message.method === 'textDocument/didClose') {
    const key = fileUri(filePath(message.params.textDocument.uri));
    documents.delete(key);
    documentVersions.delete(key);
  } else if (message.method === 'textDocument/didSave' && clippyOnSave) {
    const path = filePath(message.params.textDocument.uri);
    if (path?.endsWith('.rs')) postMessage({ type: 'clippy-on-save', path });
  } else if (message.method === 'textDocument/formatting') {
    return formatDocument(message);
  } else if (message.method === 'textDocument/codeAction') {
    codeActionRequests.set(message.id, message.params);
    if (codeActionRequests.size > 64) codeActionRequests.delete(codeActionRequests.keys().next().value);
  } else if (message.method === '$/cancelRequest') {
    codeActionRequests.delete(message.params?.id);
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
    else if (data.type === 'build-output') updateBuildOutput(data.packages);
    else if (data.type === 'cargo-diagnostics') await diagnostics.replace(data.files);
    else if (data.type === 'file') {
      const wasPresent = projectFiles.has(data.path);
      if (data.bytes === null) projectFiles.delete(data.path);
      else projectFiles.set(data.path, data.bytes);
      writeFile(data.path, data.bytes);
      diagnostics.verify(fileUri(data.path)).catch(() => {});
      if (wasPresent !== (data.bytes !== null) || /\/(?:Cargo.toml|rust-project.json)$/.test(data.path)) {
        refreshProject();
      }
    }
  } catch (error) {
    postMessage({ type: 'failed', message: error?.message ?? String(error) });
  }
});
