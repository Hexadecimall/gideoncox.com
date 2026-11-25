# Browser builds in Zed

Open a C, C++, or Zig source file. In the status bar, open **Run and Build** and
select **Build and Run WebAssembly**. Output, compiler errors, and exit status
appear in Zed's task terminal. Ctrl-C stops the task and Ctrl-D closes stdin.
The menu continues to target the active editor while the task terminal is focused.

Clang and LLD compile C17 and C++20 with the WASI SDK standard libraries. The
default build links source files from the active project, skipping conventional
output, vendor, and test directories. For projects with multiple entry points
or additional header directories, put an explicit source list in
`.zed/browser-build.json`:

```json
{
  "sources": ["src/main.cpp", "src/math.cpp"],
  "includeDirectories": ["src/headers"],
  "args": ["convert", "--name", "two words"]
}
```

`args` supplies command-line arguments to the WASI program, one string per
argument. C, C++, and Zig support this field. A file with only `args` keeps the
default build inputs. Program output and its numeric exit code appear in the
task terminal, including exit code 0.

**Cross-Compile → Linux x86-64 (Freestanding)** downloads a statically linked
ELF executable. It supports `int main(void)` or a project-provided `_start`.
This target has no Linux system headers or C/C++ runtime libraries. The WASI
C++ target does not support exceptions. Zig uses Zig 0.17.0's WebAssembly-hosted
compiler and standard library to build WASI executables.

Builds run in a browser worker with a temporary project snapshot. The active
buffer's unsaved text is included. Save changes in other buffers before a run.
WASI programs can read the snapshot and use terminal I/O. Writes affect the
temporary filesystem. Tools download on first use, with versioned assets
reused through browser Cache Storage.

## Build inputs

- [Clang and LLD source](https://github.com/YoWASP/llvm-project/tree/97196c8eeb1d495fa43bb8af2fb26af5ef5b89fb)
- [WASI SDK 29](https://github.com/WebAssembly/wasi-sdk/releases/tag/wasi-sdk-29), including [wasi-libc](https://github.com/WebAssembly/wasi-libc/tree/ac020b86fd44bafe60aa4fa12f407d16e3731329) and [LLVM runtime libraries](https://github.com/llvm/llvm-project/tree/222fc11f2b8f25f6a0f4976272ef1bb7bf49521d)
- [Zig source](https://codeberg.org/ziglang/zig/src/commit/7647adab80dd088f4de3610fd245915a912eb6ad) and [Zigtools browser build](https://github.com/zigtools/playground/blob/60baeb6b2bba8686adb8557d9484688ff9106862/build.zig)

Build Clang and LLD with matching native LLVM 22 table generators and the WASI
SDK. Obtain `zig.wasm`, `compiler_rt.o`, and the `lib/std` archive from the Zigtools
browser build. Extract its archive into `ZIG_ARTIFACTS/sdk` before packaging.

```sh
packaging/zed/build-browser-llvm.sh LLVM_SOURCE WASI_SDK NATIVE_LLVM_BIN LLVM_BUILD
python3 packaging/zed/pack-browser-compilers.py LLVM_BUILD WASI_SDK ZIG_ARTIFACTS editor/runtime/compiler
```
