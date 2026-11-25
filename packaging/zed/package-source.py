#!/usr/bin/env python3
"""Package the corresponding sources of the browser build with portable paths."""
import argparse
import gzip
import hashlib
import io
from pathlib import Path
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('workspace', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
root = args.workspace.resolve()
files = [root / name for name in ['Cargo.toml', 'Cargo.lock', 'build.sh', 'check.sh', 'sqlite-cc.py', 'wasm-ar.sh', 'workspace.html', '.cargo/config.toml']]
for name in ['src', 'source', 'vendor', 'tests', 'wasm-include']:
    files.extend(path for path in (root / name).rglob('*') if path.is_file() and not path.is_symlink())
files = sorted(set(files))
readme = '''# Zed browser port source

Based on zed-industries/zed commit 1a28cff4b409169bac058bca40dfbfeb7621d19b.
https://github.com/zed-industries/zed/tree/1a28cff4b409169bac058bca40dfbfeb7621d19b

The entry point constructs Zed's actual Workspace and MultiWorkspace with GPUI
Web, including the upstream title bar, project panel, panes, tabs and editor.
The browser port adapts filesystem IO, scheduling, settings, parsing, dialogs
and dependency selection. The embedding page provides zedBrowserDialogs; its
implementation is in assets/js/zed/ in the website repository.
Zed's TerminalPanel and terminal_view use Alacritty's parser and grid. Browser
Ark runs in a WebAssembly worker and uses Zed's saved project files. The
terminal_project module bridges file operations through Zed's filesystem.
For native execution, zedNativeTerminal also supports the authenticated local
PTY connector in connector/ark_connector.py. Native sessions require pairing.
An opt-in zedHost bridge mounts a selected local project, supplies binary process
pipes, and runs installed clangd/rust-analyzer through Zed's upstream LSP client.
The site provides an in-browser Pyright process for Python worktrees stored in
the browser. It uses a bundled worker and standard library stubs and does not
depend on a native connector or Python runtime. See assets/vendor/pyright for
the worker provenance and licenses.
The upstream tasks UI uses native task PTYs. The connector must explicitly enable
process access; it never downloads tools. Browser-only documents still persist
through the browser Fs. SQLite workspace metadata lives only for the session.
Git UI, debugger integration, extension hosting, collaboration and account
services remain unavailable. See the website's packaging/zed/PARITY.md for scope.
The browser build also includes upstream Vim mode, keybindings and mode status,
plus all 22 built-in syntax configurations and their Tree-sitter queries.
Vim is off by default and follows Zed's vim_mode setting. Bundled syntax does
not imply that each language has an available language server.

Requirements: Rust 1.98.1 with wasm32-unknown-unknown, Zig, Python 3, and a C/C++
host toolchain for build dependencies. From this directory:

    cargo +1.98.1 fetch --locked --target wasm32-unknown-unknown
    cargo +1.98.1 install wasm-bindgen-cli --version 0.2.120 --locked --root tools
    sh build.sh --features threads-sidebar-web

Output is written to pkg/. The project-local Cargo configuration pins release
optimization to level 3, fat LTO and one codegen unit. Browser builds use a
single-threaded event loop.
See source/LICENSE-GPL and source/LICENSE-APACHE. Each dependency retains its
original license. Modified browser adapter code is distributed under the same
license as its containing crate. No upstream sponsorship is implied.
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
temporary = args.output.with_suffix(args.output.suffix + '.tmp')
with temporary.open('wb') as destination, gzip.GzipFile(fileobj=destination, mode='wb', filename='', mtime=0) as compressed:
    with tarfile.open(fileobj=compressed, mode='w') as archive:
        def add(name, data, executable=False):
            info = tarfile.TarInfo('zed-browser-source/' + name)
            info.size = len(data)
            info.mode = 0o755 if executable else 0o644
            info.uid = info.gid = info.mtime = 0
            info.uname = info.gname = ''
            archive.addfile(info, io.BytesIO(data))
        add('README.md', readme.encode())
        for path in files:
            relative = path.relative_to(root)
            if any(part in {'.git', 'target', '__pycache__', '.DS_Store', '.rules'} for part in relative.parts):
                continue
            if relative.as_posix() == 'source/README.md':
                continue
            data = path.read_bytes()
            if path.name == 'Cargo.toml':
                data = data.replace(str(root).encode() + b'/', b'')
            if str(Path.home()).encode() in data:
                raise SystemExit(f'Private path found in {relative}')
            add(relative.as_posix(), data, path.name in {'build.sh', 'check.sh', 'sqlite-cc.py', 'wasm-ar.sh'})
temporary.replace(args.output)
print(args.output.name, args.output.stat().st_size, hashlib.sha256(args.output.read_bytes()).hexdigest())
