import { WASIFarmAnimal, thread_spawn_on_worker } from '../rust/wasi-threads.js?v=rename-1';
import { cargoImports } from './cargo-imports.js?v=registry-1';

async function run({ args, env, wasiRef, wasmModule, memory, cargo }) {
  const animal = new WASIFarmAnimal(wasiRef, args, env, {
    can_thread_spawn: true,
    thread_spawn_worker_url: import.meta.url,
    thread_spawn_wasm: wasmModule,
    worker_background_worker_url: new URL('../rust/background.js', import.meta.url).href,
    share_memory: { memory },
  });
  await animal.wait_worker_background_worker();
  const imports = {
    wasi_snapshot_preview1: animal.wasiImport,
    wasi: animal.wasiThreadImport,
    env: { memory },
  };
  let instance;
  instance = await WebAssembly.instantiate(wasmModule, cargo ? cargoImports(animal, imports, () => instance) : imports);
  postMessage({ code: animal.start(instance) });
}

async function startThread(data) {
  let animal;
  await thread_spawn_on_worker(data, async (module, imports) => {
    if (!WebAssembly.Module.imports(module).some(item => item.module === '__wasip1_vfs-host')) {
      return WebAssembly.instantiate(module, imports);
    }
    let instance;
    instance = await WebAssembly.instantiate(module, cargoImports(animal, imports, () => instance));
    return instance;
  }, value => { animal = value; });
}

addEventListener('message', async ({ data }) => {
  try {
    if (data.type === 'start') await run(data);
    else await startThread(data);
  } catch (error) {
    postMessage({ error: error?.message || String(error) });
  }
});
