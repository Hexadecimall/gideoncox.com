#!/bin/sh
set -eu

if [ "$#" -ne 4 ]; then
  printf '%s\n' 'Usage: build-browser-llvm.sh LLVM_SOURCE WASI_SDK NATIVE_LLVM_BIN BUILD_DIRECTORY' >&2
  exit 2
fi

llvm_source=$(cd "$1" && pwd)
wasi_sdk=$(cd "$2" && pwd)
host_llvm=$(cd "$3" && pwd)
build=$4

export WASI_SDK_PATH="$wasi_sdk"

cmake -S "$llvm_source/llvm" -B "$build" \
  -DCMAKE_TOOLCHAIN_FILE="$wasi_sdk/share/cmake/wasi-sdk-p1.cmake" \
  -DCMAKE_BUILD_TYPE=MinSizeRel \
  -DCMAKE_C_FLAGS='-D_WASI_EMULATED_MMAN -mcpu=lime1' \
  -DCMAKE_CXX_FLAGS='-D_WASI_EMULATED_MMAN -mcpu=lime1' \
  -DCMAKE_EXE_LINKER_FLAGS='-lwasi-emulated-mman -Wl,-z,stack-size=8388608,--stack-first,--strip-all' \
  -DLLVM_NATIVE_TOOL_DIR="$host_llvm" \
  '-DLLVM_ENABLE_PROJECTS=clang;lld' \
  '-DLLVM_TARGETS_TO_BUILD=WebAssembly;X86' \
  -DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-wasip1 \
  -DLLVM_ENABLE_THREADS=OFF \
  -DLLVM_ENABLE_PIC=OFF \
  -DLLVM_ENABLE_LIBXML2=OFF \
  -DLLVM_ENABLE_ZLIB=OFF \
  -DLLVM_ENABLE_ZSTD=OFF \
  -DLLVM_INCLUDE_TESTS=OFF \
  -DLLVM_INCLUDE_BENCHMARKS=OFF \
  -DLLVM_INCLUDE_EXAMPLES=OFF \
  -DLLVM_INCLUDE_DOCS=OFF \
  -DCLANG_ENABLE_ARCMT=OFF \
  -DCLANG_ENABLE_STATIC_ANALYZER=OFF

cmake --build "$build" --parallel --target clang lld
