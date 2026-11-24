#!/bin/sh
# Build the corresponding browser rust-analyzer from the pinned source tree.
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
source_tree=$(CDPATH='' cd -- "$1" && pwd)
output_dir=$2
mkdir -p "$output_dir"
output_dir=$(CDPATH='' cd -- "$output_dir" && pwd)
cd "$source_tree"
patch -p1 < "$script_dir/rust-analyzer-output.patch"
patch -p1 < "$script_dir/rust-analyzer-vfs.patch"

python3 - <<'PY'
from pathlib import Path
import re
path = Path("crates/ide-db/src/generated/lints.rs")
data, count = re.subn(r"file:///home/[^/\s]+/tmp/adder", "file:///work/cargo/tmp/adder", path.read_text())
if count != 1:
    raise SystemExit("Unexpected upstream output example.")
path.write_text(data)
PY

export RUSTC_BOOTSTRAP=1
export RUSTFLAGS="-Cpanic=unwind -Ctarget-feature=+exception-handling -Cllvm-args=-wasm-use-legacy-eh=false --remap-path-prefix=$source_tree=. --remap-path-prefix=$HOME/.cargo=cargo --remap-path-prefix=$HOME/.rustup=rustup"
cargo +1.98.1 rustc -Zbuild-std=std,panic_unwind -p rust-analyzer --bin rust-analyzer --locked \
    --release --target wasm32-wasip1-threads -j 4 -- \
    -Clink-arg=--export=zed_tool_output_alloc -Clink-arg=--export=zed_tool_output_free
gzip -n -6c target/wasm32-wasip1-threads/release/rust-analyzer.wasm > "$output_dir/rust-analyzer.wasm.gz"
