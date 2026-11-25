#!/usr/bin/env python3
"""Package the browser compilers and their versioned, read-only libraries."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
from tempfile import TemporaryDirectory


def portable_bytes(source):
    # Preserve binary offsets while removing the fixed path in the WASI SDK release.
    ci_prefix = b'/'.join((b'', b'Users', b'runner', b'work', b'wasi-sdk', b'wasi-sdk'))
    return source.read_bytes().replace(ci_prefix, b'/wasi-sdk'.ljust(len(ci_prefix), b'/'))


def packed_tree(trees, files, destination):
    entries = list(files)
    for directory, mount in trees:
        entries.extend((file, f'{mount}/{file.relative_to(directory).as_posix()}')
                       for file in directory.rglob('*') if file.is_file())
    with destination.open('wb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.USTAR_FORMAT) as archive:
            for file, path in sorted(entries, key=lambda entry: entry[1]):
                info = tarfile.TarInfo(path)
                info.size = file.stat().st_size
                with file.open('rb') as data:
                    archive.addfile(info, data)


def package(llvm, sdk, zig, output):
    output.mkdir(parents=True, exist_ok=True)
    for binary, name in ((llvm / 'bin/clang-22', 'clang'), (llvm / 'bin/lld', 'lld'), (zig / 'zig.wasm', 'zig')):
        with binary.open('rb') as data:
            if data.read(4) != b'\0asm':
                raise ValueError(f'{name} must be a WebAssembly build')
        (output / f'{name}.wasm.gz').write_bytes(gzip.compress(portable_bytes(binary), compresslevel=6, mtime=0))

    wasi = sdk / 'share/wasi-sysroot'
    builtins = sdk / 'lib/clang/21/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a'
    runtime = wasi / 'lib/wasm32-wasip1'
    libraries = {'libclang_rt.builtins.a': builtins}
    libraries.update((name, runtime / name) for name in ['crt1-command.o', 'libc.a', 'libm.a', 'libc++.a', 'libc++abi.a'])
    with TemporaryDirectory() as scratch:
        stripped = Path(scratch)
        for name, source in libraries.items():
            target = stripped / name
            subprocess.run([sdk / 'bin/llvm-strip', '-g', '-o', target, source], check=True)
            target.write_bytes(portable_bytes(target))
        packed_tree([
            (llvm / 'lib/clang/22/include', 'clang/include'),
            (wasi / 'include/wasm32-wasip1', 'wasi/include'),
            (stripped, 'wasi/lib'),
        ], [], output / 'wasi-sdk.tar.gz')
    packed_tree([(zig / 'sdk/lib/std', 'lib/std')], [(zig / 'compiler_rt.o', 'compiler_rt.o')], output / 'zig-sdk.tar.gz')

    manifest = {name: hashlib.sha256((output / name).read_bytes()).hexdigest()
                for name in ['clang.wasm.gz', 'lld.wasm.gz', 'wasi-sdk.tar.gz', 'zig.wasm.gz', 'zig-sdk.tar.gz']}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('llvm', 'sdk', 'zig', 'output'):
        parser.add_argument(name, type=Path)
    package(**vars(parser.parse_args()))
