import { ConsoleStdout, File, OpenFile, PreopenDirectory, wasi as errno } from '../rust/wasi/index.js';
import WASI from '../rust/wasi/wasi.js?v=utf8-argv-1';
import { TerminalOutput, TerminalStdin, writeFile } from '../terminal-wasi.js';
import { loadArchive, loadModule } from './assets.js';

const CC_OUTPUT = '/.zed-compiler';
const SOURCE = /\.(?:c|C|cc|cpp|cxx|c\+\+|CPP)$/;
const SKIP_SOURCES = new Set(['.zed', '.zed-build', 'build', 'dist', 'vendor', 'tests', 'test']);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const linuxStartup = encoder.encode(`
extern int main(void);
__attribute__((weak,noreturn)) void _start(void) {
    long code = main();
    __asm__ volatile ("syscall" : : "a"(60L), "D"(code) : "rcx", "r11", "memory");
    __builtin_unreachable();
}
`);

function print(output, message) {
  output.write(encoder.encode(message + '\n'));
}

async function runTool(module, args, mounts, output, stdin, stdout) {
  const tty = new ConsoleStdout(bytes => output.write(bytes));
  tty.fd_pwrite = () => ({ ret: errno.ERRNO_SPIPE, nwritten: 0 });
  const input = stdin ? new TerminalStdin(stdin, output) : new OpenFile(new File([]));
  const wasi = new WASI(args, [], [input, stdout ?? tty, tty, ...mounts], { debug: false });
  const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });
  return wasi.start(instance);
}

function addArchive(directory, archive) {
  for (const [path, bytes] of archive) writeFile(directory, '/' + path, bytes, true);
}

function relative(cwd, path) {
  if (!path.startsWith(cwd + '/')) throw new Error('File is outside the browser project.');
  return path.slice(cwd.length + 1);
}

function projectDirectory(cwd, files) {
  const project = new PreopenDirectory('.', new Map());
  for (const [path, bytes] of files) writeFile(project.dir, '/' + relative(cwd, path), bytes);
  return project;
}

function readSettings({ cwd, files }) {
  const path = '.zed/browser-build.json';
  const file = files.find(([name]) => name === `${cwd}/${path}`);
  if (!file) return {};
  const contents = decoder.decode(file[1]).trim();
  if (!contents) return {};
  let settings;
  try {
    settings = JSON.parse(contents);
  } catch {
    throw new Error(`${path} must contain valid JSON.`);
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error(`${path} must contain a JSON object.`);
  }
  if (settings.args !== undefined && (!Array.isArray(settings.args)
    || settings.args.some(arg => typeof arg !== 'string' || arg.includes('\0')))) {
    throw new Error(`"args" in ${path} must be an array of strings without NUL characters.`);
  }
  return settings;
}

function clangSettings({ cwd, script, files }, settings) {
  for (const name of ['sources', 'includeDirectories']) {
    if (settings[name] !== undefined && !Array.isArray(settings[name])) {
      throw new Error(`"${name}" in .zed/browser-build.json must be an array of paths.`);
    }
  }
  const absolute = path => {
    if (typeof path !== 'string' || path.includes('\0')
      || path.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('Use project-relative paths in .zed/browser-build.json.');
    }
    return `${cwd}/${path}`;
  };
  const sources = settings.sources?.map(absolute) ?? [
    script, ...files.map(([path]) => path).filter(path => path !== script && SOURCE.test(path)
      && !relative(cwd, path).split('/').some(part => SKIP_SOURCES.has(part))),
  ];
  const includes = settings.includeDirectories?.map(absolute) ?? [];
  if (!sources.length || sources.some(path => !SOURCE.test(path) || !files.some(([file]) => file === path))) {
    throw new Error('The sources in .zed/browser-build.json must name existing C or C++ files.');
  }
  return { sources: [...new Set(sources)], includes: [cwd, ...new Set(includes), `${cwd}/include`] };
}

async function clangBuild(job, settings, output) {
  const isNative = job.target === 'linux-x86_64';
  const { sources, includes } = clangSettings(job, settings);
  const [clang, linker, sdk] = await Promise.all([
    loadModule('clang.wasm.gz'), loadModule('lld.wasm.gz'),
    isNative ? null : loadArchive('wasi-sdk.tar.gz'),
  ]);
  const root = new PreopenDirectory('/', new Map());
  for (const [path, bytes] of job.files) writeFile(root.dir, path, bytes, true);
  if (sdk) addArchive(root.dir, sdk);
  root.dir.create_entry_for_path(CC_OUTPUT.slice(1), true);
  if (isNative) {
    const startup = `${CC_OUTPUT}/start.c`;
    writeFile(root.dir, startup, linuxStartup, true);
    sources.push(startup);
  }

  const objects = [];
  let usesCpp = false;
  for (const source of sources) {
    const cpp = !source.endsWith('.c');
    usesCpp ||= cpp;
    const object = `${CC_OUTPUT}/${objects.length}.o`;
    const target = isNative ? 'x86_64-unknown-linux-musl' : 'wasm32-unknown-wasip1';
    const flags = ['-cc1', '-triple', target, '-emit-obj', '-std=' + (cpp ? 'c++20' : 'c17'),
      '-x', cpp ? 'c++' : 'c'];
    if (isNative) flags.push('-fno-builtin', '-ffunction-sections', '-fdata-sections');
    else {
      if (cpp) flags.push('-internal-isystem', '/wasi/include/c++/v1');
      flags.push('-internal-isystem', '/clang/include', '-internal-isystem', '/wasi/include');
    }
    for (const include of includes) flags.push('-I', include);
    print(output, `Compiling ${source.startsWith(CC_OUTPUT) ? 'Linux startup' : relative(job.cwd, source)}`);
    // LLVM's WebAssembly object writer patches offsets in its output stream.
    // Route it directly to a seekable file instead of Clang's temporary output path.
    const objectFile = new File([]);
    const status = await runTool(clang, ['clang', ...flags, source, '-o', '-'], [root], output,
      undefined, new OpenFile(objectFile));
    if (status) return status;
    writeFile(root.dir, object, objectFile.data);
    objects.push(object);
  }

  const binary = `${CC_OUTPUT}/${isNative ? 'program.elf' : 'program.wasm'}`;
  const link = isNative
    ? ['ld.lld', '-m', 'elf_x86_64', '-static', '--gc-sections', '-e', '_start', ...objects]
    : ['wasm-ld', '-z', 'stack-size=1048576', '/wasi/lib/crt1-command.o', ...objects,
      ...(usesCpp ? ['/wasi/lib/libc++.a', '/wasi/lib/libc++abi.a'] : []),
      '/wasi/lib/libm.a', '/wasi/lib/libc.a', '/wasi/lib/libclang_rt.builtins.a'];
  print(output, 'Linking');
  const status = await runTool(linker, [...link, '-o', binary], [root], output);
  if (status) return status;
  const data = root.dir.contents.get(CC_OUTPUT.slice(1)).contents.get(binary.split('/').pop())?.data;
  if (!data?.length) throw new Error('Linker produced no executable.');
  if (isNative) {
    const artifact = data.slice();
    postMessage({ artifact }, [artifact.buffer]);
    return 0;
  }
  print(output, 'Running WebAssembly');
  return runTool(await WebAssembly.compile(data), [relative(job.cwd, job.script), ...(settings.args ?? [])],
    [projectDirectory(job.cwd, job.files)], output, job.stdin);
}

async function zigBuild(job, settings, output) {
  const [compiler, sdk] = await Promise.all([loadModule('zig.wasm.gz'), loadArchive('zig-sdk.tar.gz')]);
  const project = projectDirectory(job.cwd, job.files);
  const lib = new PreopenDirectory('/lib', new Map());
  for (const [path, bytes] of sdk) {
    if (path === 'compiler_rt.o') writeFile(project.dir, '/.zed-compiler-rt.o', bytes, true);
    else if (path.startsWith('lib/')) writeFile(lib.dir, path.slice(3), bytes, true);
  }
  const source = './' + relative(job.cwd, job.script);
  print(output, `Compiling ${source.slice(2)}`);
  const status = await runTool(compiler, ['zig', 'build-exe', source, '.zed-compiler-rt.o',
    '-fno-compiler-rt', '-fno-ubsan-rt', '-femit-bin=.zed-output.wasm'],
  [project, lib, new PreopenDirectory('/cache', new Map())], output);
  if (status) return status;
  const data = project.dir.contents.get('.zed-output.wasm')?.data;
  if (!data?.length) throw new Error('Zig produced no executable.');
  print(output, 'Running WebAssembly');
  return runTool(await WebAssembly.compile(data), [source, ...(settings.args ?? [])], [project], output, job.stdin);
}

self.addEventListener('message', async ({ data: job }) => {
  const output = new TerminalOutput();
  try {
    const settings = readSettings(job);
    const code = job.command === 'browser-zig'
      ? await zigBuild(job, settings, output) : await clangBuild(job, settings, output);
    output.flush();
    postMessage({ code });
  } catch (error) {
    output.flush();
    postMessage({ error: error.message });
  } finally {
    self.close();
  }
}, { once: true });
