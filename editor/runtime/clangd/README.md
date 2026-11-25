# clangd for the browser

The clangd 21.1.0 WebAssembly build and Emscripten loader come from the
[clangd-in-browser deployment](https://github.com/guyutongxue/clangd-in-browser/actions/runs/20614515265)
for revision [4acd71dec642](https://github.com/guyutongxue/clangd-in-browser/tree/4acd71dec6428906271e922f119d794344e0d35e).
The pinned source includes the [build script](https://github.com/guyutongxue/clangd-in-browser/blob/4acd71dec6428906271e922f119d794344e0d35e/build.sh)
and [clangd transport patch](https://github.com/guyutongxue/clangd-in-browser/blob/4acd71dec6428906271e922f119d794344e0d35e/wait_stdin.patch).
It builds [LLVM 21.1.0](https://github.com/llvm/llvm-project/tree/llvmorg-21.1.0)
with [Emscripten 4.0.22](https://github.com/emscripten-core/emscripten/tree/4.0.22)
and packages headers from [WASI SDK 29](https://github.com/WebAssembly/wasi-sdk/tree/wasi-sdk-29).

The deployed inputs are available as
[clangd.js](https://clangd.guyutongxue.site/wasm/clangd.js) and
[clangd.wasm](https://clangd.guyutongxue.site/wasm/clangd.wasm). Prepare those files
with the checked-in patcher to verify their hashes, limit the thread pool and
initial memory, and gzip the executable for static hosting.

```sh
python3 packaging/zed/patch-clangd.py INPUT_DIRECTORY editor/runtime/clangd
```

The worker loads from this site. It runs one server for the browser workspace,
starts with 256 MiB of shared memory, and uses the WASI headers for fallback
analysis when the project has no compile database. The worker receives a project
snapshot of at most 16 MiB, with a 2 MiB limit per file. It mirrors saved file
changes during the session. The editor’s **Format** command uses the project’s
`.clang-format` or `_clang-format` file when one is present.
