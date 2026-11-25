import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { WorkerHost } from './fixtures/zed-worker-host.mjs';

const worker = new URL('../editor/runtime/compiler/worker.js', import.meta.url);
const encoder = new TextEncoder();
const cwd = '/home/web/compiler-test';
let job = 0;

async function run({ command = 'browser-cc', target = 'wasi', script, files, programArgs, registry }) {
  const handler = new EventTarget();
  handler.close = () => {};
  globalThis.self = handler;
  globalThis.Worker = WorkerHost;
  globalThis.addEventListener = handler.addEventListener.bind(handler);
  globalThis.removeEventListener = handler.removeEventListener.bind(handler);
  const fetched = new Set();
  globalThis.fetch = async location => {
    const asset = new URL(location);
    asset.search = '';
    fetched.add(asset.pathname.split('/').pop());
    if (asset.protocol === 'https:') {
      const data = registry?.get(asset.href);
      return data ? new Response(data) : new Response(null, { status: 404 });
    }
    return new Response(await readFile(asset));
  };
  const stdout = new TextDecoder();
  let output = '';
  let artifact;
  let buildOutput;
  let cargoDiagnostics;
  const result = new Promise((resolve, reject) => {
    globalThis.postMessage = message => {
      if (message.chunk) output += stdout.decode(message.chunk, { stream: true });
      if (message.artifact) artifact = message.artifact;
      if (message.buildOutput) buildOutput = message.buildOutput;
      if (message.cargoDiagnostics) cargoDiagnostics = message.cargoDiagnostics;
      if (message.error) reject(new Error(message.error));
      if (message.code !== undefined) {
        resolve({ code: message.code, ranProgram: message.ranProgram, output: output + stdout.decode(),
          artifact, fetched, buildOutput, cargoDiagnostics });
      }
    };
  });
  await import(`${worker.href}?run=${++job}`);
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
  assert.equal(cargo.fetched.has('rust-host-sysroot.tar.gz'), false);

  const broken = await run({
    command: 'browser-rust', script: 'app/src/bin/other.rs',
    files: { ...files, 'app/src/bin/other.rs': 'fn main() { message::missing(); }' },
  });
  assert.notEqual(broken.code, 0);
  assert.equal(broken.ranProgram, undefined);
  assert.match(broken.output, /cannot find function `missing`/);
  assert.doesNotMatch(broken.output, /"\$message_type"/);
  const [file] = broken.cargoDiagnostics;
  assert.equal(file.path, `${cwd}/app/src/bin/other.rs`);
  assert.equal(file.items[0].code, 'E0425');
  assert.equal(file.items[0].severity, 1);
});

test('Cargo runs build.rs with a writable OUT_DIR and applies its directives', async () => {
  const cargo = await run({ command: 'browser-rust', script: 'src/main.rs', files: {
    'Cargo.toml': '[package]\nname = "generated"\nversion = "0.1.0"\nedition = "2021"\n'
      + '[build-dependencies]\ngenerator = { path = "generator" }\n',
    'generator/Cargo.toml': '[package]\nname = "generator"\nversion = "0.1.0"\nedition = "2021"\n',
    'generator/src/lib.rs': `pub fn rust_source(message: &str) -> String {
        format!("const MESSAGE: &str = {message:?};")
    }`,
    'message.txt': 'built in the browser',
    'build.rs': `fn main() {
        assert_eq!(std::env::current_dir().unwrap(),
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")));
        let message = std::fs::read_to_string("message.txt").unwrap();
        let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        std::fs::write(out.join("generated.rs"), generator::rust_source(&message)).unwrap();
        println!("cargo:rerun-if-changed=message.txt");
        println!("cargo:rustc-env=BUILD_CHANNEL=browser");
        println!("cargo:rustc-cfg=browser_generated");
    }`,
    'src/main.rs': `
        include!(concat!(env!("OUT_DIR"), "/generated.rs"));
        fn main() {
            println!("{MESSAGE} on {}", env!("BUILD_CHANNEL"));
        }`,
  } });
  assert.equal(cargo.code, 0, cargo.output);
  assert.equal(cargo.ranProgram, true);
  assert.match(cargo.output, /built in the browser on browser/);
  assert.equal(cargo.fetched.has('rust-host-sysroot.tar.gz'), true);
  const [generated] = cargo.buildOutput.packages;
  assert.equal(generated.manifest, 'Cargo.toml');
  assert.deepEqual(generated.cfg, ['browser_generated']);
  assert.deepEqual(generated.env, [['BUILD_CHANNEL', 'browser']]);
  assert.deepEqual(generated.files.map(([name, content]) => [name, new TextDecoder().decode(content)]),
    [['generated.rs', 'const MESSAGE: &str = "built in the browser";']]);
});

function crateTar(name, files) {
  const blocks = [];
  for (const [path, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const header = Buffer.alloc(512);
    header.write(`${name}-0.1.0/${path}`, 0);
    header.write('0000644\0', 100);
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000001\0', 136);
    header.fill(32, 148, 156);
    header.write('0', 156);
    header.write('ustar\0' + '00', 257);
    const sum = header.reduce((previous, byte) => previous + byte, 0);
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

test('Cargo checks, unpacks, and compiles direct and transitive sparse registry packages', { timeout: 20000 }, async () => {
  const registry = new Map([['https://index.crates.io/config.json', '{"dl":"https://static.crates.io/crates"}']]);
  const manifest = name => `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n`;
  function publish(name, source, dependency) {
    const archive = crateTar(name, {
      'Cargo.toml': manifest(name) + (dependency ? `[dependencies]\n${dependency} = "0.1"\n` : ''),
      'src/lib.rs': source,
    });
    const deps = dependency ? [{ name: dependency, req: '^0.1', features: [], optional: false,
      default_features: true, target: null, kind: 'normal', registry: null }] : [];
    const index = JSON.stringify({ name, vers: '0.1.0', deps, features: {}, yanked: false,
      cksum: createHash('sha256').update(archive).digest('hex') });
    registry.set(`https://index.crates.io/qa/te/${name}`, index + '\n');
    registry.set(`https://static.crates.io/crates/${name}/${name}-0.1.0.crate`, archive);
  }
  publish('qatesource', 'pub fn answer() -> u32 { 40 }');
  publish('qateshared', 'pub fn answer() -> u32 { qatesource::answer() + 2 }', 'qatesource');
  const cargo = await run({ command: 'browser-rust', script: 'src/main.rs', registry, files: {
    'Cargo.toml': manifest('cargo-browser-test') + '[dependencies]\nqateshared = "0.1"\n',
    'src/main.rs': 'fn main() { println!("crate answer: {}", qateshared::answer()); }',
  } });
  assert.equal(cargo.code, 0, cargo.output);
  assert.match(cargo.output, /crate answer: 42/);
  assert.equal(cargo.fetched.has('qatesource-0.1.0.crate'), true);
});
