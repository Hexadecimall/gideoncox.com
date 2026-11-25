# Browser port status

Base: `zed-industries/zed` revision `1a28cff4b409169bac058bca40dfbfeb7621d19b`.
This is a port of upstream Rust and GPUI code. Full desktop parity is unfinished.

## Implemented paths

| Area | Browser implementation | Verification |
| --- | --- | --- |
| Workspace | Upstream Workspace/MultiWorkspace, project and outline panels, panes, tabs, command palette, search and settings | WASM build and browser workspace checks |
| Documents | Browser filesystem with persisted documents and import/export dialogs | Browser file round trips |
| Clipboard | Upstream editor Copy, Cut and Paste. Standard shortcuts use the browser paste event, and Edit → Paste uses the browser clipboard API. | Browser clipboard round trips |
| Device folders | Chromium folder picker and direct file reads and writes through the selected handle. Zed remembers the most recent folder and checks its permission on reopen. | Chromium folder-handle and reload checks |
| Settings and trust | Browser-backed `settings.json`, native settings UI, bundled read-only defaults and remembered project trust choices | Workspace reload and settings file checks |
| Startup cache | Versioned WebAssembly download in Cache Storage, with a network fallback | Cache tests and Chromium reload checks |
| Vim | Upstream modes, keymap and status, enabled by `vim_mode` in Zed settings | WASM build and module validation |
| Syntax | All 22 bundled upstream syntax configurations, Tree-sitter grammars and queries | WASM build and module validation |
| Terminal | Upstream TerminalPanel, terminal_view and Alacritty grid. Browser Ark uses Zed's saved project filesystem, and `edit` opens files in Zed. Authenticated native Ark PTYs remain available. | Browser Ark IPC and connector PTY tests |
| Local projects | Explicitly paired project mount; native reads, atomic writes, directory operations and polling file changes | Connector filesystem tests; integrated browser check pending |
| Language servers | Installed clangd and rust-analyzer through upstream LSP; binary pipes, stdin EOF and exit status | Real clangd diagnostics through connector; integrated browser check pending |
| Python | Pyright in a browser worker with project source snapshots and standard library stubs | Browser completion, hover, go-to-definition and diagnostics that clear after an edit. Worker tests include cross-file definitions, signature help and rename. |
| Python formatting | Ruff WebAssembly worker through Zed's Format command and formatting settings | LSP document edit and formatting tests |
| Python execution | CPython WASI worker and upstream task terminal for browser workspace files | WASI runtime and buffer snapshot tests |
| Diagnostics | Upstream Language Servers menu and Project Diagnostics view | Browser status bar and diagnostic checks |
| Agent | Upstream Agent Panel and Threads Sidebar, LMA WebAssembly inference, and local Qwen3 read-only project tools | Browser file reads, project search, and restored thread history |
| Edit Prediction | Upstream inline prediction accepted with Tab, backed by browser LMA and Qwen2.5-Coder | Browser completion and saved buffer check |
| C/C++ | clangd 21 in a WebAssembly worker, with browser project files and bundled WASI headers | Chromium language-server and browser workspace checks |
| Browser builds | Clang and LLD compile multi-file C and C++ for WASI and static Linux x86-64 with standard libraries. A freestanding Linux target is also available. Zig builds and runs WASI programs. Project build settings supply WASI arguments. | Chromium task terminal, argument forwarding, exit status and compiler-worker checks |
| Rust | rust-analyzer in a WASI worker with a bundled standard library, local Cargo path dependencies, and generated source from successful builds | Concurrent worktrees and browser diagnostics on generated Rust source |
| Rust formatting | WASI rustfmt through Zed's Format command and format-on-save, with project rustfmt configuration and Cargo editions | Browser formatting and format-on-save checks |
| Rust builds | WASI Cargo and rustc build workspaces with local path dependencies and public crates.io packages. Rust build scripts run inside WASI. Run and Build picks the binary from the active source and preserves arguments and exit status. Cargo compiler messages reach Project Diagnostics through the Rust language server. | Workspace, registry, build-script, and diagnostics tests, plus the Zed browser task |
| Rust Clippy | On-demand WASI Clippy for Rust files and Cargo packages through Run and Build or Rust Analyzer's `check.command` setting. Clippy reports findings in Project Diagnostics and reads native lint configuration. | Standalone and Cargo lint tests, including local dependencies, build scripts, and denied lints. Browser save and diagnostic clearing checks. |
| Tasks | Upstream task picker and task terminal; native command, arguments, environment, working directory and completion status | Real task PTY exit/output tests; integrated browser check pending |

The browser uses the desktop status layout for Language Servers, Project Diagnostics
and Edit Prediction. Threads Sidebar uses Zed's left-side toggle. Agent, Git and
Collaboration controls are on the left, and Extensions is in the title-bar user
menu. The pending controls display a Zed notification when activated.

## Remaining work

- Git repository integration and Git UI. Compiling the Git service crate does not enable repository operations.
- Native debugger sessions and debugger UI.
- Extension installation, execution, grammars, themes and extension-provided language servers.
- Browser LSP runners for languages beyond C/C++, Python and Rust.
- Rust browser tooling for Git and private registry dependencies, build scripts that launch external tools, and procedural macros. Additional native targets and build-system integration for browser C, C++, and Zig projects.
- Collaboration, authentication, hosted services, and full Agent tool support.
- Audit remaining desktop workspace and session state for browser persistence.
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
