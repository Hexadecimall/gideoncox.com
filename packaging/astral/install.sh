#!/bin/sh
# Install this portable Astral command-line bundle in a user-owned prefix.
set -eu
prefix=${HOME}/.local
case "${1:-}" in
    --prefix) [ "$#" -eq 2 ] || { printf 'Usage: sh install.sh [--prefix DIRECTORY]\n' >&2; exit 2; }; prefix=$2 ;;
    '') ;;
    *) printf 'Usage: sh install.sh [--prefix DIRECTORY]\n' >&2; exit 2 ;;
esac
case "$prefix" in /*) ;; *) printf 'Use an absolute install prefix.\n' >&2; exit 2 ;; esac
[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || {
    printf 'This bundle is for Apple Silicon Macs. Use the source installer for other platforms.\n' >&2; exit 1;
}
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
destination="$prefix/opt/astral-2.3.0-07cd79bb"
if [ -e "$destination" ] || [ -L "$destination" ]; then
    printf 'Already exists: %s\nChoose another --prefix to keep the current installation.\n' "$destination" >&2; exit 1;
fi
if [ -e "$prefix/bin/astral" ] || [ -L "$prefix/bin/astral" ]; then
    printf 'An astral command already exists in %s/bin. Choose another --prefix.\n' "$prefix" >&2; exit 1;
fi
mkdir -p "$prefix/opt" "$prefix/bin"
stage=$(mktemp -d "$prefix/opt/.astral-install.XXXXXXXX")
trap 'rm -rf "$stage"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cp -R "$here/bin" "$here/share" "$here/licenses" "$stage/"
cp "$here/README.txt" "$stage/"
mv "$stage" "$destination"
ln -s "$destination/bin/astral" "$prefix/bin/astral"
printf 'Installed: %s/bin/astral\n' "$prefix"
printf 'Run: "%s/bin/astral" --help\n' "$prefix"
