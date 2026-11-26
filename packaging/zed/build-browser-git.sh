#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  printf '%s\n' 'Usage: build-browser-git.sh WASI_SDK BUILD_DIRECTORY' >&2
  exit 2
fi

source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
wasi_sdk=$(cd "$1" && pwd)
mkdir -p "$2"
cd "$2"
build=$(pwd)
libgit2_version=1.9.4
wasm_git_revision=b629c73fb659780134a0ca12dbfbbfcac2bdb47f

download() {
  if [ ! -f "$2" ]; then
    curl -fsSL --retry 2 "$1" -o "$2.part"
    mv "$2.part" "$2"
  fi
  printf '%s  %s\n' "$3" "$2" | shasum -a 256 -c -
}

download "https://codeload.github.com/libgit2/libgit2/tar.gz/refs/tags/v$libgit2_version" libgit2.tar.gz \
  824b73bd13647800fe4b566a1008ae77fea0e3e3424edab632fcfd8c0b14ba8b
download "https://codeload.github.com/petersalomonsen/wasm-git/tar.gz/$wasm_git_revision" wasm-git.tar.gz \
  654a9351ac22d7be9cce529dc28ceae5b6bb4810e81007241b51a181d31ec297

tar -xzf libgit2.tar.gz
tar -xzf wasm-git.tar.gz
libgit2="$build/libgit2-$libgit2_version"
wasi_port="$build/wasm-git-$wasm_git_revision/libgit2patchedfiles"
cp "$wasi_port/src/sysdir.c" "$libgit2/src/libgit2/sysdir.c"
for file in src/util/integer.h src/util/unix/process.c src/util/unix/wasi_compat.c; do
  cp "$wasi_port/$file" "$libgit2/$file"
done
cp "$source_dir/git-wasi-socket.c" "$libgit2/src/libgit2/streams/socket.c"

cmake -S "$libgit2" -B "$build/wasi-build" \
  -DCMAKE_TOOLCHAIN_FILE="$wasi_sdk/share/cmake/wasi-sdk-p1.cmake" \
  -DWASI_SDK_PREFIX="$wasi_sdk" \
  -DCMAKE_BUILD_TYPE=MinSizeRel \
  "-DCMAKE_C_FLAGS=-DNO_MMAP -ffile-prefix-map=$build=." \
  -DREGEX_BACKEND=builtin -DUSE_HTTP_PARSER=builtin -DUSE_BUNDLED_ZLIB=ON \
  -DUSE_HTTPS=OFF -DUSE_SSH=OFF -DUSE_GSSAPI=OFF -DUSE_THREADS=OFF -DUSE_NSEC=OFF \
  -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTS=OFF -DBUILD_CLI=OFF -DBUILD_EXAMPLES=OFF
cmake --build "$build/wasi-build" --parallel "${CMAKE_BUILD_PARALLEL_LEVEL:-4}"

"$wasi_sdk/bin/clang" --target=wasm32-wasip1 -Os -Wall -Wextra -Werror \
  "-ffile-prefix-map=$source_dir=." -I"$libgit2/include" \
  "$source_dir/git-wasi.c" "$source_dir/git-wasi-history.c" \
  "$source_dir/git-wasi-branches.c" "$source_dir/git-wasi-blame.c" "$source_dir/git-wasi-stash.c" \
  "$build/wasi-build/libgit2.a" \
  -Wl,-z,stack-size=1048576,--strip-all -o zed-git.wasm
gzip -n -c zed-git.wasm > zed-git.wasm.gz
hash=$(shasum -a 256 zed-git.wasm.gz | cut -d ' ' -f 1)
printf '{"sha256":"%s"}\n' "$hash" > manifest.json
cp "$libgit2/COPYING" LICENSE-libgit2.txt
cp "$build/wasm-git-$wasm_git_revision/COPYING" LICENSE-wasm-git.txt
