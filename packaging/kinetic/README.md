# Kinetic source installer

`downloads/kinetic-install.sh` builds the pinned public 0.36.1 source release on
Apple Silicon macOS 15+. CMake 3.28+, Apple Command Line Tools, Cargo, and Python 3
must already be installed. Vendored Cargo dependencies are built offline. LLVM
and language servers are not downloaded.

The installer verifies the source archive's SHA-256 before extracting it, builds
the app and embedded CLI, and signs the staged bundle locally. Only then does it
replace an existing installation after confirmation. A replaced app or symlink
is retained in an adjacent `.kinetic-backup.*` directory. Homebrew's Cellar is
never modified. Unrelated CLI files are never overwritten. Configuration and
plugins in `~/.kinetic` are not touched.
New app bundles use `org.kinetic.app`. The installer also recognizes the legacy
bundle identifier when replacing an existing app or link after confirmation.

To refresh the offered release, update `revision`, `checksum`, and `version`
together after verifying a public source archive. Update the project page's
version, run `sh -n downloads/kinetic-install.sh` and
`python3 tests/kinetic-installer_test.py`, then test a complete installation to
isolated app and CLI directories using `--app-dir`, `--bin-dir`, and `--work-dir`.
Re-run the public command to install the source version currently offered by the
website; this is separate from the app's binary-release updater.
