# random crap

A static personal site with an interactive particle field, a header doodle pad, Hop, a CPS tester, daily quotes, an Ark terminal, and a reserved page for Zed.

## Preview

Serve the repository root over HTTP so modules, workers, and WebAssembly can load:

```sh
python3 -m http.server 8767 --bind 127.0.0.1
```

Open `http://127.0.0.1:8767/`. The checked-in WebAssembly and terminal display assets are ready to serve; no package installation is needed.

## Layout

- `index.html` — homepage, navigation, and search metadata.
- `games/hop/` — the standalone game, linked under Games in the site menu.
- `terminal/`, `editor/`, `settings/` — full tool and customization pages.
- `assets/css/` — base styles and separate styles for each interface.
- `assets/js/` — page behavior; terminal runtime modules live in `terminal/`.
- `assets/wasm/` — compiled modules served by the site.
- `assets/vendor/` — pinned xterm.js and fit addon, including licenses.
- `src/field/` — doodle rasterizer in C.
- `src/hop/` — fixed-step game physics in C.
- `src/ark/` — Ark lexer, parser, expander, and the browser ABI bridge.
- `src/orbit/` — the homepage particle simulation, compiled to WebAssembly.
- `src/terminal/` — Rust filesystem and browser commands.
- `connector/` — optional local Ark connector.
- `scripts/` — build and public-source audit commands.
- `tests/` — shell, editor, game, and connector checks.

## Terminal modes

**This computer** uses a local connector and the installed native Ark shell. Start it on the computer to control:

```sh
python3 connector/ark_connector.py
```

Paste its temporary pairing token into the site and choose Connect. The connector binds only to `127.0.0.1`, requires the token on every request, and accepts only the configured website origins. Tokens and terminal contents are not logged or stored by the site. Closing the connector or pressing Disconnect ends its PTY session. Closing the page disconnects it; an abandoned session times out after 30 seconds without requests.

For the local preview, explicitly allow its origin:

```sh
python3 connector/ark_connector.py --origin http://127.0.0.1:8767
```

Requires Python 3 and Ark on macOS/Linux, or inside WSL on Windows. A Chromebook needs its Linux environment enabled for native commands. Browser permissions or device management can block local connections. This mode runs with the connector user's real filesystem and process permissions.

**Browser files** runs without a connector. Both modes use xterm.js, with selectable text, scrollback, saved display preferences, and an on-screen row for Escape, Tab, Control-C, arrow keys, and Enter. Browser input supports history, completion, cursor editing, and multiline shell commands. Ark's C++ lexer, parser, and expander compile to WebAssembly; Rust supplies the filesystem and commands, and a worker executes the parsed shell tree. It supports variables, quoting, arithmetic expansion, command substitution, pipes, redirects, functions, `if`, word-list `for`, and `while`. It does not launch native executables, background jobs, or C-style `for` loops. `grep` matches literal text. Workspace limits are 2,000 entries, 512 KiB per text file, and 4 MiB total file contents.

Browser files are stored in IndexedDB. Clearing site data removes them. Copy important contents before clearing storage. If persistent storage is unavailable, the terminal reports that files are temporary. The public editor page is a placeholder for a real Zed web port. The earlier browser editor prototype is retained in source and tests but is not presented as Zed.

## Customization

Settings under the site menu persist per browser and sync across tabs. Controls cover accent/background/font/spacing/motion, terminal cursor/font/scrollback, doodle brush/color, CPS duration, and Hop colors/controls/effects. Defaults preserve the five-second CPS test. Native Ark configuration still belongs to the installed shell.

## Build WebAssembly

Requires an installed Zig compiler and Rust with the `wasm32-unknown-unknown` target. The tested toolchains are Zig 0.17.0 and Rust 1.98.1. The script never downloads dependencies.

```sh
BUILD_DIR=/path/to/scratch RUST_TOOLCHAIN=1.98.1 ./scripts/build-wasm.sh
```

Build products are stripped and source paths are remapped. `BUILD_DIR` defaults to `.cache/wasm`.

The Ark source retains its MIT license in `src/ark/core/LICENSE`. Browser-specific changes replace POSIX globbing and command capture with host callbacks, route parse errors through the bridge, and report unfinished quotes for multiline input. Native Ark source is not modified by this project.

## Checks

```sh
node --test tests/*.test.mjs
cargo +1.98.1 test --offline --manifest-path src/terminal/Cargo.toml
python3 tests/connector_test.py
python3 scripts/audit-public.py
```

The native connector check requires Ark, runs with a temporary home, and verifies authentication, origin rejection, a real disk write/read, PTY resizing, and disconnect. Browser UI checks should also cover keyboard access, shared editor files, game pause/fullscreen, and narrow screens.

## Hosting

Serve this repository root as a static site. `CNAME`, `robots.txt`, `sitemap.xml`, and `.nojekyll` are included for GitHub Pages. HTTPS is configured in the hosting settings, separately from these source files. The only external content request is the daily quote API; the terminal libraries are bundled locally.

The header drawing pad saves its pixels on this device between pages. The homepage field stops while offscreen, paused, or hidden, and respects reduced-motion preferences.

## Typing tester

`/uncategorized/typing/` provides 15/30/60-second tests, 25/50/100-word tests, and seven keyboard practice lessons. Tests start on the first character. The timer uses elapsed time rather than counting animation frames. Corrected mistakes still count against attempt accuracy; WPM uses currently correct characters divided by five and elapsed minutes. Practice requires the completed text to match, and 95% attempt accuracy marks a lesson complete. Best test scores, lesson progress, and test options stay in local storage on the current device.

The caret and text scroll smoothly, practice keys respond to presses, and a thin progress line tracks the test. Motion follows the site's accessibility preference. While typing, Tab focuses restart and Enter starts a fresh test.
