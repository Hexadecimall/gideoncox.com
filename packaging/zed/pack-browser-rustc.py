#!/usr/bin/env python3
"""Package the pinned WASI rustc and its matching WASI libraries."""
import argparse
import gzip
from hashlib import sha256
import io
import json
from pathlib import Path, PurePosixPath
import tarfile


COMPILER_SHA = '07f4f72c1a2a52f58fc527b906b62c9d921e295795280e635fb581c9c63c904b'
LIBRARIES_SHA = 'a660c3c68ce778d9842646c8921cfa81ad316f5568c7896e7dc5dd50c6d8d0f4'


def validate(path, digest):
    if sha256(path.read_bytes()).hexdigest() != digest:
        raise ValueError(f'Unexpected checksum for {path.name}')


def portable(data):
    # Preserve embedded binary offsets while removing native host paths.
    prefixes = (b'/' + b'home/runner/', b'/' + b'Users/runner/',
                b'/' + b'home/xyz', b'/' + b'home/you')
    data = data.replace(prefixes[0], b'./build/root/')
    for prefix in prefixes[1:]:
        data = data.replace(prefix, b'./build'.ljust(len(prefix), b'/'))
    return data


def package(compiler, libraries, output):
    validate(compiler, COMPILER_SHA)
    validate(libraries, LIBRARIES_SHA)
    with tarfile.open(compiler, 'r:gz') as archive:
        binary = archive.extractfile('rustc_opt.wasm').read()
    if not binary.startswith(b'\0asm'):
        raise ValueError('The Rust compiler must be WebAssembly')
    executable = output / 'rustc.wasm.gz'
    executable.write_bytes(gzip.compress(portable(binary), compresslevel=6, mtime=0))

    sysroot = output / 'rust-sysroot.tar.gz'
    with tarfile.open(libraries, 'r:gz') as source, sysroot.open('wb') as stream:
        with gzip.GzipFile(filename='', mode='wb', fileobj=stream, mtime=0, compresslevel=6) as compressed:
            with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.USTAR_FORMAT) as dest:
                for member in sorted(source.getmembers(), key=lambda member: member.name):
                    if member.isdir():
                        continue
                    path = PurePosixPath(member.name)
                    if not member.isfile() or path.is_absolute() or '..' in path.parts:
                        raise ValueError(f'Unexpected Rust library entry {member.name}')
                    data = portable(source.extractfile(member).read())
                    entry = tarfile.TarInfo(f'lib/rustlib/wasm32-wasip1/lib/{path}')
                    entry.size = len(data)
                    dest.addfile(entry, io.BytesIO(data))

    manifest_path = output / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    for artifact in (executable, sysroot):
        manifest[artifact.name] = sha256(artifact.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('compiler', 'libraries', 'output'):
        parser.add_argument(name, type=Path)
    package(**vars(parser.parse_args()))
