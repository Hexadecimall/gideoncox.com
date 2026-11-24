#!/usr/bin/env python3
"""Pack Rust source and target metadata used for browser analysis."""
import gzip
import json
import os
from pathlib import Path
import re
import subprocess
import sys


VERSION = "1.98.1"
TARGET = "wasm32-wasip1"
CRATES = (
    "alloc", "backtrace", "core", "panic_abort", "panic_unwind", "portable-simd",
    "proc_macro", "profiler_builtins", "std", "std_detect", "stdarch", "test", "unwind",
)


def rustc(*arguments):
    return subprocess.check_output(
        ["rustc", f"+{VERSION}", *arguments],
        text=True,
        env={**os.environ, "RUSTC_BOOTSTRAP": "1"},
    )


def main():
    output = Path(sys.argv[1])
    sysroot = Path(rustc("--print", "sysroot").strip()) / "lib/rustlib/src/rust/library"
    source = {}
    for crate in CRATES:
        for path in sorted((sysroot / crate).rglob("*")):
            if path.is_file() and path.suffix in (".rs", ".md"):
                key = path.relative_to(sysroot).as_posix()
                # Target-specific intrinsic implementations are large; keep the WASM implementation.
                arch_prefix = "stdarch/crates/core_arch/src/"
                if key.startswith(arch_prefix):
                    component = key.removeprefix(arch_prefix).split("/", 1)[0]
                    if component not in {"mod.rs", "wasm32", "macros.rs", "simd.rs"}:
                        continue
                source[key] = path.read_text(encoding="utf-8")
    # Older rust-analyzer releases discover std_detect at its former path.
    for key, value in list(source.items()):
        if key.startswith("std_detect/"):
            source[f"stdarch/crates/{key}"] = value
    info = {
        "version": rustc("--version"),
        "verboseVersion": re.sub(r"(?m)^host: .*", f"host: {TARGET}", rustc("-vV")),
        "cfg": rustc("--target", TARGET, "-O", "--print", "cfg"),
        "targetSpec": rustc("--target", TARGET, "-Z", "unstable-options", "--print", "target-spec-json"),
    }
    output.mkdir(parents=True, exist_ok=True)
    with (output / "sysroot.json.gz").open("wb") as compressed:
        with gzip.GzipFile(filename="", mode="wb", fileobj=compressed, mtime=0) as archive:
            archive.write(json.dumps({"info": info, "source": source}, ensure_ascii=False, separators=(",", ":")).encode())
    print(f"Packed {len(source)} Rust source files.")


if __name__ == "__main__":
    main()
