#!/bin/sh
set -eu

if [ "$#" -ne 4 ]; then
    printf '%s\n' 'Usage: sh build-browser-clippy.sh RUST_SOURCE WASI_SDK NATIVE_LLVM_CONFIG COMPILER_OUTPUT' >&2
    exit 2
fi

packaging=$(CDPATH='' cd "$(dirname "$0")" && pwd)
source=$(CDPATH='' cd "$1" && pwd)
sdk=$(CDPATH='' cd "$2" && pwd)
llvm_config=$(CDPATH='' cd "$(dirname "$3")" && pwd)/$(basename "$3")
mkdir -p "$4"
output=$(CDPATH='' cd "$4" && pwd)
host=$(rustc -vV | sed -n 's/^host: //p')
target=wasm32-wasip1-threads
build="$source/build"
support=$(mktemp -d "$build.clippy.XXXXXXXX")

cd "$source"
patch -N -p1 < "$packaging/clippy-browser.patch"

# Cross-LLVM queries use a native llvm-config with paths that Rust bootstrap
# can translate to the cross target's libraries and headers.
mkdir -p "$build/$host/llvm/bin"
cp "$llvm_config" "$build/$host/llvm/bin/llvm-config"
ln -s "$("$llvm_config" --libdir)" "$build/$host/llvm/lib"
ln -s "$("$llvm_config" --includedir)" "$build/$host/llvm/include"

cat > "$support/rustc-wrapper.py" <<'PY'
#!/usr/bin/env python3
import os
from pathlib import Path
import sys

compiler, *arguments = sys.argv[1:]
stage = Path(compiler).parent.parent
if '--crate-type' in arguments and '--target' not in arguments and stage.name == 'stage1':
    crate_type = arguments[arguments.index('--crate-type') + 1]
    if crate_type in {'bin', 'proc-macro'}:
        arguments += ['-C', 'panic=abort']
if '--target' in arguments and '--crate-name' in arguments:
    target = arguments[arguments.index('--target') + 1]
    crate = arguments[arguments.index('--crate-name') + 1]
    if target == 'wasm32-wasip1-threads' and crate.startswith(('cargo_clippy', 'clippy')):
        dependencies = stage.parent / 'stage1-rustc' / target / 'release' / 'deps'
        arguments += ['-L', str(dependencies), '-C', f'link-arg=--target={target}']
os.execv(compiler, [compiler, *arguments])
PY
chmod +x "$support/rustc-wrapper.py"

python3 - "$support/bootstrap.toml" "$host" "$sdk" "$llvm_config" <<'PY'
import json
from pathlib import Path
import sys

destination, host, sdk, llvm_config = sys.argv[1:]
quoted = json.dumps
lines = [
    '[build]', f'build = {quoted(host)}', 'host = ["wasm32-wasip1-threads"]',
    f'target = [{quoted(host)}, "wasm32-wasip1-threads", "wasm32-wasip1"]',
    'submodules = false', 'docs = false', 'extended = true', 'tools = ["clippy"]',
    '[llvm]', 'ninja = false', 'download-ci-llvm = false', 'link-shared = false',
    'targets = "AArch64;WebAssembly;X86"', 'experimental-targets = ""',
    '[rust]', 'download-rustc = false', 'deny-warnings = false', 'debuginfo-level = 0',
    'llvm-bitcode-linker = false', f'[target.{host}]', f'llvm-config = {quoted(llvm_config)}',
]
for target in ('wasm32-wasip1', 'wasm32-wasip1-threads'):
    lines.append(f'[target.{target}]')
    for name, path in {'cc': 'bin/clang', 'cxx': 'bin/clang++', 'ar': 'bin/llvm-ar',
                       'linker': 'bin/clang', 'wasi-root': 'share/wasi-sysroot'}.items():
        lines.append(f'{name} = {quoted(f"{sdk}/{path}")}')
Path(destination).write_text('\n'.join(lines) + '\n')
PY

WASI_SDK_PATH="$sdk" WASI_SYSROOT="$sdk/share/wasi-sysroot" \
    RUSTC_WRAPPER="$support/rustc-wrapper.py" \
    python3 x.py build --config "$support/bootstrap.toml" --stage 1 --host "$target" --target "$target" -j 4 src/tools/clippy
driver="$build/$host/stage1-tools/$target/release/clippy-driver.wasm"
python3 "$packaging/pack-browser-clippy.py" "$driver" "$source" "$sdk" "$output"
cp src/tools/clippy/LICENSE-APACHE "$output/LICENSE-APACHE-clippy"
cp src/tools/clippy/LICENSE-MIT "$output/LICENSE-MIT-clippy"
