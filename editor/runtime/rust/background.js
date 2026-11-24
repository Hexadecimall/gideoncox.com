import { wait_async_polyfill } from './wasi-threads.js';
import run from './worker_background_worker.min.js';

wait_async_polyfill();
run();
