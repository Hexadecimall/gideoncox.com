#!/bin/sh
# Build a checksum-pinned Kinetic release locally.
set -eu

main() {
    revision=0a2e4d9b13c10ca02aa9130d48c663d4399b511b
    checksum=c06eafa6d79440298a512ab4effc22b2626fb3c046fd867a09a44e9991270b94
    version=0.35.4
    appDir="$HOME/Applications"
    binDir="$HOME/.local/bin"
    workDir=${TMPDIR:-/tmp}
    jobs=4
    assumeYes=no
    replace=no
    usage() {
        printf '%s\n' 'Kinetic source installer — Apple Silicon, macOS 15+' \
          'Usage: sh kinetic-install.sh [--yes] [--replace] [--jobs N]' \
          '       [--app-dir PATH] [--bin-dir PATH] [--work-dir PATH]' \
          'Requires Xcode Command Line Tools, CMake 3.28+, Cargo and Python 3.' \
          '--replace permits backing up an existing Kinetic app or Homebrew link.' \
          'No LLVM, language servers, or build dependencies are downloaded.'
    }
    fail() { printf 'error: %s\n' "$*" >&2; exit 1; }
    ask() {
        printf '%s [y/N] ' "$1" >/dev/tty || return 1
        read -r answer </dev/tty || return 1
        case "$answer" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
    }
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --help|-h) usage; return ;;
            --yes) assumeYes=yes ;;
            --replace) replace=yes ;;
            --jobs|--app-dir|--bin-dir|--work-dir)
                [ "$#" -ge 2 ] || fail "missing value for $1"
                case "$1" in
                    --jobs) jobs=$2 ;; --app-dir) appDir=$2 ;;
                    --bin-dir) binDir=$2 ;; --work-dir) workDir=$2 ;;
                esac
                shift ;;
            *) fail "unknown option: $1" ;;
        esac
        shift
    done
    [ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || fail 'Apple Silicon macOS is required'
    major=$(sw_vers -productVersion); major=${major%%.*}
    [ "$major" -ge 15 ] || fail 'macOS 15 or newer is required'
    case "$jobs" in ''|*[!0-9]*|0) fail 'jobs must be a positive integer' ;; esac
    for directory in "$appDir" "$binDir" "$workDir"; do
        case "$directory" in /*) ;; *) fail 'directories must be absolute paths' ;; esac
        [ "$directory" != / ] || fail 'the filesystem root is not an install or build directory'
    done
    for tool in cmake cargo python3 curl tar shasum xcrun codesign ditto; do
        command -v "$tool" >/dev/null 2>&1 || fail "missing $tool; install it before continuing"
    done
    clang=$(xcrun --find clang) || fail 'install Xcode Command Line Tools first: xcode-select --install'
    clangxx=$(xcrun --find clang++) || fail 'Apple Clang is unavailable'
    targetApp="$appDir/Kinetic.app"
    targetCli="$binDir/kinetic"
    targetIdentity=$(stat -f '%d:%i' "$targetApp" 2>/dev/null || true)
    cliIdentity=$(stat -f '%d:%i' "$targetCli" 2>/dev/null || true)
    if [ -e "$targetApp" ] || [ -L "$targetApp" ]; then
        bundleId=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$targetApp/Contents/Info.plist") || fail 'existing app cannot be identified'
        [ "$bundleId" = top.frameworksdev.kinetic ] || fail 'existing target is not Kinetic'
        if [ -L "$targetApp" ]; then
            printf 'Existing app link: %s -> %s\n' "$targetApp" "$(readlink "$targetApp")"
            printf 'Only this link will be replaced. Its package-manager installation will remain.\n'
        fi
        if [ "$replace" != yes ]; then
            [ "$assumeYes" != yes ] || fail 'existing app requires explicit --replace'
            ask 'Back up the existing app or link and replace it with a standalone build?' || fail 'cancelled'
        fi
        pgrep -x Kinetic >/dev/null 2>&1 && fail 'quit Kinetic before replacing its app' 
    fi
    if [ -e "$targetCli" ] || [ -L "$targetCli" ]; then
        [ -L "$targetCli" ] && [ "$(readlink "$targetCli")" = "$targetApp/Contents/Resources/bin/kinetic" ] ||
            fail "CLI path is already owned by another installation: $targetCli"
    fi
    printf 'Build Kinetic %s locally and install to %s\n' "$version" "$targetApp"
    [ "$assumeYes" = yes ] || ask 'Continue?' || fail 'cancelled'
    mkdir -p "$workDir" "$appDir" "$binDir"
    scratch=$(mktemp -d "$workDir/kinetic-source.XXXXXXXX")
    staging=
    backup=
    installed=no
    complete=no
    cleanup() {
        if [ "$complete" != yes ] && [ "$installed" = yes ]; then
            mv "$targetApp" "$staging/failed.app"
        fi
        if [ "$complete" != yes ] && [ -n "$backup" ]; then
            mv "$backup/Kinetic.app" "$targetApp"
        fi
        [ -z "$staging" ] || rm -rf -- "$staging"
        rm -rf -- "$scratch"
    }
    trap cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM HUP
    archive="$scratch/source.tar.gz"
    curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
        "https://codeload.github.com/Hexadecimall/Kinetic/tar.gz/$revision" -o "$archive"
    actual=$(shasum -a 256 "$archive"); actual=${actual%% *}
    [ "$actual" = "$checksum" ] || fail 'source checksum mismatch; nothing installed'
    tar -xzf "$archive" -C "$scratch"
    sourceDir="$scratch/Kinetic-$revision"
    [ "$(cat "$sourceDir/VERSION")" = "$version" ] || fail 'source version mismatch'
    cmake -S "$sourceDir" -B "$scratch/build" -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_C_COMPILER="$clang" -DCMAKE_CXX_COMPILER="$clangxx" \
        -DCMAKE_OBJCXX_COMPILER="$clangxx" \
        "-DCMAKE_CXX_FLAGS=-ffile-prefix-map=$scratch=/kinetic-build" \
        "-DCMAKE_OBJCXX_FLAGS=-ffile-prefix-map=$scratch=/kinetic-build"
    CARGO_NET_OFFLINE=true cmake --build "$scratch/build" --target Kinetic --parallel "$jobs"
    staging=$(mktemp -d "$appDir/.kinetic-install.XXXXXXXX")
    stagedApp="$staging/Kinetic.app"
    ditto "$scratch/build/Kinetic.app" "$stagedApp"
    codesign --force --sign - "$stagedApp/Contents/PlugIns/libkineticCppSupport.dylib"
    codesign --force --sign - "$stagedApp/Contents/Resources/bin/kinetic"
    codesign --force --sign - "$stagedApp"
    codesign --verify --deep --strict "$stagedApp"
    [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$stagedApp/Contents/Info.plist")" = "$version" ] || fail 'built app version mismatch'
    [ "$targetIdentity" = "$(stat -f '%d:%i' "$targetApp" 2>/dev/null || true)" ] || fail 'app changed during build; run installer again'
    [ "$cliIdentity" = "$(stat -f '%d:%i' "$targetCli" 2>/dev/null || true)" ] || fail 'CLI changed during build; run installer again'
    if [ -e "$targetApp" ] || [ -L "$targetApp" ]; then
        backup=$(mktemp -d "$appDir/.kinetic-backup.XXXXXXXX")
        mv "$targetApp" "$backup/Kinetic.app"
    fi
    mv "$stagedApp" "$targetApp"
    installed=yes
    ln -sfn "$targetApp/Contents/Resources/bin/kinetic" "$targetCli"
    complete=yes
    printf '\nInstalled Kinetic %s: %s\nCLI: %s\n' "$version" "$targetApp" "$targetCli"
    [ -z "$backup" ] || printf 'Previous app or link retained: %s/Kinetic.app\n' "$backup"
    printf 'Locally signed, not Apple-notarized. No security settings changed.\n'
    printf 'Launch: open "%s"\n' "$targetApp"
    case ":$PATH:" in *":$binDir:"*) ;; *) printf 'Add %s to PATH to run kinetic by name.\n' "$binDir" ;; esac
}

main "$@"
