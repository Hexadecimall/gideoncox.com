# Browser port status

Base: `zed-industries/zed` revision `1a28cff4b409169bac058bca40dfbfeb7621d19b`.
This is a port of upstream Rust and GPUI code. Full desktop parity is unfinished.

## Implemented paths

| Area | Browser implementation | Verification |
| --- | --- | --- |
| Workspace | Upstream Workspace/MultiWorkspace, project and outline panels, panes, tabs, command palette, search and settings | WASM build and browser workspace checks |
| Documents | Browser filesystem with persisted documents and import/export dialogs | Browser file round trips |
| Clipboard | Upstream editor Copy, Cut and Paste. Standard shortcuts use the browser paste event, and Edit → Paste uses the browser clipboard API. | Browser clipboard round trips |
| Device folders | Chromium folder picker and direct file reads and writes through the selected handle. Zed remembers the most recent folder and checks its permission on reopen. External changes reach the worktree through the browser observer or bounded metadata polling. | Folder-handle and reload checks, plus browser verification of external edits, new files, Git refresh, and unsaved-buffer protection through the polling path |
| Settings and trust | Upstream Settings editor with search, user and project scopes, editable `settings.json`, keymap editing, bundled defaults and remembered project trust | Browser Settings and reload checks |
| Startup cache | Versioned WebAssembly download in Cache Storage, with a network fallback. One navigation restores worker isolation after a hard refresh. | Cache tests and Chromium desktop and compact hard-refresh checks, including a multi-file C++ build and run after recovery |
| Extensions | Upstream Extensions tab, catalog, search, filters, version picker, theme selectors, and snippet completions. Browser storage keeps installed themes, icon themes, and snippet packages. | Chromium catalog search, theme and icon selection, snippet completion, reload, and removal |
| Vim | Upstream modes, keymap and status, enabled by `vim_mode` in Zed settings | WASM build and module validation |
| Syntax | All 22 bundled upstream syntax configurations, Tree-sitter grammars and queries | WASM build and module validation |
| Terminal | Upstream TerminalPanel, terminal_view and Alacritty grid. Browser Ark uses Zed's saved project filesystem, and `edit` opens files in Zed. Authenticated native Ark PTYs remain available. | Browser Ark IPC and connector PTY tests |
| Local projects | Explicitly paired project mount; native reads, atomic writes, directory operations and polling file changes | Connector filesystem tests; integrated browser check pending |
| Language servers | Installed clangd and rust-analyzer through upstream LSP; binary pipes, stdin EOF and exit status | Real clangd diagnostics through connector; integrated browser check pending |
| Python | Pyright in a browser worker with project source snapshots and standard library stubs | Browser completion, hover, go-to-definition and diagnostics that clear after an edit. Worker tests include cross-file definitions, signature help and rename. |
| Python formatting | Ruff WebAssembly worker through Zed's Format command and formatting settings | LSP document edit and formatting tests |
| Python execution | CPython WASI worker and upstream task terminal for browser workspace files, with per-run arguments and exit codes | Active-buffer snapshot, exact `sys.argv` values, and exit status verified with bundled CPython WASI |
| Diagnostics | Upstream Language Servers menu and Project Diagnostics view | Browser status bar and diagnostic checks |
| Agent | Upstream Agent Panel and Threads Sidebar with an LMA model library and optional loopback desktop inference. Downloads and imports track progress and save GGUF files for explicit loading later. | Hub search, browser model download progress, import and removal, settings reload, and desktop chat streaming |
| Edit Prediction | Upstream inline predictions with the local Qwen2.5-Coder model | Browser Edit Prediction and settings persistence |
| C/C++ | clangd 21 in WebAssembly, with each project running its own worker and all workers in the page sharing the compiled module. Projects without Clang configuration get browser build flags and WASI headers. | Chromium workspace and diagnostics checks, including build flags, concurrent worktrees, and a restarted server using one module download |
| Browser builds | Clang and LLD compile multi-file C and C++ for WASI and static Linux x86-64 with standard libraries. A freestanding Linux target is also available. Zig builds and runs WASI programs. Project build settings supply C/C++ language standards, macros, and WASI arguments. | Chromium task terminal and compiler-worker checks for configured mixed-language builds, cross-compilation, argument forwarding, and exit status |
| Rust | rust-analyzer in a WASI worker with a bundled standard library, local Cargo path dependencies, and generated source from successful builds | Concurrent worktrees and browser diagnostics on generated Rust source |
| Rust formatting | WASI rustfmt through Zed's Format command and format-on-save, with project rustfmt configuration and Cargo editions | Browser formatting and format-on-save checks |
| Rust builds | WASI Cargo and rustc build workspaces with local path dependencies and public crates.io packages. Rust build scripts run inside WASI. Run and Build picks the binary from the active source and preserves arguments and exit status. Cargo compiler messages reach Project Diagnostics through the Rust language server. | Workspace, registry, build-script, and diagnostics tests, plus the Zed browser task |
| Rust Clippy | On-demand WASI Clippy for Rust files and Cargo packages through Run and Build or Rust Analyzer's `check.command` setting. Clippy reports findings in Project Diagnostics, reads native lint configuration, and exposes machine-applicable suggestions in Quick Fix. | Standalone and Cargo lint tests, including local dependencies, build scripts, and denied lints. Browser save and Quick Fix checks. |
| Local Git | Upstream Git panel with a WASI libgit2 worker for browser-stored projects. Initialize repositories, switch branches, stage or unstage individual hunks or entire files, and commit using the repository's `user.name` and `user.email` settings. Browse repository and file history, search commits, and open commits to inspect their changes. File history and search follow renames independently through each merge parent. | Browser branch switching with unrelated edits and conflict protection, individual hunk staging and unstaging, file history through two renames in a merge, and commit persistence after reload. Worker tests cover branch creation and deletion, history order, packed refs, detached HEAD, and shallow history. |
| Git in folders opened from disk | The same Git panel reads branch, status, diff, blame, and history data from the selected directory handle. Status and unstaged diff scans normally read tracked file contents and Git rules, using only filenames for untracked files. Repository snapshots stay in the browser and use the Git worker's 16 MiB and 8,192-entry limits. | Mounted browser directory fixture in the Git panel, including diffs and rename history. Worker tests cover large ignored files and write rejection. |
| Git remotes and permalinks | The Git worker reads remote names and URLs, resolves branch remote preferences, and saves remote additions and removals in trusted browser-stored repositories. Zed's upstream hosting providers build commit-specific file and line links from configured remotes. | Branch-picker remote creation and reload, opening and copying a GitHub line permalink from a mounted folder, and worker tests for remote selection and removal. |
| Git stash | Zed's stash commands and picker use the browser Git backend. Trusted browser-stored repositories can stash all, tracked, or staged changes, then view, apply, pop, or drop a stash. | Browser Stash All, diff view and Pop. Worker round trips for selected files, staged hunks, binary files, renames, and conflicts. |
| Tasks | Upstream task picker and task terminal; native command, arguments, environment, working directory and completion status | Real task PTY exit/output tests; integrated browser check pending |

The browser uses the desktop status layout for Language Servers, Project Diagnostics
and Edit Prediction. Threads Sidebar uses Zed's left-side toggle. Agent, Git and
Collaboration controls are on the left, and Extensions is in the title-bar user
menu. The pending controls display a Zed notification when activated.

## Remaining work

- Further desktop compatibility for file history across merges, remote fetch, pull and push, GitHub authentication and hosted actions, and Git writes in folders opened from disk.
- Native debugger sessions and debugger UI.
- Developer extensions, extension execution, grammars, and extension-provided language servers.
- Browser LSP runners for languages beyond C/C++, Python and Rust.
- Rust browser tooling for Git and private registry dependencies, build scripts that launch external tools, and procedural macros. Additional native targets and build-system integration for browser C, C++, and Zig projects.
- Collaboration, authentication, hosted services, and full Agent tool support. Browser LMA supports read-only project tools.
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
