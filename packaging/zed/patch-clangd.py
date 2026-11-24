#!/usr/bin/env python3
"""Prepare the pinned Emscripten clangd for a small browser workspace."""
import gzip
import hashlib
import sys
from pathlib import Path

WASM_SHA256 = "0d71e7a7f8e6dd369cb2a0b22cc4016d649f370e5b905adb6092536deb0ee019"
JS_SHA256 = "a7ff1c588eb5374783bbda84d949b92b8027c2381c786072448b96eba90c7027"


def verified_file(path, sha256):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != sha256:
        raise ValueError(f"Unexpected SHA-256 for {path.name}")
    return data


def patch_wasm(data):
    # The pinned wasm imports shared env.memory with a 2 GiB minimum and 4 GiB maximum.
    # Match the import prefix and preserve the LEB widths and section sizes.
    before = bytes.fromhex("03656e76066d656d6f72790203808002808004")
    after = bytes.fromhex("03656e76066d656d6f7279020380a000808001")
    if data.count(before) != 1:
        raise ValueError("Expected exactly one env.memory import")
    data = data.replace(before, after, 1)
    # Keep the help text example separate from home-directory paths.
    return data.replace(b"/home" + b"/project", b"/work/project")


def patch_loader(data):
    before = b"var pthreadPoolSize=Math.max(navigator.hardwareConcurrency,8)"
    after = b"var pthreadPoolSize=4"
    if data.count(before) != 1:
        raise ValueError("Expected exactly one pthread pool size")
    return data.replace(before, after, 1).replace(b"/home/web" + b"_user", b"/home/web")


def main():
    source, output = map(Path, sys.argv[1:])
    source_wasm = verified_file(source / "clangd.wasm", WASM_SHA256)
    source_js = verified_file(source / "clangd.js", JS_SHA256)
    output.mkdir(parents=True, exist_ok=True)
    (output / "clangd.wasm.gz").write_bytes(gzip.compress(patch_wasm(source_wasm), compresslevel=6, mtime=0))
    (output / "clangd.js").write_bytes(patch_loader(source_js))


if __name__ == "__main__":
    main()
