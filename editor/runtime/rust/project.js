import { parse as parseToml } from './toml/index.js';

export const SYSROOT = '/toolchain/rust/library';
const editions = new Set(['2015', '2018', '2021', '2024']);
const decoder = new TextDecoder();
const sourceFile = path => path.endsWith('.rs');
const objectEntries = value => value && typeof value === 'object' ? Object.entries(value) : [];
const crateName = value => typeof value === 'string' && /^[A-Za-z_][\w-]*$/.test(value) ? value.replaceAll('-', '_') : undefined;

function directory(path) {
  return path.slice(0, path.lastIndexOf('/'));
}

function resolvePath(base, relative, root) {
  if (typeof relative !== 'string' || relative.startsWith('/') || /[\0\\]/.test(relative)) return null;
  const parts = base.split('/');
  for (const part of relative.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  const path = parts.join('/');
  return path === root || path.startsWith(root + '/') ? path : null;
}

function readManifest(files, path) {
  try { return parseToml(decoder.decode(files.get(path))); }
  catch { return null; } // An incomplete manifest should not interrupt language tools.
}

function packageEdition(manifest, workspace) {
  const setting = manifest.package.edition;
  const edition = setting?.workspace ? workspace?.package?.edition : setting;
  return editions.has(edition) ? edition : '2015';
}

function defaultFeatures(features) {
  const active = new Set();
  const pending = Array.isArray(features?.default) ? ['default'] : [];
  while (pending.length) {
    const name = pending.pop();
    if (active.has(name) || !/^[A-Za-z0-9_+.-]+$/.test(name) || !Object.hasOwn(features, name)) continue;
    active.add(name);
    if (Array.isArray(features[name])) {
      for (const value of features[name]) if (typeof value === 'string') pending.push(value);
    }
  }
  return [...active].map(name => `feature="${name}"`);
}

function packageTargets(files, base, root, manifest) {
  const targets = [];
  const add = (kind, path, name) => {
    if (path && files.has(path) && !targets.some(target => target.path === path)) {
      targets.push({ kind, path, name });
    }
  };
  const pkg = manifest.package;
  const library = manifest.lib;
  add('lib', resolvePath(base, library?.path ?? 'src/lib.rs', root), library?.name ?? pkg.name);
  for (const bin of Array.isArray(manifest.bin) ? manifest.bin : []) {
    const name = typeof bin?.name === 'string' ? bin.name : pkg.name;
    if (typeof bin?.path === 'string') add('bin', resolvePath(base, bin.path, root), name);
    else {
      add('bin', resolvePath(base, `src/bin/${name}.rs`, root), name);
      add('bin', resolvePath(base, `src/bin/${name}/main.rs`, root), name);
      if (name === pkg.name) add('bin', resolvePath(base, 'src/main.rs', root), name);
    }
  }
  if (pkg.autobins !== false) {
    add('bin', `${base}/src/main.rs`, pkg.name);
    const prefix = `${base}/src/bin/`;
    for (const path of files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const name = path.slice(prefix.length).match(/^([^/]+)(?:\.rs|\/main\.rs)$/)?.[1];
      if (name) add('bin', path, name);
    }
  }
  if (pkg.build !== false) {
    add('build', resolvePath(base, typeof pkg.build === 'string' ? pkg.build : 'build.rs', root), 'build_script_build');
  }
  return targets;
}

function rustProjectFromCargo(files, root, buildOutputs) {
  const manifests = new Map();
  for (const path of files.keys()) {
    if (path.endsWith('/Cargo.toml') && !path.includes('/target/')) {
      const manifest = readManifest(files, path);
      if (manifest) manifests.set(directory(path), manifest);
    }
  }
  const crates = [];
  const packages = new Map();
  for (const [base, manifest] of manifests) {
    const pkg = manifest.package;
    if (typeof pkg?.name !== 'string' || !crateName(pkg.name)) continue;
    let workspaceBase = resolvePath(base, pkg.workspace, root) ?? base;
    while (workspaceBase !== root && !manifests.get(workspaceBase)?.workspace) {
      workspaceBase = directory(workspaceBase);
    }
    const workspace = manifests.get(workspaceBase)?.workspace;
    const edition = packageEdition(manifest, workspace);
    const targets = packageTargets(files, base, root, manifest);
    const first = crates.length;
    let lib = null;
    for (const target of targets) {
      if (target.kind === 'lib') lib = crates.length;
      const output = target.kind !== 'build' && buildOutputs.get(`${base}/Cargo.toml`);
      crates.push({
        display_name: crateName(target.name) ?? crateName(pkg.name),
        root_module: target.path,
        edition,
        deps: [],
        cfg: [...defaultFeatures(manifest.features), ...(output?.cfg ?? [])],
        env: { CARGO_MANIFEST_DIR: base, ...output?.env },
        ...(output ? { source: { include_dirs: [base, output.env.OUT_DIR], exclude_dirs: [] } } : {}),
        is_workspace_member: true,
      });
    }
    packages.set(base, { first, targets, lib, workspace, workspaceBase, manifest });
  }
  for (const [base, pkg] of packages) {
    for (const [offset, target] of pkg.targets.entries()) {
      const index = pkg.first + offset;
      const dependencies = new Map();
      const tables = target.kind === 'build' ? ['build-dependencies'] : ['dependencies', 'dev-dependencies'];
      for (const [name, setting] of tables.flatMap(table => objectEntries(pkg.manifest[table]))) {
        const inherited = setting?.workspace === true;
        const dependency = inherited ? pkg.workspace?.dependencies?.[name] : setting;
        const depPath = resolvePath(inherited ? pkg.workspaceBase : base, dependency?.path, root);
        const depLib = packages.get(depPath)?.lib;
        if (Number.isInteger(depLib) && depLib !== pkg.lib && crateName(name)) {
          dependencies.set(crateName(name), { crate: depLib, name: crateName(name) });
        }
      }
      crates[index].deps = [...dependencies.values()];
      if (target.kind !== 'build' && pkg.lib !== null && pkg.lib !== index) {
        crates[index].deps.push({ crate: pkg.lib, name: crates[pkg.lib].display_name });
      }
    }
  }
  return crates;
}

function looseCrates(files, root) {
  const paths = [...files.keys()].filter(path => sourceFile(path) && directory(path) === root);
  const preferred = [`${root}/main.rs`, `${root}/lib.rs`].filter(path => files.has(path));
  const roots = preferred.length ? preferred : paths.length ? paths : [...files.keys()].filter(sourceFile).slice(0, 32);
  return roots.map(path => ({
    root_module: path, edition: '2024', deps: [], is_workspace_member: true,
  }));
}

export function browserRustProject(files, root, buildOutputs = new Map()) {
  const supplied = files.get(`${root}/rust-project.json`);
  if (supplied) {
    try {
      const project = JSON.parse(decoder.decode(supplied));
      if (Array.isArray(project.crates)) return { sysroot_src: SYSROOT, ...project };
    } catch { /* Keep editing possible while the project description is incomplete. */ }
  }
  const crates = rustProjectFromCargo(files, root, buildOutputs);
  return { sysroot_src: SYSROOT, crates: crates.length ? crates : looseCrates(files, root) };
}
