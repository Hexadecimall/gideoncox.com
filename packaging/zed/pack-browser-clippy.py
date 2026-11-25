#!/usr/bin/env python3
"""Strip and package a browser build of the Rust 1.83 Clippy driver."""
import argparse
import gzip
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import subprocess
from tempfile import TemporaryDirectory


def replace_prefix(data, prefix, replacement):
    if len(replacement) <= len(prefix):
        return data.replace(prefix, replacement.ljust(len(prefix), b'/'))
    return data


def package(driver, source, sdk, output):
    with TemporaryDirectory() as directory:
        stripped = Path(directory) / 'clippy-driver.wasm'
        subprocess.run([sdk / 'bin/llvm-strip', '--strip-debug', '-o', stripped, driver], check=True)
        data = stripped.read_bytes()
    if not data.startswith(b'\0asm\1\0\0\0'):
        raise ValueError('Clippy driver must be a WebAssembly module')

    # The data sections contain compiler diagnostic paths. Preserve offsets.
    cargo = Path(os.environ.get('CARGO_HOME', Path.home() / '.cargo')).resolve()
    for directory, alias in ((source, b'./rust'), (cargo, b'./cargo'), (sdk, b'./wasi-sdk')):
        data = replace_prefix(data, os.fsencode(directory.resolve()) + b'/', alias + b'/')
    for prefix in set(re.findall(rb'/Users/[^/\x00\n]+/work/wasi-sdk/wasi-sdk/', data)):
        data = replace_prefix(data, prefix, b'./wasi-sdk/')
    if any(part in data for part in (b'/Users/', b'/Volumes/', b'/private/tmp/')):
        raise ValueError('Unexpected native paths in the Clippy driver')

    output.mkdir(parents=True, exist_ok=True)
    bundle = output / 'clippy-driver.wasm.gz'
    compressed = gzip.compress(data, mtime=0, compresslevel=6)
    if len(compressed) >= 100 * 1024 * 1024:
        raise ValueError('Compressed Clippy driver exceeds the repository file limit')
    bundle.write_bytes(compressed)
    manifest = output / 'manifest.json'
    assets = json.loads(manifest.read_text()) if manifest.exists() else {}
    assets[bundle.name] = sha256(compressed).hexdigest()
    manifest.write_text(json.dumps(assets, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('driver', 'source', 'sdk', 'output'):
        parser.add_argument(name, type=Path)
    package(**vars(parser.parse_args()))
