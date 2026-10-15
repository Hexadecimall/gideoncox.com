Astral 2.3.0 — macOS Apple Silicon command-line bundle

Requires macOS 13 or later. This is an unsigned, non-notarized CLI build.
The desktop GUI and development libraries are not included.

Run without installing:
    ./bin/astral --help
    ./bin/astral decompile --all ./program

Install under ~/.local:
    sh install.sh

Or choose a separate installation prefix:
    sh install.sh --prefix /absolute/path

Keep bin and share beside each other. The specification files in share/astral
are required for decompilation. The installer leaves any existing astral
command alone. It does not change your shell, PATH, or system services.

Source revision: 07cd79bb22875d498eb31947e276e1b5b1277a2c
Source: https://github.com/Hexadecimall/Astral/tree/07cd79bb22875d498eb31947e276e1b5b1277a2c
Source archive: https://github.com/Hexadecimall/Astral/archive/07cd79bb22875d498eb31947e276e1b5b1277a2c.zip
Ghidra and Rust dependency license notices are included under licenses.
