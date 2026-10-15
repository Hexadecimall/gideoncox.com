#!/bin/sh
# Build the pinned public Astral source, then install without a privileged service.
set -eu

revision=07cd79bb22875d498eb31947e276e1b5b1277a2c
checksum=c9405b2c6bf437f8141043e1c8bda8f95c4bb001ea19c5cb989de52fbaa6f9b2
prefix=${HOME}/.local
jobs=4
gui=OFF
usage() {
    printf '%s\n' 'Astral source installer — macOS / Linux' \
      'Usage: sh astral-install.sh [--prefix DIRECTORY] [--jobs NUMBER] [--gui]' \
      'Default: command-line interface and libraries under ~/.local.' \
      'Requires CMake 3.20+, a C++17 compiler, Cargo, curl, tar, and zlib headers.' \
      '--gui also requires Qt 6 development libraries.'
}
while [ "$#" -gt 0 ]; do
    case "$1" in
        --help|-h) usage; exit 0 ;;
        --prefix) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; prefix=$2; shift ;;
        --jobs) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; jobs=$2; shift ;;
        --gui) gui=ON ;;
        *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
    esac
    shift
done
case "$prefix" in /*) ;; *) printf 'Use an absolute install prefix.\n' >&2; exit 2 ;; esac
case "$jobs" in ''|*[!0-9]*|0) printf 'Jobs must be a positive integer.\n' >&2; exit 2 ;; esac
case "$(uname -s)" in Darwin|Linux) ;; *) printf 'This installer supports macOS and Linux.\n' >&2; exit 1 ;; esac
for command in cmake cargo curl tar; do
    command -v "$command" >/dev/null 2>&1 || { printf 'Missing dependency: %s\n' "$command" >&2; exit 1; }
done
if command -v sha256sum >/dev/null 2>&1; then hash_tool=sha256sum
elif command -v shasum >/dev/null 2>&1; then hash_tool=shasum
else printf 'Install sha256sum or shasum to verify the source archive.\n' >&2; exit 1
fi

scratch=$(mktemp -d "${TMPDIR:-/tmp}/astral-install.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
archive="$scratch/source.tar.gz"
printf 'Downloading Astral source %s\n' "$revision"
curl --fail --location --proto '=https' --tlsv1.2 \
    "https://codeload.github.com/Hexadecimall/Astral/tar.gz/$revision" -o "$archive"
if [ "$hash_tool" = shasum ]; then actual=$(shasum -a 256 "$archive"); else actual=$(sha256sum "$archive"); fi
actual=${actual%% *}
[ "$actual" = "$checksum" ] || { printf 'Source checksum mismatch. Nothing installed.\n' >&2; exit 1; }
tar -xzf "$archive" -C "$scratch"
source_dir="$scratch/Astral-$revision"
cmake -S "$source_dir" -B "$scratch/build" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" \
    -DASTRAL_BUILD_GUI="$gui" -DASTRAL_BUILD_TUI=ON
cmake --build "$scratch/build" --parallel "$jobs"
cmake --install "$scratch/build"
printf '\nInstalled: %s/bin/astral\n' "$prefix"
printf 'Run: "%s/bin/astral" --help\n' "$prefix"
