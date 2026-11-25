import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { createRustfmt, rustfmtConfig } from '../editor/runtime/rust/rustfmt/format.js';

const root = '/home/web/project';
const encoder = new TextEncoder();
const archive = new URL('../editor/runtime/rust/rustfmt/rust_fmt.wasm.gz', import.meta.url);

test('WASI rustfmt formats modern Rust, reports invalid syntax, and remains reusable', async () => {
  const format = createRustfmt(async () => WebAssembly.compile(gunzipSync(await readFile(archive))));
  const config = 'edition=2024\ntab_spaces=2';
  const expected = 'async fn sum(a: i32, b: i32) -> i32 {\n  a + b\n}\n';
  assert.equal(await format('async fn sum(a:i32,b:i32)->i32{a+b}', config), expected);
  await assert.rejects(format('fn broken(', config), /rustfmt|expected|unclosed/);
  assert.equal(await format(expected, config), expected);
});

test('rustfmt uses the closest project config and inherits the Cargo workspace edition', () => {
  const file = (name, text) => [`${root}/${name}`, encoder.encode(text)];
  const files = new Map([
    file('rustfmt.toml', 'tab_spaces = 8'),
    file('Cargo.toml', '[workspace.package]\nedition = "2021"'),
    file('crate/Cargo.toml', '[package]\nname = "demo"\nedition.workspace = true'),
    file('crate/.rustfmt.toml', 'tab_spaces = 2\nmax_width = 72'),
    file('crate/rustfmt.toml', 'tab_spaces = 7'),
  ]);
  const options = { tabSize: 4, insertSpaces: true };
  const path = `${root}/crate/src/lib.rs`;
  assert.equal(rustfmtConfig(files, root, path, options), 'tab_spaces=2\nhard_tabs=false\nedition=2021\nmax_width=72');
  files.delete(`${root}/crate/.rustfmt.toml`);
  assert.match(rustfmtConfig(files, root, path, options), /tab_spaces=7/);
  assert.equal(rustfmtConfig(files, root, '/home/web/outside.rs'), 'edition=2024');
});
