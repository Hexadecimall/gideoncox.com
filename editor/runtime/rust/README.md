# Rust in the browser

The worker starts rust-analyzer on demand for Rust files in Zed's browser
workspace. It uses the workspace's virtual files, a source snapshot of Rust's
standard libraries for `wasm32-wasip1`, and target metadata from Rust 1.98.1.
The first server start downloads both compressed assets from this site.

Standalone Rust files, local Cargo packages, Cargo path dependencies, and
`rust-project.json` workspaces use rust-analyzer's crate graph and native
diagnostics. A local Cargo manifest supplies package names, editions, library
and binary roots, and default feature flags. Registry dependency resolution,
procedural macros, and opening definitions in the bundled
standard library through Zed's project filesystem remain pending.

[Run and Build](../compiler/README.md) uses browser-hosted Cargo for an
offline WebAssembly build when the Rust file is in a Cargo package. Local
workspace members, path dependencies, and Rust build scripts build in the browser.
After a successful build, rust-analyzer uses the generated files and the
script's cfg and environment values for diagnostics in that browser session.
Run the build again after changing a build script or reloading the page.

Zed's Format command and format-on-save use rustfmt 1.10.0 in the worker.
The formatter reads the nearest saved `.rustfmt.toml` or `rustfmt.toml` and the
package's Cargo edition, including editions inherited from a workspace.

## Corresponding source

- [Rust analyzer WASI fork, pinned revision](https://github.com/oligamiq/rust-analyzer/tree/b1829d7770d1b919b95f4b3028aa66085131df6f)
- [Rust standard library, pinned revision](https://github.com/rust-lang/rust/tree/48a229ceaefd4985c50990b14116b6d856af0985/library)
- [WASI threads shim 0.5.0](https://github.com/oligamiq/browser_wasi_shim/tree/47a640bdcf9c7623b86e8d4a2ea773eaf56246c0/threads)
- [WASI filesystem shim 0.4.2](https://github.com/bjorn3/browser_wasi_shim/tree/v0.4.2)
- [smol-toml 1.9.1](https://www.npmjs.com/package/smol-toml/v/1.9.1)
- [Rustfmt browser build from Scalar 0.5.0](https://github.com/scalar/formatters/tree/997e8719282cd7ca9296af993fd2f05ffa0323fd/build/rust_fmt)
- [Rustfmt and compiler source](https://github.com/rust-lang/rust/tree/58cf8f9c35b355199727627d07ae34a4e2846d67)

`rustfmt/rust_fmt.wasm.gz` repackages the WASI reactor in
`@scalar/rust-fmt@0.5.0` from Brotli to gzip and anonymizes embedded build paths.
The original license and linked component notices are in `rustfmt/`.

```sh
node packaging/zed/pack-browser-rustfmt.mjs rust_fmt.wasm.br editor/runtime/rust/rustfmt/rust_fmt.wasm.gz
```

Use the pinned analyzer source checkout and Rust 1.98.1 with the
`wasm32-wasip1-threads` target and `rust-src` component. The build step applies
the checked-in patches for tool output allocation and virtual file loading.
The standard library packer uses the same toolchain's installed source.
The bundled WASI threads shim applies `path_rename` when both paths share a
directory descriptor. Rust compilation uses it to publish temporary metadata.

```sh
sh packaging/zed/build-rust-analyzer.sh ANALYZER_SOURCE editor/runtime/rust
python3 packaging/zed/rust-sysroot.py editor/runtime/rust
```
