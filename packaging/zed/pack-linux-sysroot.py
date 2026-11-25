#!/usr/bin/env python3
"""Package the x86-64 static runtime and matching headers from Zig 0.17.0."""
import argparse
import gzip
from hashlib import sha256
import io
import json
from pathlib import Path
import shlex
import subprocess
import tarfile
from tempfile import TemporaryDirectory


ZIG_SOURCE_SHA = 'b6c7f1728f043700d6529bac980800792f824256a9d2f1839b3d62beed0b8abd'
C_HEADERS = (
    'include', 'libc/include/x86_64-linux-musl', 'libc/include/generic-musl',
    'libc/include/x86-linux-any', 'libc/include/any-linux-any',
)
CXX_HEADERS = ('libcxx/include', 'libcxxabi/include', 'libunwind/include')
C_LIBS = ('crt1.o', 'libc.a', 'libzigc.a', 'libcompiler_rt.a')
CXX_LIBS = ('libc++.a', 'libc++abi.a', 'libunwind.a')
C_NOTICES = {'LICENSE': 'zig', 'lib/libc/musl/COPYRIGHT': 'musl'}
CXX_NOTICES = {f'lib/{name}/LICENSE.TXT': name for name in ('libcxx', 'libcxxabi', 'libunwind')}
CXX_CONFIG = b"""#define _LIBCPP_ABI_VERSION 1
#define _LIBCPP_ABI_NAMESPACE __1
#define _LIBCPP_HAS_THREADS 1
#define _LIBCPP_HAS_MONOTONIC_CLOCK 1
#define _LIBCPP_HAS_TERMINAL 1
#define _LIBCPP_HAS_MUSL_LIBC 1
#define _LIBCXXABI_DISABLE_VISIBILITY_ANNOTATIONS 1
#define _LIBCPP_DISABLE_VISIBILITY_ANNOTATIONS 1
#define _LIBCPP_HAS_VENDOR_AVAILABILITY_ANNOTATIONS 0
#define _LIBCPP_HAS_FILESYSTEM 1
#define _LIBCPP_HAS_RANDOM_DEVICE 1
#define _LIBCPP_HAS_LOCALIZATION 1
#define _LIBCPP_HAS_UNICODE 1
#define _LIBCPP_HAS_WIDE_CHARACTERS 1
#define _LIBCPP_HAS_NO_STD_MODULES 1
#define _LIBCPP_HAS_TIME_ZONE_DATABASE 1
#define _LIBCPP_PSTL_BACKEND_SERIAL 1
#define _LIBCPP_HARDENING_MODE _LIBCPP_HARDENING_MODE_NONE
#define _LIBCPP_ASSERTION_SEMANTIC_DEFAULT _LIBCPP_ASSERTION_SEMANTIC_IGNORE
"""


def add(archive, path, contents):
    entry = tarfile.TarInfo(f'linux/{path}')
    entry.size = len(contents)
    archive.addfile(entry, io.BytesIO(contents))


def pack(source, destination, headers, libs, notices, cxx=False):
    prefixes = tuple(f'lib/{path}/' for path in headers)
    with destination.open('wb') as output, gzip.GzipFile(filename='', mode='wb', fileobj=output, mtime=0) as compressed:
        with tarfile.open(source) as upstream, tarfile.open(
            fileobj=compressed, mode='w|', format=tarfile.USTAR_FORMAT,
        ) as archive:
            found = set()
            for entry in upstream:
                _, _, path = entry.name.partition('/')
                if entry.isfile() and path in notices:
                    found.add(path)
                    add(archive, 'notices/' + notices[path], upstream.extractfile(entry).read())
                elif entry.isfile() and path.startswith(prefixes):
                    add(archive, path.removeprefix('lib/'), upstream.extractfile(entry).read())
            if found != notices.keys():
                raise ValueError('The Zig release is missing runtime license files.')
            for lib in libs:
                add(archive, 'lib/' + lib.name, lib.read_bytes())
            if cxx:
                add(archive, 'libcxx/zig_config.h', CXX_CONFIG)


def main(source, trace, llvm_strip, output):
    if sha256(source.read_bytes()).hexdigest() != ZIG_SOURCE_SHA:
        raise ValueError('Use the matching Zig 0.17.0 source release.')
    command = next(line for line in reversed(trace.read_text().splitlines()) if line.startswith('ld.lld '))
    paths = [Path(arg) for arg in shlex.split(command)]
    built = {path.name: path for path in paths if path.name in {*C_LIBS, *CXX_LIBS}}
    if not all(path.is_file() for path in built.values()) or built.keys() != set(C_LIBS + CXX_LIBS):
        raise ValueError('Run from the same directory as the static x86-64 Zig C++ build.')
    with TemporaryDirectory() as temporary:
        stripped = Path(temporary)
        for name, path in built.items():
            subprocess.run([llvm_strip, '--strip-debug', '--remove-section=.comment',
                            '-o', stripped / name, path], check=True)
        standard = output / 'linux-x86_64-sdk.tar.gz'
        cpp = output / 'linux-x86_64-cxx.tar.gz'
        pack(source, standard, C_HEADERS, [stripped / name for name in C_LIBS], C_NOTICES)
        pack(source, cpp, CXX_HEADERS, [stripped / name for name in CXX_LIBS], CXX_NOTICES, cxx=True)
    manifest_path = output / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    for path in (standard, cpp):
        manifest[path.name] = sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'trace', 'llvm_strip', 'output'):
        parser.add_argument(name, type=Path)
    main(**vars(parser.parse_args()))
