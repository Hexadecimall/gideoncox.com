import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { brotliDecompressSync, gzipSync } from 'node:zlib';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: pack-browser-rustfmt.mjs INPUT.wasm.br OUTPUT.wasm.gz');
const wasm = brotliDecompressSync(await readFile(input));
const digest = createHash('sha256').update(wasm).digest('hex');
if (digest !== '4353764262a96f1f0e27b2a8aef3c478fc864484d60527cf026359a44c442425') {
  throw new Error('Expected the unmodified WASI artifact from @scalar/rust-fmt@0.5.0.');
}

// These equal-length changes remove build paths from embedded panic locations
// without changing section lengths, instructions, or the formatting runtime.
const buildHome = ['', 'root'].join('/');
for (const [original, anonymous] of [
  [`${buildHome}/.cargo/`, 'cargo-source/'],
  [`${buildHome}/.rustup/`, 'rustup-source/'],
]) {
  let next = 0;
  while ((next = wasm.indexOf(original, next)) !== -1) {
    next += wasm.write(anonymous, next, original.length, 'ascii');
  }
}
if (!WebAssembly.validate(wasm)) throw new Error('Invalid rustfmt WebAssembly module.');
await writeFile(output, gzipSync(wasm, { level: 9 }));
