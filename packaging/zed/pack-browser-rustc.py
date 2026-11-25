#!/usr/bin/env python3
"""Package the pinned WASI rustc and its matching WASI libraries."""
import argparse
import gzip
from hashlib import sha256
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile
from tempfile import TemporaryDirectory


COMPILER_SHA = '07f4f72c1a2a52f58fc527b906b62c9d921e295795280e635fb581c9c63c904b'
LIBRARIES_SHA = 'a660c3c68ce778d9842646c8921cfa81ad316f5568c7896e7dc5dd50c6d8d0f4'
HOST_LIBRARIES_SHA = '868b9a1670cd29c051c6dc257acd126c7d931957f03eb28c4c08b2a0ec1a3a13'
WASI_MMAN_SHA = '995c503084bb5d93b4f482ba381d7487b29e5bda427e2fc525c0e8008351ac77'


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


def add_library(archive, target, path, data):
    data = portable(data)
    entry = tarfile.TarInfo(f'lib/rustlib/{target}/lib/{path}')
    entry.size = len(data)
    archive.addfile(entry, io.BytesIO(data))


def pack_libraries(libraries, target, sysroot, self_contained=()):
    with tarfile.open(libraries, 'r:gz') as source, sysroot.open('wb') as stream:
        with gzip.GzipFile(filename='', mode='wb', fileobj=stream, mtime=0, compresslevel=6) as compressed:
            with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.USTAR_FORMAT) as dest:
                for member in sorted(source.getmembers(), key=lambda member: member.name):
                    if member.isdir():
                        continue
                    path = PurePosixPath(member.name)
                    if not member.isfile() or path.is_absolute() or '..' in path.parts:
                        raise ValueError(f'Unexpected Rust library entry {member.name}')
                    add_library(dest, target, path, source.extractfile(member).read())
                for artifact in self_contained:
                    add_library(dest, target, f'self-contained/{artifact.name}', artifact.read_bytes())


def update_manifest(output, artifacts):
    manifest_path = output / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    for artifact in artifacts:
        manifest[artifact.name] = sha256(artifact.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')


def package(compiler, libraries, output, host_libraries=None, wasi_sdk=None):
    validate(compiler, COMPILER_SHA)
    validate(libraries, LIBRARIES_SHA)
    with tarfile.open(compiler, 'r:gz') as archive:
        binary = archive.extractfile('rustc_opt.wasm').read()
    if not binary.startswith(b'\0asm'):
        raise ValueError('The Rust compiler must be WebAssembly')
    executable = output / 'rustc.wasm.gz'
    executable.write_bytes(gzip.compress(portable(binary), compresslevel=6, mtime=0))
    sysroot = output / 'rust-sysroot.tar.gz'
    pack_libraries(libraries, 'wasm32-wasip1', sysroot)
    update_manifest(output, (executable, sysroot))
    if host_libraries:
        package_host(host_libraries, wasi_sdk, output)


def package_host(libraries, wasi_sdk, output):
    validate(libraries, HOST_LIBRARIES_SHA)
    mman = wasi_sdk / 'share/wasi-sysroot/lib/wasm32-wasip1-threads/libwasi-emulated-mman.a'
    validate(mman, WASI_MMAN_SHA)
    sysroot = output / 'rust-host-sysroot.tar.gz'
    with TemporaryDirectory(dir=output) as temporary:
        startup = Path(temporary) / 'cargo-build-start.o'
        source = Path(__file__).with_name('cargo-build-start.c')
        subprocess.run([
            wasi_sdk / 'bin/clang', '--target=wasm32-wasip1-threads', '-pthread', '-Os',
            '-fno-ident', '-c', source, '-o', startup,
        ], check=True)
        pack_libraries(libraries, 'wasm32-wasip1-threads', sysroot, (mman, startup))
    update_manifest(output, (sysroot,))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('compiler', 'libraries', 'output'):
        parser.add_argument(name, type=Path)
    parser.add_argument('--host-libraries', type=Path)
    parser.add_argument('--wasi-sdk', type=Path)
    args = parser.parse_args()
    if args.host_libraries and not args.wasi_sdk:
        parser.error('--host-libraries requires --wasi-sdk')
    package(**vars(args))
