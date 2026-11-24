import assert from 'node:assert/strict';
import test from 'node:test';
import { browserRustProject, SYSROOT } from '../editor/runtime/rust/project.js';
import { BrowserRust } from '../assets/js/zed/browser-rust.js';

const root = '/home/web';
const bytes = new TextEncoder();
const fileMap = entries => new Map(Object.entries(entries).map(([name, text]) => [root + '/' + name, bytes.encode(text)]));

test('Rust accepts explicit rust-project.json and supplies a local sysroot', () => {
  const crates = [{ root_module: 'code.rs', edition: '2021', deps: [] }];
  const files = fileMap({ 'rust-project.json': JSON.stringify({ crates }), 'code.rs': '' });
  assert.deepEqual(browserRustProject(files, root), { sysroot_src: SYSROOT, crates });
});

test('Rust links workspace libraries, binaries and local path dependencies', () => {
  const files = fileMap({
    'Cargo.toml': `[workspace]
members = ["app", "util"]
[workspace.package]
edition = "2024"
[workspace.dependencies]
shared = { path = "util" }`,
    'app/Cargo.toml': `[package]
name = "app-name"
edition.workspace = true
[dependencies]
shared.workspace = true
outside = { path = "../../outside" }
[features]
default = ["trace"]
trace = []`,
    'app/src/lib.rs': '',
    'app/src/main.rs': '',
    'util/Cargo.toml': '[package]\nname = "util"\n',
    'util/src/lib.rs': '',
  });
  const { crates } = browserRustProject(files, root);
  assert.deepEqual(crates.map(crate => crate.root_module), [
    '/home/web/app/src/lib.rs', '/home/web/app/src/main.rs', '/home/web/util/src/lib.rs',
  ]);
  assert.equal(crates[0].edition, '2024');
  assert.deepEqual(crates[0].deps, [{ crate: 2, name: 'shared' }]);
  assert.deepEqual(crates[1].deps, [{ crate: 2, name: 'shared' }, { crate: 0, name: 'app_name' }]);
  assert.deepEqual(crates[1].cfg, ['feature="default"', 'feature="trace"']);
});

test('new Rust files work without a manifest and folded browser paths stay local', () => {
  const files = fileMap({ 'main.rs': 'mod helper;', 'helper.rs': '' });
  assert.deepEqual(browserRustProject(files, root).crates.map(crate => crate.root_module), ['/home/web/main.rs']);
  const service = new BrowserRust({});
  assert.equal(service.accepts({ command: 'rust-analyzer', cwd: root }), true);
  assert.equal(service.accepts({ command: 'rust-analyzer', cwd: root + '/../host' }), false);
  assert.equal(service.accepts({ command: 'rust-analyzer', cwd: '/native' }), false);
});
