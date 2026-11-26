# Browser builds in Zed

Open a C, C++, Zig, or Rust source file. In the status bar, open **Run and Build** and
select **Build and Run WebAssembly**. Output, compiler errors, and exit status
appear in Zed's task terminal. Ctrl-C stops the task and Ctrl-D closes stdin.
The menu continues to target the active editor while the task terminal is focused.

Clang and LLD default to C17 and C++20 with the WASI SDK standard libraries. The
default build links source files from the active project, skipping conventional
output, vendor, and test directories. For projects with multiple entry points
or additional header directories, put an explicit source list in
`.zed/browser-build.json`:

```json
{
  "sources": ["src/main.cpp", "src/math.cpp"],
  "includeDirectories": ["src/headers"],
  "cStandard": "c23",
  "cppStandard": "c++23",
  "defines": ["FEATURE_ENABLED", "APP_NAME=\"Demo app\""],
  "libraries": {
    "wasi": ["lib/wasi/libmath.a"],
    "linux-x86_64-static": ["lib/linux/libmath.a"]
  },
  "args": ["convert", "--name", "two words"]
}
```

`cStandard` and `cppStandard` select Clang language standards, including GNU
dialects such as `gnu23` and `gnu++23`. `defines` supplies preprocessor macros
to each C or C++ source file. Write each one as a name or `NAME=value` without
the `-D` prefix. These options also apply to Linux cross-compilation targets.
On language server startup, clangd uses these options and `includeDirectories`
when the project has no `.clangd`, `compile_flags.txt`, or
`compile_commands.json`.

`libraries` takes project-relative static archives (`.a`) and object files
(`.o`) built for the selected target. Use `linux-x86_64` for the freestanding
target. List each library before its dependencies. Use `"linkCxx": true` when
a C entry point needs the C++ standard library through a linked dependency.
Explicit dependencies count toward the 16 MB project snapshot budget.

`args` supplies command-line arguments to the WASI program, one string per
argument. C, C++, Zig, and Rust support this field. A file with only `args` keeps the
default build inputs. Program output and its numeric exit code appear in the
task terminal, including exit code 0.

Use **Run and Build → Configure Build…** to open the project's configuration
from a C, C++, Zig, or Rust buffer. Save the configuration, switch back to the source
file, and select **Build and Run WebAssembly**. Each element of `args` arrives
as written, including spaces, empty strings, and non-ASCII characters.

For one run, select **Run and Build → Run WebAssembly with Arguments…** and
enter `convert --name "two words"`. The field splits quoted arguments and passes
them directly to the program. It also accepts a JSON array such as
`["convert", "--name", "two words"]`. This overrides the configured arguments for
that run. Submit an empty field to run without arguments. The task terminal shows
the program's return or exit status, or the build status if compilation fails.

**Cross-Compile → Linux x86-64 (Static)** downloads an ELF executable linked
with musl. C++ builds also link libc++ and its exception runtime. Run the file
on x86-64 Linux after making it executable. The Linux headers and libraries
download on demand. The task terminal reports the build exit code.

**Linux x86-64 (Freestanding)** uses `int main(void)` or a project-provided
`_start` and skips the system libraries. The WASI C++ target uses libc++ without
exceptions. Zig uses Zig 0.17.0's WebAssembly-hosted compiler and standard
library to build WASI executables.

The Rust browser task uses Cargo when the active file belongs to a package
with a `Cargo.toml`. Add public crates.io dependencies in `[dependencies]` as
usual. Cargo resolves the sparse index and checks each downloaded crate against
its checksum. The browser caches registry responses for reuse. Workspace
packages and local `path` dependencies also work. Rust build scripts run in the
crate directory with writable `OUT_DIR` and receive Cargo's environment. Generated files
and directives are available to the crate. The WASI host libraries download
on demand for build scripts and their build dependencies. Open the entry
file to choose among multiple binaries.
When the Rust language server is running, Cargo errors and warnings also appear
in Project Diagnostics. They clear as the affected source changes or after a
clean build.
Standalone Rust files use rustc 1.83 and the matching WASI standard library.
**Run and Build → Run Clippy** checks the active Rust file or its Cargo package.
Clippy uses `.clippy.toml` or `clippy.toml` and honors `[lints.clippy]` in Cargo
manifests. Its warnings and errors appear in Project Diagnostics when the Rust
language server is enabled. The driver downloads on first use.
Compiler suggestions marked machine-applicable appear in Zed’s Quick Fix menu.
Each file in a suggested edit must still match the checked source.

To check on save, set `check.command` to `clippy` in the Rust Analyzer
initialization options in `settings.json`:

```json
{
  "lsp": {
    "rust-analyzer": {
      "initialization_options": { "check": { "command": "clippy" } }
    }
  }
}
```

Git and private registries, procedural macros, and build scripts
that launch external tools are pending. Registry resolution uses the project's
saved `Cargo.lock` when present. Changes to the lockfile made by Cargo remain in
the build snapshot. The editor uses
[rustfmt](../rust/README.md) for formatting.

Builds run in a browser worker with a temporary project snapshot. The active
buffer's unsaved text is included. Save changes in other buffers before a run.
WASI programs can read the snapshot and use terminal I/O. Writes affect the
temporary filesystem. Tools download on first use, with versioned assets
reused through browser Cache Storage.

## Build inputs

- [Clang and LLD source](https://github.com/YoWASP/llvm-project/tree/97196c8eeb1d495fa43bb8af2fb26af5ef5b89fb)
- [WASI SDK 29](https://github.com/WebAssembly/wasi-sdk/releases/tag/wasi-sdk-29), including [wasi-libc](https://github.com/WebAssembly/wasi-libc/tree/ac020b86fd44bafe60aa4fa12f407d16e3731329) and [LLVM runtime libraries](https://github.com/llvm/llvm-project/tree/222fc11f2b8f25f6a0f4976272ef1bb7bf49521d)
- [Zig source](https://codeberg.org/ziglang/zig/src/commit/7647adab80dd088f4de3610fd245915a912eb6ad) and [Zigtools browser build](https://github.com/zigtools/playground/blob/60baeb6b2bba8686adb8557d9484688ff9106862/build.zig)
- [Zig 0.17.0 Linux sysroot source](https://ziglang.org/download/0.17.0/zig-0.17.0.tar.xz). The source tree includes musl, libc++, libc++abi, libunwind, and their headers and licenses.
- [WASI-hosted Rust release](https://github.com/oligamiq/rust_wasm/releases/tag/v0.2.1-release) and [corresponding Rust source](https://github.com/oligamiq/rust/tree/cf327c2068549194a29160499c2ecafa9061e46e)
- Clippy is built from that Rust revision with the [WASI configuration lookup patch](../../../packaging/zed/clippy-browser.patch), [LLVM from the fork's pinned revision](https://github.com/YoWASP/llvm-project/tree/69bd8547e9cc1268ca41339c98b2b17d13d69be3), and WASI SDK 29. Clippy's [MIT](LICENSE-MIT-clippy) and [Apache 2.0](LICENSE-APACHE-clippy) licenses are bundled here.
- [WASI Cargo source](https://github.com/oligamiq/cargo/tree/eb6c32a4a364d83946a36adbec3b4d2ee863a669), [filetime 0.2.27](https://crates.io/crates/filetime/0.2.27), and the [browser build patch](../../../packaging/zed/cargo-browser.patch)

Build Clang and LLD with matching native LLVM 22 table generators and the WASI
SDK. Obtain `zig.wasm`, `compiler_rt.o`, and the `lib/std` archive from the Zigtools
browser build. Extract its archive into `ZIG_ARTIFACTS/sdk` before packaging.

```sh
packaging/zed/build-browser-llvm.sh LLVM_SOURCE WASI_SDK NATIVE_LLVM_BIN LLVM_BUILD
python3 packaging/zed/pack-browser-compilers.py LLVM_BUILD WASI_SDK ZIG_ARTIFACTS editor/runtime/compiler
python3 packaging/zed/pack-browser-rustc.py rustc_opt.wasm.tar.gz wasm32-wasip1.tar.gz editor/runtime/compiler \
  --host-libraries wasm32-wasip1-threads.tar.gz --wasi-sdk WASI_SDK
sh packaging/zed/build-browser-cargo.sh WASI_SDK SCRATCH editor/runtime/compiler
sh packaging/zed/build-browser-clippy.sh RUST_SOURCE WASI_SDK NATIVE_LLVM_CONFIG editor/runtime/compiler
```

For Clippy, use a fresh checkout or source archive of the pinned Rust fork with
its Cargo, LLVM, backtrace, and stdarch submodules populated. `NATIVE_LLVM_CONFIG`
comes from a native LLVM build of the same LLVM revision with the AArch64,
WebAssembly, and X86 targets enabled.

To prepare the static Linux target, use Zig 0.17.0 and LLVM 22's `llvm-strip`.
Run the two commands from the same directory so the packer can resolve paths
in Zig's linker trace.

```sh
printf '#include <iostream>\nint main() { std::cout << 7; }\n' > probe.cpp
ZIG_VERBOSE_LINK=1 zig c++ -target x86_64-linux-musl -static -O2 probe.cpp -o probe 2> zig-link.log
python3 packaging/zed/pack-linux-sysroot.py zig-0.17.0.tar.xz zig-link.log LLVM_BIN/llvm-strip editor/runtime/compiler
```
