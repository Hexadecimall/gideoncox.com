#!/usr/bin/env python3
"""Verify the pinned WebLLM artifacts and normalize their diagnostic paths."""
import hashlib
from pathlib import Path
import re
import sys


def verified(path, expected):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError(f"Unexpected SHA-256 for {path.name}")
    return data


def main():
    bundle, kernel, output = map(Path, sys.argv[1:])
    js = verified(bundle, "2655840c7eb90cd8b310a3e3394a91fae30d20012fd8274e9291d688e88325b5")
    wasm = verified(kernel, "f7a7faecbf17327e66d5cef5a013eaec6ba667de929280078c87beed1a4eb868")

    # Preserve all WebAssembly section offsets while remapping the TVM source root.
    source_prefix = re.compile(rb"/(?:Users)/[^/\0]+/Documents/tvm-release-[^/\0]+/")
    wasm, replaced = source_prefix.subn(
        lambda match: b"/src/tvm/".ljust(len(match[0]), b"/"), wasm,
    )
    if replaced != 225:
        raise ValueError("Unexpected number of TVM source paths.")
    js = js.replace(b"/home/web" + b"_user", b"/home/web")

    output.mkdir(parents=True, exist_ok=True)
    (output / "web-llm.js").write_bytes(js)
    (output / "smollm2-360m.wasm").write_bytes(wasm)


if __name__ == "__main__":
    main()
