# Browser port status

Base: `zed-industries/zed` revision `1a28cff4b409169bac058bca40dfbfeb7621d19b`.
This is a port of upstream Rust and GPUI code. Full desktop parity is unfinished.

## Implemented paths

| Area | Browser implementation | Verification |
| --- | --- | --- |
| Workspace | Upstream Workspace/MultiWorkspace, project and outline panels, panes, tabs, command palette, search and settings | WASM build and browser workspace checks |
| Documents | Browser filesystem with persisted documents and import/export dialogs | Browser file round trips |
| Vim | Upstream modes, keymap and status, enabled by `vim_mode` in Zed settings | WASM build and module validation |
| Syntax | All 22 bundled upstream syntax configurations, Tree-sitter grammars and queries | WASM build and module validation |
| Terminal | Upstream TerminalPanel, terminal_view and Alacritty grid; authenticated local Ark PTYs | Connector PTY and JavaScript transport tests |
| Local projects | Explicitly paired project mount; native reads, atomic writes, directory operations and polling file changes | Connector filesystem tests; integrated browser check pending |
| Language servers | Installed clangd and rust-analyzer through upstream LSP; binary pipes, stdin EOF and exit status | Real clangd diagnostics through connector; integrated browser check pending |
| Python | Pyright in a browser worker with project source snapshots and standard library stubs | Browser completion, hover, go-to-definition and diagnostics that clear after an edit. Worker tests include cross-file definitions, signature help and rename. |
| C/C++ | clangd 21 in a WebAssembly worker, with browser project files and bundled WASI headers | Chromium language-server and browser workspace checks |
| Rust | rust-analyzer in a WASI worker with a bundled standard library, Rust project graphs, and local Cargo path dependencies | Chromium language-server and browser workspace checks |
| Tasks | Upstream task picker and task terminal; native command, arguments, environment, working directory and completion status | Real task PTY exit/output tests; integrated browser check pending |

## Remaining work

- Git repository integration and Git UI. Compiling the Git service crate does not enable repository operations.
- Native debugger sessions and debugger UI.
- Extension installation, execution, grammars, themes and extension-provided language servers.
- Browser LSP runners for languages beyond C/C++, Python and Rust.
- Rust Cargo execution, registry packages, build scripts, procedural macros, and rustfmt in the browser.
- Collaboration, authentication, hosted services and AI integrations.
- Durable workspace/session metadata; SQLite databases currently live in memory.
- Desktop platform integrations, multiple OS windows and native file dialogs.
- Broader keyboard, IME, accessibility, touch and browser compatibility testing.

## Host connection boundaries

The connector shares one selected project. File operations reject paths and
symlinks outside it. Files are limited to 32 MiB per operation. File changes are
polled; deleted files are not moved to the operating system's trash. Disconnecting
retains the mount identity, so a host path cannot silently become a browser file.

Native tools require `--allow-processes`. They run under the connector user's
account, with that account's permissions. The selected project boundary applies
to file RPCs, not to programs running on the host. No tools are downloaded or
installed automatically. Language servers may return locations outside the shared
project; those files cannot currently be opened through the restricted mount.

Browser-only files and the separate Ark browser filesystem remain independent.
Pairing tokens stay in memory. Loading the page does not connect to a computer or
start a terminal. A connection is not restored automatically after a page reload.

## Verification commands

```sh
node --test tests/zed-native-host.test.mjs tests/zed-native-terminal.test.mjs
node --test tests/zed-browser-python.test.mjs tests/zed-browser-clangd.test.mjs tests/zed-browser-rust.test.mjs
python3 tests/zed-host-connector_test.py
python3 tests/connector_test.py
python3 packaging/zed/audit.py assets/vendor/zed
python3 scripts/audit-public.py
```

The host connector tests use disposable files and child processes. The clangd
integration test requires an installed clangd and skips if it is unavailable.
These tests do not establish full desktop parity or replace browser verification.
