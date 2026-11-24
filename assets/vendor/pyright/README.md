# Browser Pyright

`pyright.worker.js` is the unchanged classic Web Worker from the npm package
`@typefox/pyright-browser@1.1.299` (TypeFox/pyright revision
`64408a1d1e5b2a59abc562e2782a735c03146073`). Its SHA-256 is
`be64831fd9b118ed22d3bd76779a3cca1e2f84761640ee3c81c0a1386bbbb8ce`.
The worker and its dependencies retain their accompanying license notices.

`typeshed-stdlib.json` maps absolute virtual paths to contents. It contains
the `.pyi` files and `VERSIONS` from `dist/typeshed-fallback/stdlib` in the
matching `pyright@1.1.299` npm package. The copied typeshed license is
`LICENSE-typeshed.txt`. Type stubs for third-party packages can be supplied
in a browser project.

The app loads these files from the site only when Python analysis starts.
The worker reads project source from Zed's browser filesystem and analyzes it
locally in the tab.
