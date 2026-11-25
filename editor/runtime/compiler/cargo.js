import { Directory, OpenDirectory, PreopenDirectory, wasi } from '../rust/wasi/index.js';
import { writeFile } from '../terminal-wasi.js';
import { loadArchive, loadModule } from './assets.js';
import { MAX_TOOL_BYTES } from './cargo-imports.js?v=registry-1';
import { CargoRegistry } from './cargo-registry.js?v=1';
import { loadRustToolchain, RUST_ENV, runRustTool } from './rustc.js?v=clippy-1';

const PROJECT = '/workspace';
const BUILD = '/build';
const TARGET = 'wasm32-wasip1';
const HOST = 'wasm32-wasip1-threads';
const CARGO = '/toolchain/bin/cargo';
const RUSTC = '/toolchain/bin/rustc';
const CLIPPY = 'clippy-driver.wasm.gz';
const REGISTRY_SOURCE = '/cargo-home/registry/src/';
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const CARGO_ENV = [
  'HOME=/cargo-home', 'CARGO_HOME=/cargo-home', `PWD=${PROJECT}`, 'TMPDIR=/tmp',
  'PATH=/toolchain/bin', `RUSTC=${RUSTC}`, `CARGO=${CARGO}`,
  'CARGO_BUILD_JOBS=1', 'CARGO_INCREMENTAL=0', 'CARGO_CACHE_AUTO_CLEAN_FREQUENCY=never',
];

function lookup(root, path) {
  let entry = root;
  for (const segment of path.split('/').filter(Boolean)) {
    if (!(entry instanceof Directory) || segment === '.' || segment === '..') return;
    entry = entry.contents.get(segment);
  }
  return entry;
}

export function findCargoManifest(directory, source) {
  const parts = source.split('/');
  parts.pop();
  while (parts.length) {
    const path = `${parts.join('/')}/Cargo.toml`;
    if (lookup(directory, path)?.data) return path;
    parts.pop();
  }
  if (lookup(directory, 'Cargo.toml')?.data) return 'Cargo.toml';
}

function readlink(path) {
  const { ret } = this.path_lookup(path, 0);
  // The project snapshot has files and directories. WASI libc realpath
  // expects EINVAL when an existing entry is not a symbolic link.
  return { ret: ret || wasi.ERRNO_INVAL, data: null };
}

function openPath(...args) {
  const result = OpenDirectory.prototype.path_open.call(this, ...args);
  if (result.fd_obj instanceof OpenDirectory) {
    result.fd_obj.path_readlink = readlink;
    result.fd_obj.path_open = openPath;
  }
  return result;
}

function mount(name, directory) {
  const preopen = new PreopenDirectory(name, new Map());
  preopen.dir = directory;
  preopen.path_readlink = readlink;
  preopen.path_open = openPath;
  return preopen;
}

function capture(limit = MAX_TOOL_BYTES) {
  const chunks = [];
  let length = 0;
  let truncated = false;
  return {
    write(bytes) {
      const remaining = limit - length;
      if (bytes.length > remaining) truncated = true;
      if (remaining <= 0) return;
      const chunk = bytes.slice(0, remaining);
      chunks.push(chunk);
      length += chunk.length;
    },
    take() {
      if (truncated) throw new Error('Cargo tool output exceeded the buffer limit.');
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    },
  };
}

function processEnvironment(entries, cwd, compiler) {
  const values = [...CARGO_ENV, ...entries, ...(compiler ? RUST_ENV : [])];
  const env = new Map(values.map(pair => [pair.split('=', 1)[0], pair]));
  env.set('PWD', `PWD=${cwd}`);
  // The WASI port uses in-process LLD. Its std::env::split_paths panics
  // when the driver tries to read a native linker search path.
  if (compiler) env.delete('PATH');
  return [...env.values()];
}

function failure(message, code = 1) {
  return { code, stdout: [], stderr: Array.from(ENCODER.encode(message + '\n')) };
}

async function runProcess(wasmModule, root, request, args, versionProbe = false) {
  const cwd = request.cwd || PROJECT;
  const directory = lookup(root, cwd);
  if (!(directory instanceof Directory) || (cwd !== PROJECT && !cwd.startsWith(PROJECT + '/')
    && !cwd.startsWith(REGISTRY_SOURCE))) {
    return failure('Cargo subprocess working directory is outside the project and Cargo registry.');
  }

  const out = capture();
  const err = capture();
  let code;
  try {
    code = await runRustTool({
      wasmModule, args, env: processEnvironment(request.env, cwd, request.program === RUSTC),
      stdin: request.stdin,
      directories: [mount('.', directory), ...[PROJECT, BUILD, '/sysroot', '/tmp', '/cargo-home']
        .map(name => mount(name, lookup(root, name)))],
      stdout: out.write, stderr: err.write,
    });
  } catch (error) {
    const stderr = DECODER.decode(err.take());
    if (versionProbe && stderr.includes('Failed finding sysroot: "current_dll_path not supported"')) {
      // The driver writes its version and host before a failing optional
      // LLVM version query. Cargo requires only the fields already emitted.
      const stdout = out.take();
      if (/^rustc [^\n]+\nbinary: rustc\n[\s\S]*\nhost: wasm32-wasip1-threads\nrelease: [^\n]+\n$/
        .test(DECODER.decode(stdout))) return { code: 0, stdout: Array.from(stdout), stderr: [] };
    }
    if (!stderr) return failure(error.message);
    code = 1;
  }
  return { code, stdout: Array.from(out.take()), stderr: Array.from(err.take()) };
}

function rustcOption(args, name) {
  const index = args.indexOf(name);
  const prefix = name + '=';
  return index === -1
    ? args.find(arg => arg.startsWith(prefix))?.slice(prefix.length)
    : args[index + 1];
}

async function runCompiler(compiler, root, request, loadHostLibraries, command = [RUSTC]) {
  const versionProbe = request.args.length === 1 && request.args[0] === '-vV';
  const args = [...command, ...request.args];
  if (!versionProbe) {
    args.push('--sysroot', '/sysroot', '-Zthreads=1', '-Ccodegen-units=1');
    const target = rustcOption(request.args, '--target');
    if ((!target || target === HOST) && rustcOption(request.args, '--emit')) {
      await loadHostLibraries();
      args.push('-Clinker=wasm-ld', '-Clinker-flavor=wasm-ld');
      if (rustcOption(request.args, '--crate-type') === 'bin') {
        args.push('-Clink-arg=--wrap=__main_void',
          `-Clink-arg=/sysroot/lib/rustlib/${HOST}/lib/self-contained/cargo-build-start.o`);
      }
    }
  }
  return runProcess(compiler, root, request, args, versionProbe);
}

async function runBuildScript(root, request) {
  const path = request.program;
  const name = path.slice(BUILD.length + 1);
  // Cargo's build-script aliases can omit the .wasm suffix. Resolve either
  // spelling only inside the compiler's temporary build tree.
  if (!path.startsWith(BUILD + '/') || !/^[^/]+\/build\/[^/]+\/build[-_]script[-_][^/]+$/.test(name)) {
    return failure(`Cargo subprocess ${path} is unavailable in this browser build.`, 127);
  }
  const binary = (lookup(root, path) ?? lookup(root, path + '.wasm'))?.data;
  if (!binary?.length || binary.length > 16 * 1024 * 1024) {
    return failure(`Cargo build script executable is missing or exceeds 16 MB: ${path}`, 126);
  }
  const module = await WebAssembly.compile(binary);
  return runProcess(module, root, request, [path, ...request.args]);
}

function packageTarget(metadata, manifest, source) {
  const packages = metadata.packages.filter(item => metadata.workspace_members.includes(item.id));
  const member = packages.find(item => item.manifest_path === manifest);
  const candidates = (member ? [member] : packages).flatMap(pkg => pkg.targets
    .filter(target => target.kind.includes('bin'))
    .map(target => ({ pkg, target })));
  const exact = candidates.find(({ target }) => target.src_path === source);
  const preferred = member?.default_run && candidates.find(({ target }) => target.name === member.default_run);
  if (exact || preferred) return exact || preferred;
  if (candidates.length === 1) return candidates[0];
  throw new Error(candidates.length
    ? 'Open the entry file of the Cargo binary to run.'
    : 'This Cargo project has no binary target to run.');
}

function messages(bytes) {
  const result = [];
  for (const line of DECODER.decode(bytes).split('\n')) {
    if (line[0] === '{') result.push(JSON.parse(line));
  }
  return result;
}

function compilerMessage(line) {
  line = line.trimStart();
  if (!line.startsWith('{')) return null;
  try {
    const message = JSON.parse(line);
    return typeof message?.$message_type === 'string' ? message : null;
  } catch { return null; }
}

function collectDiagnostics(stderr, directory, diagnostics) {
  if (!stderr.length || (directory !== PROJECT && !directory.startsWith(PROJECT + '/'))) return;
  for (const line of DECODER.decode(Uint8Array.from(stderr)).split('\n')) {
    if (diagnostics.length >= 400) break;
    const message = compilerMessage(line);
    if (message?.$message_type !== 'diagnostic' || !message.spans?.some(span => span.is_primary)) continue;
    const { level, code, spans, message: text } = message;
    diagnostics.push({ directory, message: { level, code: { code: code?.code }, spans, message: text } });
  }
}

function cargoTerminalOutput(output) {
  const decoder = new TextDecoder();
  let pending = '';
  function forward(line, ending) {
    const message = compilerMessage(line);
    if (message?.$message_type === 'diagnostic' && typeof message.rendered === 'string') {
      output.write(ENCODER.encode(message.rendered));
    } else if (!['artifact', 'future_incompat'].includes(message?.$message_type)) {
      output.write(ENCODER.encode(line + ending));
    }
  }
  return {
    write(bytes) {
      const lines = (pending + decoder.decode(bytes, { stream: true })).split('\n');
      pending = lines.pop();
      for (const line of lines) forward(line, '\n');
      if (pending.length > MAX_TOOL_BYTES) {
        forward(pending, '');
        pending = '';
      }
    },
    finish() {
      pending += decoder.decode();
      if (pending) forward(pending, '');
    },
  };
}

function buildScriptOutput(root, cargoMessages) {
  const manifests = new Map();
  const scriptOutputs = new Map();
  for (const message of cargoMessages) {
    if (message.reason === 'compiler-artifact' && message.manifest_path?.startsWith(PROJECT + '/')) {
      manifests.set(message.package_id, message.manifest_path.slice(PROJECT.length + 1));
    } else if (message.reason === 'build-script-executed' && message.out_dir?.startsWith(BUILD + '/')) {
      if (!scriptOutputs.has(message.package_id) || message.out_dir.startsWith(`${BUILD}/${TARGET}/`)) {
        scriptOutputs.set(message.package_id, message);
      }
    }
  }
  const packages = [];
  let remainingBytes = 4 * 1024 * 1024;
  let remainingFiles = 1024;
  function copyFiles(directory, prefix, files) {
    for (const [name, entry] of directory.contents) {
      if (!remainingFiles || remainingBytes <= 0) break;
      const path = prefix + name;
      if (entry instanceof Directory) copyFiles(entry, path + '/', files);
      else if (entry.data && entry.data.length <= remainingBytes) {
        files.push([path, entry.data]);
        remainingFiles--;
        remainingBytes -= entry.data.length;
      }
    }
  }
  for (const message of scriptOutputs.values()) {
    const manifest = manifests.get(message.package_id);
    const out = lookup(root, message.out_dir);
    if (!manifest || !(out instanceof Directory)) continue;
    const files = [];
    copyFiles(out, '', files);
    packages.push({ manifest, outDir: message.out_dir, cfg: message.cfgs, env: message.env, files });
  }
  return { manifests: [...new Set(manifests.values())], packages };
}

function compilerWorkspace(directory, sysroot) {
  return new Directory(new Map([
    ['workspace', directory], ['sysroot', sysroot.dir], ['build', new Directory(new Map())],
    ['tmp', new Directory(new Map())], ['cargo-home', new Directory(new Map())],
  ]));
}

export async function checkRustFile(directory, source, output) {
  const compiler = await loadRustToolchain(CLIPPY);
  const root = compilerWorkspace(directory, compiler.sysroot);
  const diagnostics = [];
  const result = await runCompiler(compiler.wasmModule, root, {
    program: RUSTC, cwd: PROJECT, env: [`CLIPPY_CONF_DIR=${PROJECT}`],
    args: ['--edition=2021', '--target', TARGET, '-Cpanic=abort', '--emit=metadata',
      '--error-format=json', `${PROJECT}/${source}`, '-o', `${BUILD}/program.rmeta`],
  }, undefined, ['clippy-driver']);
  collectDiagnostics(result.stderr, PROJECT, diagnostics);
  const stderr = cargoTerminalOutput(output);
  stderr.write(Uint8Array.from(result.stderr));
  stderr.finish();
  return { code: result.code, diagnostics };
}

export async function compileCargo(directory, manifest, source, output, { clippy = false } = {}) {
  const [cargoModule, compiler] = await Promise.all([
    loadModule('cargo.wasm.gz'), loadRustToolchain(clippy ? CLIPPY : undefined),
  ]);
  const root = compilerWorkspace(directory, compiler.sysroot);
  // Cargo resolves these absolute paths before asking the worker to launch a
  // process. The runtime only executes the bundled WebAssembly compiler.
  writeFile(root, CARGO, [], true);
  writeFile(root, RUSTC, [], true);
  const path = `${PROJECT}/${manifest}`;
  const registry = new CargoRegistry();
  const diagnostics = [];
  let hostLibraries;
  const loadHostLibraries = () => hostLibraries ??= loadArchive('rust-host-sysroot.tar.gz').then(archive => {
    for (const [name, bytes] of archive) writeFile(compiler.sysroot.dir, '/' + name, bytes, true);
  });

  const cargo = async args => {
    const stdout = capture(2 * MAX_TOOL_BYTES);
    const stderr = cargoTerminalOutput(output);
    const code = await runRustTool({
      wasmModule: cargoModule, args: [CARGO, ...args, '--manifest-path', path], env: CARGO_ENV,
      directories: [mount('.', directory), mount('/', root)], stdout: stdout.write,
      stderr: stderr.write,
      spawn: async request => {
        try {
          if (request.kind === 'registry') return await registry.begin(request);
          if (request.kind === 'registry-chunk') return registry.chunk(request);
          if (request.program === RUSTC) {
            // Keep dependency compilation and Cargo's probes in upstream
            // clippy-driver's rustc mode so a check loads only one compiler.
            const lint = clippy && rustcOption(request.args, '--target') === TARGET
              && request.env.some(entry => entry.startsWith('CARGO_PRIMARY_PACKAGE='));
            const command = clippy ? ['clippy-driver', ...(lint ? [] : ['--rustc'])] : undefined;
            const result = await runCompiler(compiler.wasmModule, root, request, loadHostLibraries, command);
            collectDiagnostics(result.stderr, request.cwd || PROJECT, diagnostics);
            return result;
          }
          return await runBuildScript(root, request);
        }
        catch (error) { return failure(error.message); }
      },
    }).finally(stderr.finish);
    return { code, stdout: stdout.take() };
  };

  let selected;
  if (!clippy) {
    const metadata = await cargo(['metadata', '--no-deps', '--format-version', '1']);
    if (metadata.code) return { code: metadata.code };
    const project = messages(metadata.stdout).find(entry => Array.isArray(entry.packages));
    if (!project) throw new Error('Cargo did not return workspace metadata.');
    selected = packageTarget(project, path, `${PROJECT}/${source}`);
  }
  const build = await cargo([
    ...(selected ? ['build', '--package', selected.pkg.name, '--bin', selected.target.name] : ['check']), '--target', TARGET,
    '--target-dir', BUILD, '--message-format=json-render-diagnostics', '-j1',
  ]);
  let executable;
  const cargoMessages = messages(build.stdout);
  for (const message of cargoMessages) {
    if (message.reason === 'compiler-message' && message.message.rendered) {
      output.write(ENCODER.encode(message.message.rendered));
    } else if (selected && message.reason === 'compiler-artifact' && message.target.src_path === selected.target.src_path) {
      executable = message.executable;
    }
  }
  if (build.code) return { code: build.code, diagnostics };
  const buildOutput = buildScriptOutput(root, cargoMessages);
  if (clippy) return { code: 0, diagnostics, buildOutput };
  const binary = executable?.startsWith(BUILD + '/') && lookup(root, executable)?.data;
  if (!binary?.length) throw new Error('Cargo produced no WebAssembly executable.');
  return { code: 0, binary, executable: selected.target.name, diagnostics, buildOutput };
}
