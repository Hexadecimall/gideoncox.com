import { WASIFarmAnimal, thread_spawn_on_worker } from '../rust/wasi-threads.js?v=rename-1';

async function run({ args, wasiRef, wasmModule, memory }) {
  const animal = new WASIFarmAnimal(wasiRef, args, ['RUSTC_BOOTSTRAP=1', 'RAYON_NUM_THREADS=1'], {
    can_thread_spawn: true,
    thread_spawn_worker_url: import.meta.url,
    thread_spawn_wasm: wasmModule,
    worker_background_worker_url: new URL('../rust/background.js', import.meta.url).href,
    share_memory: { memory },
  });
  await animal.wait_worker_background_worker();
  const instance = await WebAssembly.instantiate(wasmModule, {
    wasi_snapshot_preview1: animal.wasiImport,
    wasi: animal.wasiThreadImport,
    env: { memory },
  });
  postMessage({ code: animal.start(instance) });
}

addEventListener('message', async ({ data }) => {
  try {
    if (data.type === 'start') await run(data);
    else await thread_spawn_on_worker(data);
  } catch (error) {
    postMessage({ error: error?.message || String(error) });
  }
});
