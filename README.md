# random crap

A static personal site with Astral and Ark project pages, verified downloads, an interactive particle field, a header doodle pad, Hop, SuperSatisfaction, a typing tester, an Ark terminal, and a browser port of Zed’s editor.

## Preview

Serve the repository root over HTTP so modules, workers, and WebAssembly can load:

```sh
python3 -m http.server 8767 --bind 127.0.0.1
```

Open `http://127.0.0.1:8767/`. The checked-in WebAssembly and terminal display assets are ready to serve; no package installation is needed.

## Layout

- `index.html` — homepage, navigation, and search metadata.
- `projects/frame/` — Frame product page, development status, and launcher preview.
- `games/hop/` — the standalone game, linked under Games in the site menu.
- `games/supersatisfaction/` — twelve interactive toys, with optional sound and canvas controls.
- `projects/` — Astral and Ark descriptions, installation, and source links.
- `downloads/` — versioned Astral CLI bundle, checksum, and pinned source installer.
- `packaging/astral/` — portable-bundle installer and its included instructions.
- `terminal/`, `editor/`, `settings/` — full tool and customization pages.
- `assets/css/` — base styles and separate styles for each interface.
- `assets/js/` — page behavior; terminal runtime modules live in `terminal/`.
- `assets/wasm/` — compiled modules served by the site.
- `assets/vendor/` — pinned terminal libraries and the Zed WASM distribution, with source and licenses.
- `src/field/` — doodle rasterizer in C.
- `src/hop/` — fixed-step game physics in C.
- `src/satisfaction/` — magnetic bead springs in C, compiled to WebAssembly.
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

Browser files are stored in IndexedDB. Clearing site data removes them. Copy important contents before clearing storage. If persistent storage is unavailable, the terminal reports that files are temporary. Zed uses a separate browser file store; its files are not currently shared with Ark.

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
python3 tests/audit_public_test.py
python3 scripts/audit-public.py
```

The native connector check requires Ark, runs with a temporary home, and verifies authentication, origin rejection, a real disk write/read, PTY resizing, and disconnect. Browser UI checks should also cover keyboard access, editor file round trips, game pause/fullscreen, and narrow screens.

## Hosting

Serve this repository root as a static site. `CNAME`, `robots.txt`, `sitemap.xml`, and `.nojekyll` are included for GitHub Pages. HTTPS is configured in the hosting settings, separately from these source files. The only external content request is the daily quote API; the terminal libraries are bundled locally.

The header drawing pad saves its pixels on this device between pages. The homepage field stops while offscreen, paused, or hidden, and respects reduced-motion preferences.

## Frame

The Frame page describes the current Minecraft 1.8.9 client and links to an
actual launcher screenshot. Public downloads and purchasing remain closed.
The client source is private and is not part of this website. Only product-page
content and approved public assets belong under `projects/frame/` and
`assets/frame/`.
The private-use installers contain OptiFine and must not be uploaded to this
repository. A public package must omit it unless redistribution permission is
available.

Local Inter fonts and their license are under `assets/frame/fonts/`. Frame's
product styles are isolated in `assets/css/frame.css`; shared navigation and
site preferences retain their existing behavior.

### Accounts

The site-wide account page is `/account/`. Account creation, sign-in, email
verification and password recovery use `assets/account.json`, independently of
product pricing or whether sales are open. Its public fields are `enabled` and
`apiBaseUrl`; no credentials belong in this file. Enable it only after deploying
the private account service. The previous Frame account URL redirects here and
preserves verification fragments.

Accounts can own product entitlements. Frame purchases and installer downloads
appear within the account library; authentication does not require a purchase.
Use the same API service URL in the account and Frame checkout configurations so
both use the same secure cookie session. Keep hosting credentials, email sender
addresses, signing keys and customer records outside this repository.

### Checkout

`assets/frame/commerce.json` contains public checkout settings only. It must
not contain payment API keys, webhook secrets, customer records, or license
keys. Frame is priced at USD 30 for a one-time purchase. The price remains
visible while sales are closed. Sales open only after a live merchant-owned
checkout and payment fulfillment are configured. Enabled Stripe sales require
the account API and a signed-in account with a verified email address. A hosted
Payment Link alone cannot enable purchases. Stripe validates discount codes and
the final price; the browser does not calculate an authoritative discount.

Set `apiBaseUrl` in deployment configuration to the service's HTTPS URL. Host it
on the same site as the website, preferably behind a same-origin reverse proxy, so browser cookie
restrictions do not prevent sign-in. Account requests include the secure session
cookie; authenticated actions also send a CSRF token kept only in memory.
Verification and password-reset links use fragments that are removed before
requests. The public source contains no provider secrets, customer records,
license keys, or discount definitions.

`account/` provides account creation, sign-in, email verification,
password reset, purchases, license recovery, and installer downloads. Purchases
belong to the server-side account. Clearing browser storage signs the visitor
out but does not remove purchases; signing in again restores the library. The
purchase return page confirms payment through the service and offers a private
`.frame-license` file. Pending or revoked purchases cannot download an active
license.

Installer buttons request fresh, short-lived, single-use download capabilities
and validate the installer identity before navigation. Paid installers are not
static public assets. Configured native client builds use saved activation to
request entitled update metadata and renew download access before applying an
update. Account sessions, activation credentials, and download capabilities are
separate.

Sales remain closed in the public configuration. The 24-hour trial is implemented
in the licensed launcher and requires a verified Minecraft account. Online trial
activation awaits deployment of the private service. Its original
24-hour deadline is enforced by the private service and signed native leases;
expiration preserves settings and worlds. A checkout redirect is not purchase
confirmation. Deploy and validate the service and licensed client before
enabling purchasing.

## Typing tester

`/uncategorized/typing/` provides 15/30/60-second tests, 25/50/100-word tests, and seven keyboard practice lessons. Tests start on the first character. The timer uses elapsed time rather than counting animation frames. Corrected mistakes still count against attempt accuracy; WPM uses currently correct characters divided by five and elapsed minutes. Practice requires the completed text to match, and 95% attempt accuracy marks a lesson complete. Best test scores, lesson progress, and test options stay in local storage on the current device.

The caret and text scroll smoothly, practice keys respond to presses, and a thin progress line tracks the test. Motion follows the site's accessibility preference. While typing, Tab focuses restart and Enter starts a fresh test.

## Project downloads

Astral is pinned to public revision `07cd79bb22875d498eb31947e276e1b5b1277a2c` (2.3.0). The source installer verifies its archive SHA-256 before configuring CMake and defaults to an unprivileged CLI/library install. GUI builds are opt-in and need Qt 6. It does not install system dependencies automatically.

The macOS arm64 archive was built from that same source with `CMAKE_OSX_DEPLOYMENT_TARGET=13.0`, `MACOSX_DEPLOYMENT_TARGET=13.0`, Release mode, and the GUI disabled. Apply `packaging/astral/path-remapping.patch` to that source before building: the more specific source-root mapping must follow the home-directory mapping. After installing into a staging prefix, `scripts/package-astral.py PREFIX SOURCE` packages the result. It contains the CLI, processor specs, and dependency license notices. Only system libraries are linked dynamically. The bundle installer and the relocated command were tested with a real binary decompilation; older macOS versions and Linux are not runtime-tested here. The package is not Developer ID signed or notarized. Its SHA-256 accompanies the archive. Archive owner names/IDs are removed, and the public audit scans archive contents as well as source and WASM.

Ark links to its public Homebrew tap and versioned source. There are no fabricated release download links.

## Hop campaign

Hop combines the existing fixed-step WASM runner with a JavaScript combat layer. Three stages lead into telegraphed boss fights; Endless keeps the route running. Drones, player/enemy projectiles, damage grace, dash protection, and health are active gameplay systems. J fires, K/Shift dashes, and the touch controls support simultaneous input. Auto fire is available in Controls, and synthesized sound effects are opt-in. Escape pauses, and End run banks earned rewards.

XP, credits, stage unlocks, nine skill nodes, and three equipment upgrade tracks persist in `hop-campaign` browser storage. Skill ranks modify movement, maximum health, shot damage, piercing, repair, and cooldowns. Skill refunds are free. Purchases are disabled during runs; rewards are settled once when a run ends. Clearing browser storage removes progression. The progression model and real WASM/combat integration have regression checks in `tests/hop-campaign.test.mjs`.

## SuperSatisfaction

Bubble wrap supports clicking, dragging, touch, and keyboard activation. Sound is opt-in. Sand stores persistent rake strokes until reset. Magnetic beads use fixed-step WASM spring physics; hover repels and holding attracts. Animation pauses offscreen or when the tab is hidden, with an explicit pause control. Nine additional canvas toys cover ripples, falling sand, symmetry drawing, domino chains, plucked strings, pendulum waves, spirographs, fireworks, and animated sorting. These simulations live in `assets/js/satisfaction/toys.js`. Palette and speed controls apply to the new toys. Arrow keys and Space operate the canvas modes; reduced-motion mode starts animations paused. Fullscreen is available for the entire workspace.

## Zed browser port

The editor uses the real `editor::Editor` and GPUI Web from `zed-industries/zed`, based on revision `1a28cff4b409169bac058bca40dfbfeb7621d19b`. Browser adapters replace native filesystem access, scheduling, parser cleanup, and dependency selection. The page provides browser-local files, import/export, keyboard editing, and font-size adjustment. Native terminal processes, language-server processes, Git, and collaboration are unavailable. SQLite runs genuine in-memory databases for session metadata; documents are persisted separately by the browser filesystem. Clearing site data removes saved documents.

`assets/vendor/zed/source.tar.gz` contains the corresponding modified sources, dependency license files, and build instructions. Building requires Rust 1.98.1, Zig 0.17.0, and wasm-bindgen CLI 0.2.120. The target archive tool must be `zig ar`; the build script configures it explicitly. The browser runs on a single-threaded event loop and does not require cross-origin isolation headers.

Package a rebuilt source tree and check the vendored distribution with:

```sh
python3 packaging/zed/package-source.py /path/to/zed-browser assets/vendor/zed/source.tar.gz
python3 packaging/zed/audit.py assets/vendor/zed
```

The separate vendor audit checks local build paths, archive ownership and entries, and credential-shaped values. Upstream source retains its original product names and licenses. First-party website files still use the normal public audit.
