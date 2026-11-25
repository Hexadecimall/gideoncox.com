import { File, OpenFile, PreopenDirectory, ConsoleStdout } from '../rust/wasi/index.js';
import { WASIFarm, wait_async_polyfill } from '../rust/wasi-threads.js?v=rename-1';
import { writeFile } from '../terminal-wasi.js';
import { loadArchive, loadModule } from './assets.js';

async function runCompiler(wasmModule, directories, args, output) {
  wait_async_polyfill();
  const terminal = new ConsoleStdout(bytes => output.write(bytes));
  // rustc can read the entire libcore archive in one WASI call.
  const farm = new WASIFarm(new OpenFile(new File([])), terminal, terminal, directories, {
    allocator_size: 64 * 1024 * 1024,
  });
  let compiler;
  let filesystemError;
  try {
    return await new Promise((resolve, reject) => {
      filesystemError = event => {
        event.preventDefault();
        reject(event.reason);
      };
      addEventListener('unhandledrejection', filesystemError);
      compiler = new Worker(new URL('./rustc-instance.js?v=1', import.meta.url), { type: 'module' });
      compiler.onmessage = ({ data }) => {
        if (typeof data.code === 'number') resolve(data.code);
        else if (data.error) reject(new Error(data.error));
      };
      compiler.onerror = event => reject(new Error(event.message || 'rustc worker stopped.'));
      compiler.onmessageerror = () => reject(new Error('rustc worker sent an invalid message.'));
      const memory = new WebAssembly.Memory({ initial: 512, maximum: 16384, shared: true });
      compiler.postMessage({ type: 'start', wasiRef: farm.get_ref(), wasmModule, memory, args });
    });
  } finally {
    if (filesystemError) removeEventListener('unhandledrejection', filesystemError);
    compiler?.terminate();
    farm.destroy();
  }
}

export async function compileRust(sourceFiles, source, output) {
  const [module, archive] = await Promise.all([loadModule('rustc.wasm.gz'), loadArchive('rust-sysroot.tar.gz')]);
  const project = new PreopenDirectory('/project', sourceFiles.contents);
  const sysroot = new PreopenDirectory('/sysroot', new Map());
  const build = new PreopenDirectory('/build', new Map());
  const root = new PreopenDirectory('/', new Map([
    ['project', project.dir], ['sysroot', sysroot.dir], ['build', build.dir],
  ]));
  for (const [name, bytes] of archive) writeFile(sysroot.dir, '/' + name, bytes, true);
  const args = ['rustc', '--edition=2021', '--sysroot', '/sysroot', '--target', 'wasm32-wasip1',
    `/project/${source}`, '-Zthreads=1', '-Ccodegen-units=1', '-Cpanic=abort', '-o', '/build/program.wasm'];
  const code = await runCompiler(module, [project, sysroot, build, root], args, output);
  if (code) return { code };
  const binary = build.dir.contents.get('program.wasm')?.data;
  if (!binary?.length) throw new Error('rustc produced no WebAssembly executable.');
  return { code, binary };
}
