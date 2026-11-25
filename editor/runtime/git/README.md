# Browser Git

The Git worker uses libgit2 1.9.4 compiled for WASI. Zed passes a repository snapshot to the worker and uses the returned Git objects, index, and refs for browser-stored projects. Git metadata is written back only after the requested operation succeeds.

Build with WASI SDK 29 and CMake. The build script verifies both source archives before applying the WASI port and compiling the command adapter.

```sh
packaging/zed/build-browser-git.sh /path/to/wasi-sdk /path/to/build-directory
```

Copy `zed-git.wasm.gz`, `manifest.json`, and the two license files to this directory. The manifest identifies the compressed module by SHA-256. Run `node --test tests/zed-browser-git.test.mjs` to check the packaged worker against a real Git repository fixture.

[libgit2 source](https://github.com/libgit2/libgit2/tree/v1.9.4) · [WASI port sources](https://github.com/petersalomonsen/wasm-git/tree/b629c73fb659780134a0ca12dbfbbfcac2bdb47f)
