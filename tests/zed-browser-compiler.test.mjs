import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { WorkerHost } from './fixtures/zed-worker-host.mjs';

const worker = new URL('../editor/runtime/compiler/worker.js', import.meta.url);
const encoder = new TextEncoder();
const cwd = '/home/web/compiler-test';

async function run({ command = 'browser-cc', target = 'wasi', script, files, programArgs }) {
  const handler = new EventTarget();
  handler.close = () => {};
  globalThis.self = handler;
  globalThis.Worker = WorkerHost;
  globalThis.addEventListener = handler.addEventListener.bind(handler);
  globalThis.removeEventListener = handler.removeEventListener.bind(handler);
  globalThis.fetch = async location => {
    const asset = new URL(location);
    asset.search = '';
    return new Response(await readFile(asset));
  };
  const stdout = new TextDecoder();
  let output = '';
  let artifact;
  const result = new Promise((resolve, reject) => {
    globalThis.postMessage = message => {
      if (message.chunk) output += stdout.decode(message.chunk, { stream: true });
      if (message.artifact) artifact = message.artifact;
      if (message.error) reject(new Error(message.error));
      if (message.code !== undefined) {
        resolve({ code: message.code, ranProgram: message.ranProgram, output: output + stdout.decode(), artifact });
      }
    };
  });
  await import(`${worker.href}?run=${encodeURIComponent(target + script)}`);
  handler.dispatchEvent(new MessageEvent('message', { data: {
    cwd, command, target, script: `${cwd}/${script}`, programArgs,
    files: Object.entries(files).map(([name, contents]) => [`${cwd}/${name}`, encoder.encode(contents)]),
  } }));
  return result;
}

test('the shipped browser toolchains compile, link, report diagnostics, and run', async () => {
  const c = await run({ script: 'main.c', files: {
    '.zed/browser-build.json': JSON.stringify({ args: ['unused'] }),
    'main.c': '#include <stdio.h>\n#include "math_test.h"\nint main(int argc, char **argv) { printf("C: %d\\n", twice(21)); return argc == 1 ? 0 : 1; }',
    'include/math_test.h': 'int twice(int value);',
    'lib/math_test.c': '#include "math_test.h"\nint twice(int value) { return value * 2; }',
  }, programArgs: [] });
  assert.equal(c.code, 0, c.output);
  assert.equal(c.ranProgram, true);
  assert.match(c.output, /C: 42/);

  const cpp = await run({ script: 'main.cpp', files: {
    '.zed/browser-build.json': JSON.stringify({ args: ['unused'] }),
    'main.cpp': `#include <iostream>
#include <vector>
int twice(int);
int main(int argc, char **argv) {
    std::vector<int> v{21};
    std::cout << twice(v.at(0)) << "\\n";
    for (int i = 0; i < argc; ++i) std::cout << '[' << argv[i] << "]\\n";
    return 23;
}`,
    'math_test.cpp': 'int twice(int value) { return value * 2; }',
  }, programArgs: ['--mode', 'two words', '', '雪'] });
  assert.equal(cpp.code, 23, cpp.output);
  assert.equal(cpp.ranProgram, true);
  assert.match(cpp.output, /\r\n42\r\n/);
  assert.match(cpp.output, /\[main\.cpp\]\r\n\[--mode\]\r\n\[two words\]\r\n\[\]\r\n\[雪\]\r\n/);

  const broken = await run({ script: 'broken.c', files: {
    'broken.c': 'int main(void) { return missing_name; }',
  } });
  assert.equal(broken.code, 1);
  assert.equal(broken.ranProgram, undefined);
  assert.match(broken.output, /broken\.c:1:25: error: use of undeclared identifier 'missing_name'/);

  const zig = await run({ command: 'browser-zig', script: 'main.zig', files: {
    '.zed/browser-build.json': JSON.stringify({ args: ['Zig 42\n'] }),
    'main.zig': `const std = @import("std");
pub fn main(init: std.process.Init) !void {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    try std.Io.File.stdout().writeStreamingAll(init.io, args[1]);
}`,
  } });
  assert.equal(zig.code, 0, zig.output);
  assert.equal(zig.ranProgram, true);
  assert.match(zig.output, /Zig 42/);

  const linux = await run({ target: 'linux-x86_64', script: 'main.cpp', files: {
    'main.cpp': 'extern "C" int twice(int); int main() { return twice(21); }',
    'lib/math_test.c': 'int twice(int value) { return value * 2; }',
  } });
  assert.equal(linux.code, 0, linux.output);
  assert.equal(linux.ranProgram, undefined);
  const elf = new DataView(linux.artifact.buffer);
  assert.equal(elf.getUint32(0), 0x7f454c46);
  assert.equal(elf.getUint8(4), 2); // ELFCLASS64
  assert.equal(elf.getUint16(16, true), 2); // ET_EXEC
  assert.equal(elf.getUint16(18, true), 62); // EM_X86_64
  assert.notEqual(elf.getBigUint64(24, true), 0n);
});

test('browser builds reject non-string arguments before starting the toolchain', async () => {
  await assert.rejects(run({ script: 'invalid-args.c', files: {
    'invalid-args.c': 'int main(void) { return 0; }',
    '.zed/browser-build.json': '{"args":["--count",3]}',
  } }), /"args".*must be an array of strings/);
});

test('standalone Rust still builds with the bundled rustc', async () => {
  const standalone = await run({ command: 'browser-rust', script: 'standalone.rs', files: {
    'standalone.rs': 'fn main() { println!("standalone rustc"); }',
  } });
  assert.equal(standalone.code, 0, standalone.output);
  assert.equal(standalone.ranProgram, true);
  assert.match(standalone.output, /standalone rustc/);
});

test('Cargo builds the selected Rust binary with a workspace path dependency', async () => {
  const files = {
    'Cargo.toml': '[workspace]\nmembers = ["app", "message"]\nresolver = "2"\n',
    'app/Cargo.toml': '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n'
      + '[dependencies]\nmessage = { path = "../message" }\n',
    'app/src/main.rs': `fn main() {
        println!("{}: {}", message::hello(), std::env::args().nth(1).unwrap());
        std::process::exit(23);
    }`,
    'app/src/bin/other.rs': 'fn main() { panic!("Selected the wrong binary"); }',
    'message/Cargo.toml': '[package]\nname = "message"\nversion = "0.1.0"\nedition = "2021"\n',
    'message/src/lib.rs': 'pub fn hello() -> &\'static str { "local Rust crate" }',
  };
  const cargo = await run({
    command: 'browser-rust', script: 'app/src/main.rs', files, programArgs: ['two words'],
  });
  assert.equal(cargo.code, 23, cargo.output);
  assert.equal(cargo.ranProgram, true);
  assert.match(cargo.output, /local Rust crate: two words/);

  const broken = await run({
    command: 'browser-rust', script: 'app/src/bin/other.rs',
    files: { ...files, 'app/src/bin/other.rs': 'fn main() { message::missing(); }' },
  });
  assert.notEqual(broken.code, 0);
  assert.equal(broken.ranProgram, undefined);
  assert.match(broken.output, /cannot find function `missing`/);
});
