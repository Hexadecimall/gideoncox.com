import { WASIFarmAnimal, thread_spawn_on_worker } from './wasi-threads.js';
import { wasiImports } from './wasi-io.js';

async function start({ wasiRef, wasmModule, memory }) {
  const animal = new WASIFarmAnimal(wasiRef, ['rust-analyzer'], [
    'HOME=/home/web', 'RUSTC=rustc', 'CARGO=cargo', 'RAYON_NUM_THREADS=1',
  ], {
    can_thread_spawn: true,
    thread_spawn_worker_url: import.meta.url,
    thread_spawn_wasm: wasmModule,
    worker_background_worker_url: new URL('./background.js', import.meta.url).href,
    share_memory: { memory },
  });
  await animal.wait_worker_background_worker();
  let instance;
  instance = await WebAssembly.instantiate(wasmModule, wasiImports(animal, {
    wasi_snapshot_preview1: animal.wasiImport,
    wasi: animal.wasiThreadImport,
    env: animal.get_share_memory(),
  }, () => instance));
  postMessage({ type: 'ready' });
  postMessage({ type: 'exit', code: animal.start(instance) });
}

let thread;
addEventListener('message', async ({ data }) => {
  try {
    if (data.type === 'start') {
      await start(data);
    } else {
      await thread_spawn_on_worker(data, async (module, imports) => {
        let instance;
        instance = await WebAssembly.instantiate(module, wasiImports(thread, imports, () => instance));
        return instance;
      }, animal => { thread = animal; });
    }
  } catch (error) {
    postMessage({ type: 'failed', message: error?.message || String(error) });
  }
});
