#!/bin/sh
set -eu

if [ "$#" -ne 3 ]; then
    printf '%s\n' 'Usage: sh build-browser-cargo.sh WASI_SDK SCRATCH COMPILER_OUTPUT' >&2
    exit 2
fi

packaging=$(CDPATH='' cd "$(dirname "$0")" && pwd)
sdk=$(CDPATH='' cd "$1" && pwd)
mkdir -p "$2" "$3"
scratch=$(CDPATH='' cd "$2" && pwd)
output=$(CDPATH='' cd "$3" && pwd)
build=$(mktemp -d "$scratch/cargo.XXXXXXXX")
revision=eb6c32a4a364d83946a36adbec3b4d2ee863a669
filetime=0.2.27

cd "$build"
curl -fLsS "https://codeload.github.com/oligamiq/cargo/tar.gz/$revision" -o cargo.tar.gz
curl -fLsS "https://static.crates.io/crates/filetime/filetime-$filetime.crate" -o filetime.crate
python3 - <<'PY'
from hashlib import sha256
from pathlib import Path

checksums = {
    'cargo.tar.gz': '4c134821563adc30a589f33508631104f3bab789d43c6876660975686e9548bf',
    'filetime.crate': 'f98844151eee8917efc50bd9e8318cb963ae8b297431495d3f758616ea5c57db',
}
for name, expected in checksums.items():
    if sha256(Path(name).read_bytes()).hexdigest() != expected:
        raise SystemExit(f'Source checksum mismatch for {name}')
PY
tar -xzf cargo.tar.gz
cd "cargo-$revision"
mkdir -p vendor
tar -xzf ../filetime.crate -C vendor
python3 - <<'PY'
from pathlib import Path
import re

manifest = Path('Cargo.toml')
source, count = re.subn(
    r'^filetime = \{ path = "[^"]+" \}$',
    'filetime = { path = "vendor/filetime-0.2.27" }',
    manifest.read_text(), flags=re.MULTILINE,
)
if count != 1:
    raise SystemExit('Cargo filetime dependency patch changed upstream')
manifest.write_text(source)
PY
patch -p1 < "$packaging/cargo-browser.patch"
printf '%s\n%s\n%s\n' "$revision" eb6c32a4a 2026-07-12 > git-commit-info

export WASI_SDK_PATH="$sdk" WASI_SYSROOT="$sdk/share/wasi-sysroot"
export CC_wasm32_wasip1_threads="$sdk/bin/clang"
export CXX_wasm32_wasip1_threads="$sdk/bin/clang++"
export AR_wasm32_wasip1_threads="$sdk/bin/llvm-ar"
export CC_SHELL_ESCAPED_FLAGS=1
export CFLAGS_wasm32_wasip1_threads="--target=wasm32-wasip1-threads --sysroot=\"$WASI_SYSROOT\" -pthread -ffile-prefix-map=\"$PWD\"=. -ffile-prefix-map=\"$HOME/.cargo\"=cargo"
export CXXFLAGS_wasm32_wasip1_threads="$CFLAGS_wasm32_wasip1_threads"
export CARGO_ENCODED_RUSTFLAGS=$(printf '%s\037%s\037%s\037%s\037%s' \
    '-Cpanic=unwind' '-Cllvm-args=-wasm-use-legacy-eh=false' \
    "--remap-path-prefix=$PWD=." "--remap-path-prefix=$HOME/.cargo=cargo" "--remap-path-prefix=$HOME/.rustup=rustup")
export RUSTC_BOOTSTRAP=1
export CARGO_TARGET_DIR="$build/target"
export CARGO_PROFILE_RELEASE_OPT_LEVEL=s
export CARGO_PROFILE_RELEASE_STRIP=true
cargo +1.98.1 build --locked --release --bin cargo --target wasm32-wasip1-threads -Zbuild-std -j 4

python3 - "$CARGO_TARGET_DIR/wasm32-wasip1-threads/release/cargo.wasm" "$output" <<'PY'
import gzip
from hashlib import sha256
import json
from pathlib import Path
import shutil
import sys

binary = Path(sys.argv[1])
output = Path(sys.argv[2])
archive = output / 'cargo.wasm.gz'
with binary.open('rb') as source, archive.open('wb') as dest:
    with gzip.GzipFile(filename='', mode='wb', fileobj=dest, mtime=0) as compressed:
        shutil.copyfileobj(source, compressed)
manifest = output / 'manifest.json'
assets = json.loads(manifest.read_text()) if manifest.exists() else {}
assets[archive.name] = sha256(archive.read_bytes()).hexdigest()
manifest.write_text(json.dumps(assets, indent=2) + '\n')
PY
cp LICENSE-MIT "$output/LICENSE-MIT-cargo"
cp LICENSE-APACHE "$output/LICENSE-APACHE-cargo"
cp LICENSE-THIRD-PARTY "$output/LICENSE-THIRD-PARTY-cargo"
cp "vendor/filetime-$filetime/LICENSE-MIT" "$output/LICENSE-MIT-filetime"
cp "vendor/filetime-$filetime/LICENSE-APACHE" "$output/LICENSE-APACHE-filetime"
