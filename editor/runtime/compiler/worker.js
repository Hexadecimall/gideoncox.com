import { ConsoleStdout, File, OpenFile, PreopenDirectory, wasi as errno } from '../rust/wasi/index.js';
import WASI from '../rust/wasi/wasi.js?v=utf8-argv-1';
import { TerminalOutput, TerminalStdin, writeFile } from '../terminal-wasi.js';
import { loadArchive, loadModule } from './assets.js';
import { BUILD_CONFIG, parseBuildConfig, isProjectRelativePath, clangLibraryPaths } from './build-settings.js?v=1';

const CC_OUTPUT = '/.zed-compiler';
const clangAssets = new Map();

function loadClangAsset(name, load) {
  if (!clangAssets.has(name)) {
    clangAssets.set(name, load(name).catch(error => {
      clangAssets.delete(name);
      throw error;
    }));
  }
  return clangAssets.get(name);
}
const SOURCE = /\.(?:c|C|cc|cpp|cxx|c\+\+|CPP)$/;
const SKIP_SOURCES = new Set(['.zed', '.zed-build', 'build', 'dist', 'vendor', 'tests', 'test']);
const LINUX_HEADERS = [
  '/linux/include', '/linux/libc/include/x86_64-linux-musl', '/linux/libc/include/generic-musl',
  '/linux/libc/include/x86-linux-any', '/linux/libc/include/any-linux-any',
];
const LINUX_CXX_HEADERS = [
  '/linux/libcxx/include', '/linux/libcxxabi/include', ...LINUX_HEADERS, '/linux/libunwind/include',
];
const encoder = new TextEncoder();
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

async function runProgram(data, executable, args, project, output, stdin) {
  print(output, 'Running WebAssembly');
  const module = await WebAssembly.compile(data);
  const code = await runTool(module, [executable, ...args], [project], output, stdin);
  return { code, ranProgram: true };
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

function readSettings({ cwd, files, programArgs }) {
  const file = files.find(([name]) => name === `${cwd}/${BUILD_CONFIG}`);
  const settings = parseBuildConfig(file?.[1]);
  if (programArgs !== undefined) settings.args = programArgs;
  if (settings.args !== undefined && (!Array.isArray(settings.args)
    || settings.args.some(arg => typeof arg !== 'string' || arg.includes('\0')))) {
    throw new Error(`"args" in ${BUILD_CONFIG} must be an array of strings without NUL characters.`);
  }
  return settings;
}

function clangSettings({ cwd, script, files, target }, settings) {
  for (const name of ['sources', 'includeDirectories']) {
    if (settings[name] !== undefined && !Array.isArray(settings[name])) {
      throw new Error(`"${name}" in .zed/browser-build.json must be an array of paths.`);
    }
  }
  const absolute = path => {
    if (!isProjectRelativePath(path)) {
      throw new Error('Use project-relative paths in .zed/browser-build.json.');
    }
    return `${cwd}/${path}`;
  };
  const sources = settings.sources?.map(absolute) ?? [
    script, ...files.map(([path]) => path).filter(path => path !== script && SOURCE.test(path)
      && !relative(cwd, path).split('/').some(part => SKIP_SOURCES.has(part))),
  ];
  const includes = settings.includeDirectories?.map(absolute) ?? [];
  const libraries = clangLibraryPaths(settings, target).map(absolute);
  const filePaths = new Set(files.map(([name]) => name));
  if (!sources.length || sources.some(path => !SOURCE.test(path) || !filePaths.has(path))) {
    throw new Error('The sources in .zed/browser-build.json must name existing C or C++ files.');
  }
  const missing = libraries.find(path => !filePaths.has(path));
  if (missing) throw new Error(`Library not found in the project: ${relative(cwd, missing)}.`);
  if (settings.linkCxx !== undefined && typeof settings.linkCxx !== 'boolean') {
    throw new Error(`"linkCxx" in ${BUILD_CONFIG} must be true or false.`);
  }
  return { sources: [...new Set(sources)], includes: [cwd, ...new Set(includes), `${cwd}/include`], libraries };
}

async function clangBuild(job, settings, output) {
  const freestanding = job.target === 'linux-x86_64';
  const linuxStatic = job.target === 'linux-x86_64-static';
  const isNative = freestanding || linuxStatic;
  const { sources, includes, libraries } = clangSettings(job, settings);
  const usesCpp = settings.linkCxx || sources.some(source => !source.endsWith('.c'));
  const sdkName = linuxStatic ? 'linux-x86_64-sdk.tar.gz' : 'wasi-sdk.tar.gz';
  const [clang, linker, sdk, cxx] = await Promise.all([
    loadClangAsset('clang.wasm.gz', loadModule), loadClangAsset('lld.wasm.gz', loadModule),
    freestanding ? null : loadClangAsset(sdkName, loadArchive),
    linuxStatic && usesCpp ? loadClangAsset('linux-x86_64-cxx.tar.gz', loadArchive) : null,
  ]);
  const root = new PreopenDirectory('/', new Map());
  for (const [path, bytes] of job.files) writeFile(root.dir, path, bytes, true);
  if (sdk) addArchive(root.dir, sdk);
  if (cxx) addArchive(root.dir, cxx);
  root.dir.create_entry_for_path(CC_OUTPUT.slice(1), true);
  if (freestanding) {
    const startup = `${CC_OUTPUT}/start.c`;
    writeFile(root.dir, startup, linuxStartup, true);
    sources.push(startup);
  }

  const objects = [];
  for (const source of sources) {
    const cpp = !source.endsWith('.c');
    const object = `${CC_OUTPUT}/${objects.length}.o`;
    const target = isNative ? 'x86_64-unknown-linux-musl' : 'wasm32-unknown-wasip1';
    const flags = ['-cc1', '-triple', target, '-emit-obj', '-std=' + (cpp ? 'c++20' : 'c17'),
      '-x', cpp ? 'c++' : 'c'];
    if (freestanding) {
      flags.push('-fno-builtin', '-ffunction-sections', '-fdata-sections');
    } else if (linuxStatic) {
      const systemHeaders = cpp ? LINUX_CXX_HEADERS : LINUX_HEADERS;
      flags.push('-mrelocation-model', 'static', '-fgnuc-version=4.2.1', '-ffunction-sections', '-fdata-sections');
      if (cpp) flags.push('-fcxx-exceptions', '-fexceptions', '-include', '/linux/libcxx/zig_config.h');
      for (const header of systemHeaders) flags.push('-internal-isystem', header);
    } else {
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
    if (status) return { code: status };
    writeFile(root.dir, object, objectFile.data);
    objects.push(object);
  }

  const binary = `${CC_OUTPUT}/${isNative ? 'program.elf' : 'program.wasm'}`;
  let link;
  if (freestanding) {
    link = ['ld.lld', '-m', 'elf_x86_64', '-static', '--gc-sections', '-e', '_start', ...objects, ...libraries];
  } else if (linuxStatic) {
    const cxxRuntime = usesCpp ? ['/linux/lib/libc++.a', '/linux/lib/libc++abi.a', '/linux/lib/libunwind.a'] : [];
    link = ['ld.lld', '-m', 'elf_x86_64', '-static', '--gc-sections', '--eh-frame-hdr',
      '/linux/lib/crt1.o', ...objects, ...libraries, '--start-group', ...cxxRuntime,
      '/linux/lib/libc.a', '/linux/lib/libzigc.a', '/linux/lib/libcompiler_rt.a', '--end-group'];
  } else {
    link = ['wasm-ld', '-z', 'stack-size=1048576', '/wasi/lib/crt1-command.o', ...objects, ...libraries,
      ...(usesCpp ? ['/wasi/lib/libc++.a', '/wasi/lib/libc++abi.a'] : []),
      '/wasi/lib/libm.a', '/wasi/lib/libc.a', '/wasi/lib/libclang_rt.builtins.a'];
  }
  print(output, 'Linking');
  const status = await runTool(linker, [...link, '-o', binary], [root], output);
  if (status) return { code: status };
  const data = root.dir.contents.get(CC_OUTPUT.slice(1)).contents.get(binary.split('/').pop())?.data;
  if (!data?.length) throw new Error('Linker produced no executable.');
  if (isNative) {
    const artifact = data.slice();
    output.flush();
    postMessage({ artifact }, [artifact.buffer]);
    return { code: 0 };
  }
  return runProgram(data, relative(job.cwd, job.script), settings.args ?? [],
    projectDirectory(job.cwd, job.files), output, job.stdin);
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
  if (status) return { code: status };
  const data = project.dir.contents.get('.zed-output.wasm')?.data;
  if (!data?.length) throw new Error('Zig produced no executable.');
  return runProgram(data, source, settings.args ?? [], project, output, job.stdin);
}

async function rustBuild(job, settings, output) {
  const project = projectDirectory(job.cwd, job.files);
  const source = relative(job.cwd, job.script);
  const { checkRustFile, compileCargo, findCargoManifest } = await import('./cargo.js?v=quickfix-1');
  const manifest = findCargoManifest(project.dir, source);
  if (job.target === 'clippy') {
    print(output, `Checking ${manifest ?? source} with Clippy`);
    const { code, diagnostics, buildOutput } = manifest
      ? await compileCargo(project.dir, manifest, source, output, { clippy: true })
      : await checkRustFile(project.dir, source, output);
    const { cargoDiagnostics } = await import('./rust-diagnostics.js?v=quickfix-1');
    postMessage({ diagnosticSource: 'clippy', cargoDiagnostics: await cargoDiagnostics(job.cwd, job.files, diagnostics),
      buildOutput: code === 0 ? buildOutput : undefined });
    return { code };
  }
  if (manifest) {
    print(output, `Building ${manifest} with Cargo`);
    const { code, binary, executable, buildOutput, diagnostics } = await compileCargo(project.dir, manifest, source, output);
    const { cargoDiagnostics } = await import('./rust-diagnostics.js?v=quickfix-1');
    postMessage({ cargoDiagnostics: await cargoDiagnostics(job.cwd, job.files, diagnostics ?? []) });
    if (code) return { code };
    postMessage({ buildOutput });
    return runProgram(binary, executable, settings.args ?? [], project, output, job.stdin);
  }
  const { compileRust } = await import('./rustc.js?v=registry-1');
  print(output, `Compiling ${source}`);
  const { code, binary } = await compileRust(project.dir, source, output);
  if (code) return { code };
  return runProgram(binary, source, settings.args ?? [], project, output, job.stdin);
}

self.addEventListener('message', async ({ data: job }) => {
  const output = new TerminalOutput();
  try {
    const settings = job.target === 'clippy' ? {} : readSettings(job);
    const build = BROWSER_COMPILERS.get(job.command);
    if (!build) throw new Error('Unsupported browser compiler.');
    const result = await build(job, settings, output);
    output.flush();
    postMessage(result);
  } catch (error) {
    output.flush();
    postMessage({ error: error.message });
  } finally {
    if (job.command !== 'browser-cc' || !job.reusableClang) self.close();
  }
});

const BROWSER_COMPILERS = new Map([
  ['browser-cc', clangBuild],
  ['browser-zig', zigBuild],
  ['browser-rust', rustBuild],
]);
