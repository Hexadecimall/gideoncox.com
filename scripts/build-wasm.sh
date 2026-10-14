#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
BUILD_DIR=${BUILD_DIR:-"$PWD/.cache/wasm"}
mkdir -p "$BUILD_DIR" assets/wasm
export ZIG_LOCAL_CACHE_DIR="$BUILD_DIR/zig-local"
export ZIG_GLOBAL_CACHE_DIR="$BUILD_DIR/zig-global"
export CARGO_TARGET_DIR="$BUILD_DIR/rust"
export RUSTFLAGS="--remap-path-prefix=$PWD=/site --remap-path-prefix=$HOME=/toolchain -C debuginfo=0"
RUST_TOOLCHAIN=${RUST_TOOLCHAIN:-1.98.1}

zig cc -target wasm32-freestanding -O2 -nostdlib -Wl,--no-entry -Wl,--strip-all src/field/field.c -o assets/wasm/field.wasm
zig cc -target wasm32-freestanding -O2 -nostdlib -Wl,--no-entry -Wl,--strip-all src/hop/runner.c -o assets/wasm/runner.wasm
zig c++ -target wasm32-wasi -std=c++20 -O2 -fno-exceptions -fno-rtti -mexec-model=reactor \
  "-ffile-prefix-map=$PWD=/site" "-ffile-prefix-map=$HOME=/toolchain" \
  -Wl,--strip-all -Wl,--max-memory=67108864 \
  src/ark/bridge.cpp src/ark/core/lexer.cpp src/ark/core/parser.cpp src/ark/core/expand.cpp \
  -o assets/wasm/ark-core.wasm
cargo "+$RUST_TOOLCHAIN" build --manifest-path src/terminal/Cargo.toml --offline --target wasm32-unknown-unknown --release
cp "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/ark_browser_runtime.wasm" assets/wasm/terminal.wasm
