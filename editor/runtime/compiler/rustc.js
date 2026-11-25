import { File, OpenFile, PreopenDirectory, ConsoleStdout } from '../rust/wasi/index.js';
import { WASIFarm, wait_async_polyfill } from '../rust/wasi-threads.js?v=rename-1';
import { writeFile } from '../terminal-wasi.js';
import { loadArchive, loadModule } from './assets.js';

export async function runRustTool({
  wasmModule, directories, args, env, stdin = [], stdout, stderr, spawn,
}) {
  wait_async_polyfill();
  const farm = new WASIFarm(
    new OpenFile(new File(stdin)), new ConsoleStdout(stdout), new ConsoleStdout(stderr), directories,
    {
      // rustc can read the entire libcore archive in one WASI call.
      allocator_size: (spawn ? 16 : 64) * 1024 * 1024,
      base_call_allocator_size: spawn ? 4 * 1024 * 1024 : undefined,
      unknown_fn: spawn,
    },
  );
  let compiler;
  let filesystemError;
  try {
    return await new Promise((resolve, reject) => {
      filesystemError = event => {
        event.preventDefault();
        reject(event.reason);
      };
      addEventListener('unhandledrejection', filesystemError);
      compiler = new Worker(new URL('./rustc-instance.js?v=registry-1', import.meta.url), { type: 'module' });
      compiler.onmessage = ({ data }) => {
        if (typeof data.code === 'number') resolve(data.code);
        else if (data.error) reject(new Error(data.error));
      };
      compiler.onerror = event => reject(new Error(event.message || 'rustc worker stopped.'));
      compiler.onmessageerror = () => reject(new Error('rustc worker sent an invalid message.'));
      const memory = new WebAssembly.Memory({ initial: 512, maximum: 16384, shared: true });
      compiler.postMessage({ type: 'start', wasiRef: farm.get_ref(), wasmModule, memory, args, env, cargo: Boolean(spawn) });
    });
  } finally {
    if (filesystemError) removeEventListener('unhandledrejection', filesystemError);
    compiler?.terminate();
    farm.destroy();
  }
}

export const RUST_ENV = ['RUSTC_BOOTSTRAP=1', 'RAYON_NUM_THREADS=1'];

export async function loadRustToolchain(compiler = 'rustc.wasm.gz') {
  const [wasmModule, archive] = await Promise.all([loadModule(compiler), loadArchive('rust-sysroot.tar.gz')]);
  const sysroot = new PreopenDirectory('/sysroot', new Map());
  for (const [name, bytes] of archive) writeFile(sysroot.dir, '/' + name, bytes, true);
  return { wasmModule, sysroot };
}

export async function compileRust(sourceFiles, source, output) {
  const { wasmModule, sysroot } = await loadRustToolchain();
  const project = new PreopenDirectory('/project', sourceFiles.contents);
  const build = new PreopenDirectory('/build', new Map());
  const root = new PreopenDirectory('/', new Map([
    ['project', project.dir], ['sysroot', sysroot.dir], ['build', build.dir],
  ]));
  const args = ['rustc', '--edition=2021', '--sysroot', '/sysroot', '--target', 'wasm32-wasip1',
    `/project/${source}`, '-Zthreads=1', '-Ccodegen-units=1', '-Cpanic=abort', '-o', '/build/program.wasm'];
  const write = bytes => output.write(bytes);
  const code = await runRustTool({
    wasmModule, directories: [project, sysroot, build, root], args, env: RUST_ENV,
    stdout: write, stderr: write,
  });
  if (code) return { code };
  const binary = build.dir.contents.get('program.wasm')?.data;
  if (!binary?.length) throw new Error('rustc produced no WebAssembly executable.');
  return { code, binary };
}
