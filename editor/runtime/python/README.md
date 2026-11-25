# Python execution in Zed

The wrench and hammer in Zed's status bar runs the current Python buffer in an
Alacritty terminal tab. CPython 3.14 runs in a browser worker through WASI.
It reads from a temporary copy of the browser workspace, including the active
buffer's unsaved text. The run receives terminal input and streams its output
back to Zed. Ctrl-C ends the worker and Ctrl-D closes standard input.

The runtime downloads on first run. There is no native connector or execution
server. The worker's WASI filesystem is in memory and changes last only for
that run. The runtime includes Python's portable standard library. Native
extensions, sockets, subprocesses and package installation are unavailable.
Browser cross-origin isolation enables blocking terminal input in the worker.

## Formatting

Zed's **editor: format** command formats the current Python buffer with Ruff.
The formatter loads in a browser worker on first use and uses the editor's
indentation settings. Set Python's `format_on_save` to `"on"` in Zed settings
to format at save time. Ruff project configuration and import organization
are separate from this formatting path.

The formatter comes from [Ruff 0.17.6](https://github.com/astral-sh/ruff/tree/0.17.6/crates/ruff_wasm)
and the corresponding [WebAssembly package](https://www.npmjs.com/package/@astral-sh/ruff-wasm-web/v/0.17.6).
The package's SHA-512 integrity value is
`/Pp6yrmV8oLg6cHkMEqYp0E3G+vbFF7lhSmYDMcKLddp2z3iV+y6gn2g4TsJ2+xOGgKR3wOAaOplfqjotmP1gg==`.
Copy `LICENSE` and `ruff_wasm.js` verbatim. In the WASM asset, replace each
CI build-root prefix with the same-length relative prefix `./ruff-build/`.

## Runtime source

- [CPython 3.14.10](https://www.python.org/downloads/release/python-31410/)
- [WASI SDK 24](https://github.com/WebAssembly/wasi-sdk/releases/tag/wasi-sdk-24)
- [WASI browser filesystem](https://github.com/bjorn3/browser_wasi_shim/tree/v0.4.2), also used by the Rust runtime

Build CPython using its `Tools/wasm/wasi` script and WASI SDK 24. Pass
`--without-ensurepip --disable-test-modules --prefix=/usr` to configure. Run
`llvm-strip --strip-all` on the WASI module before packaging it.

```sh
python3 packaging/zed/pack-python-runtime.py CPYTHON_SOURCE PYTHON_WASM editor/runtime/python
```
