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
files = [root / name for name in ['Cargo.toml', 'Cargo.lock', 'build.sh', 'check.sh', 'sqlite-cc.py', 'wasm-ar.sh', 'index.html', '.cargo/config.toml']]
for name in ['src', 'source', 'vendor', 'tests']:
    files.extend(path for path in (root / name).rglob('*') if path.is_file() and not path.is_symlink())
files = sorted(set(files))
readme = '''# Zed browser port source

Based on zed-industries/zed commit 1a28cff4b409169bac058bca40dfbfeb7621d19b.
https://github.com/zed-industries/zed/tree/1a28cff4b409169bac058bca40dfbfeb7621d19b

The entry point constructs Zed's actual Editor with GPUI Web. The browser port
adapts filesystem IO, scheduling, settings, parsing, and dependency selection.
Native terminal processes, language-server processes, Git, and collaboration
transport are not available in this browser build. Documents persist through the
browser Fs; SQLite workspace metadata currently lives only for the session.

Requirements: Rust 1.98.1 with wasm32-unknown-unknown, Zig, Python 3, and a C/C++
host toolchain for build dependencies. From this directory:

    cargo +1.98.1 fetch --locked --target wasm32-unknown-unknown
    cargo +1.98.1 install wasm-bindgen-cli --version 0.2.120 --locked --root tools
    sh build.sh

Output is written to pkg/. Browser builds use a single-threaded event loop.
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
