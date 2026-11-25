#!/usr/bin/env python3
"""Package a stripped CPython WASI module and its Python standard library."""
import argparse
import gzip
import io
from pathlib import Path
import re
from zipfile import ZIP_STORED, ZipFile


OMIT = {'test', 'tests', '__pycache__', 'idlelib', 'tkinter', 'ensurepip', 'venv', 'turtledemo'}
LOCAL_PATH = re.compile(rb'/(?:Users|Volumes|private/var|private/tmp)/[^\x00\s]+')


def pack(source, binary, destination):
    module = binary.read_bytes()
    if not module.startswith(b'\0asm'):
        raise ValueError('Expected a CPython WebAssembly module.')
    if LOCAL_PATH.search(module) or str(Path.home()).encode() in module:
        raise ValueError('The module contains a local build path. Strip or remap it first.')

    library = source / 'Lib'
    if not (library / 'encodings' / '__init__.py').is_file():
        raise ValueError('Expected an unpacked CPython source release.')
    contents = io.BytesIO()
    with ZipFile(contents, 'w', ZIP_STORED) as archive:
        for path in sorted(library.rglob('*.py')):
            relative = path.relative_to(library)
            if not any(part in OMIT for part in relative.parts):
                archive.writestr(relative.as_posix(), path.read_bytes())

    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'python.wasm.gz').write_bytes(gzip.compress(module, mtime=0))
    (destination / 'python314.zip.gz').write_bytes(gzip.compress(contents.getvalue(), mtime=0))
    (destination / 'LICENSE-cpython').write_bytes((source / 'LICENSE').read_bytes())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('binary', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    pack(args.source, args.binary, args.destination)
