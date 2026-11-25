import { BrowserLanguageServer } from './browser-language-server.js?v=workspace-ready-1';

const MAX_GENERATED_BYTES = 8 * 1024 * 1024;
const MAX_BUILD_PACKAGES = 32;

export class BrowserRust extends BrowserLanguageServer {
  constructor(zed, makeWorker = () => new Worker('/editor/runtime/rust/worker.js?v=cargo-diagnostics-1', { type: 'module' })) {
    super(zed, {
      command: 'rust-analyzer', makeWorker,
      includePath: path => /\.(?:rs|toml|json|md|txt)$/.test(path),
      formatConfigFiles: ['.rustfmt.toml', 'rustfmt.toml', 'Cargo.toml'],
    });
    this.buildOutputs = new Map();
    this.cargoChecks = new Map();
  }

  async processOpen(options) {
    const process = await super.processOpen(options);
    this.refreshBuildOutput(this.get(process.id));
    this.refreshCargoDiagnostics(this.get(process.id));
    return process;
  }

  publishCargo(root, { buildOutput, cargoDiagnostics }) {
    if (buildOutput) this.publishBuild(root, buildOutput);
    if (!cargoDiagnostics) return;
    this.cargoChecks.delete(root);
    if (cargoDiagnostics.length) this.cargoChecks.set(root, cargoDiagnostics);
    if (this.cargoChecks.size > MAX_BUILD_PACKAGES) this.cargoChecks.delete(this.cargoChecks.keys().next().value);
    for (const process of this.running.values()) this.refreshCargoDiagnostics(process);
  }

  publishBuild(root, { manifests, packages }) {
    const changed = new Set();
    const absolute = relative => `${root}/${relative}`;
    for (const manifest of manifests) {
      const path = absolute(manifest);
      if (this.buildOutputs.delete(path)) changed.add(path);
    }
    for (const output of packages) {
      const manifest = absolute(output.manifest);
      this.buildOutputs.set(manifest, { ...output, manifest, root });
      changed.add(manifest);
    }
    let bytes = 0;
    for (const output of this.buildOutputs.values()) {
      for (const [, file] of output.files) bytes += file.byteLength;
    }
    for (const [manifest, output] of this.buildOutputs) {
      if (bytes <= MAX_GENERATED_BYTES && this.buildOutputs.size <= MAX_BUILD_PACKAGES) break;
      for (const [, file] of output.files) bytes -= file.byteLength;
      this.buildOutputs.delete(manifest);
      changed.add(manifest);
    }
    for (const process of this.running.values()) {
      if ([...changed].some(manifest => manifest.startsWith(process.root + '/'))) this.refreshBuildOutput(process);
    }
  }

  async refreshBuildOutput(process) {
    if (!await process.ready || process.exitCode !== null) return;
    const packages = [...this.buildOutputs.values()].filter(output => output.manifest.startsWith(process.root + '/'));
    process.worker.postMessage({ type: 'build-output', packages });
  }

  async refreshCargoDiagnostics(process) {
    if (!await process.ready || process.exitCode !== null) return;
    const latest = new Map();
    for (const files of this.cargoChecks.values()) {
      for (const file of files) {
        if (file.path.startsWith(process.root + '/')) latest.set(file.path, file);
      }
    }
    process.worker.postMessage({ type: 'cargo-diagnostics', files: [...latest.values()] });
  }
}
