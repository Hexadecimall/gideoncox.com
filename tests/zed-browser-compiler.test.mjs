import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const worker = new URL('../editor/runtime/compiler/worker.js', import.meta.url);
const encoder = new TextEncoder();
const cwd = '/home/web/compiler-test';

async function run({ command = 'browser-cc', target = 'wasi', script, files }) {
  const handler = new EventTarget();
  handler.close = () => {};
  globalThis.self = handler;
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
      if (message.code !== undefined) resolve({ code: message.code, output: output + stdout.decode(), artifact });
    };
  });
  await import(`${worker.href}?run=${encodeURIComponent(target + script)}`);
  handler.dispatchEvent(new MessageEvent('message', { data: {
    cwd, command, target, script: `${cwd}/${script}`,
    files: Object.entries(files).map(([name, contents]) => [`${cwd}/${name}`, encoder.encode(contents)]),
  } }));
  return result;
}

test('the shipped browser toolchains compile, link, report diagnostics, and run', async () => {
  const c = await run({ script: 'main.c', files: {
    'main.c': '#include <stdio.h>\n#include "math_test.h"\nint main(void) { printf("C: %d\\n", twice(21)); }',
    'include/math_test.h': 'int twice(int value);',
    'lib/math_test.c': '#include "math_test.h"\nint twice(int value) { return value * 2; }',
  } });
  assert.equal(c.code, 0, c.output);
  assert.match(c.output, /C: 42/);

  const cpp = await run({ script: 'main.cpp', files: {
    'main.cpp': '#include <iostream>\n#include <vector>\nint twice(int);\nint main() { std::vector<int> v{21}; std::cout << twice(v.at(0)) << "\\n"; }',
    'math_test.cpp': 'int twice(int value) { return value * 2; }',
  } });
  assert.equal(cpp.code, 0, cpp.output);
  assert.match(cpp.output, /\r\n42\r\n/);

  const broken = await run({ script: 'broken.c', files: {
    'broken.c': 'int main(void) { return missing_name; }',
  } });
  assert.equal(broken.code, 1);
  assert.match(broken.output, /broken\.c:1:25: error: use of undeclared identifier 'missing_name'/);

  const zig = await run({ command: 'browser-zig', script: 'main.zig', files: {
    'main.zig': 'const std = @import("std");\npub fn main(init: std.process.Init) !void { try std.Io.File.stdout().writeStreamingAll(init.io, "Zig 42\\n"); }',
  } });
  assert.equal(zig.code, 0, zig.output);
  assert.match(zig.output, /Zig 42/);

  const linux = await run({ target: 'linux-x86_64', script: 'main.cpp', files: {
    'main.cpp': 'extern "C" int twice(int); int main() { return twice(21); }',
    'lib/math_test.c': 'int twice(int value) { return value * 2; }',
  } });
  assert.equal(linux.code, 0, linux.output);
  const elf = new DataView(linux.artifact.buffer);
  assert.equal(elf.getUint32(0), 0x7f454c46);
  assert.equal(elf.getUint8(4), 2); // ELFCLASS64
  assert.equal(elf.getUint16(16, true), 2); // ET_EXEC
  assert.equal(elf.getUint16(18, true), 62); // EM_X86_64
  assert.notEqual(elf.getBigUint64(24, true), 0n);
});
