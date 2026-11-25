import assert from 'node:assert/strict';
import test from 'node:test';
import { cargoDiagnostics } from '../editor/runtime/compiler/rust-diagnostics.js';
import { fileUri, RustDiagnostics, sourceDigest } from '../editor/runtime/rust/diagnostics.js';

const path = '/home/web/ws/crate/src/test #1.rs';
const uri = fileUri(path);
const encoder = new TextEncoder();

test('Cargo diagnostics map primary spans to UTF-16 workspace ranges', async () => {
  const cwd = '/home/web/ws';
  const text = 'let x = "🙂"; broken();\n';
  const location = { file_name: './src/test #1.rs', is_primary: true,
    line_start: 1, line_end: 1, column_start: 14, column_end: 20 };
  const message = { level: 'error', code: { code: 'E0425' }, message: 'missing function', spans: [location] };
  const files = await cargoDiagnostics(cwd, [[path, encoder.encode(text)]], [
    { directory: '/workspace/crate', message },
    { directory: '/cargo-home/registry/src/external', message },
  ]);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, path);
  assert.equal(files[0].digest, await sourceDigest(text));
  const [item] = files[0].items;
  assert.equal(item.code, 'E0425');
  assert.equal(item.source, 'rustc');
  assert.deepEqual(item.range, { start: { line: 0, character: 14 }, end: { line: 0, character: 20 } });
});

test('Cargo problems merge with analyzer problems and clear on source changes or a clean build', async () => {
  let source = 'invalid();';
  let version = 1;
  const published = [];
  const diagnostics = new RustDiagnostics(message => published.push(message), key => key === uri ? source : undefined,
    () => version);
  const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } };
  const analyzer = { source: 'rust-analyzer', message: 'analyzer warning', range, severity: 2 };
  const compiler = { source: 'rustc', message: 'missing function', code: 'E0425', range, severity: 1 };
  const result = [{ path, digest: await sourceDigest(source), items: [compiler] }];
  diagnostics.initialize();
  diagnostics.fromAnalyzer({ method: 'textDocument/publishDiagnostics', params: { uri, version, diagnostics: [analyzer] } });
  await diagnostics.replace(result);
  assert.deepEqual(published.at(-1).params.diagnostics, [compiler, analyzer]);
  await diagnostics.replace([]);
  assert.deepEqual(published.at(-1).params.diagnostics, [analyzer]);
  await diagnostics.replace(result);
  source = 'fn valid() {}';
  version++;
  diagnostics.invalidate(uri);
  assert.deepEqual(published.at(-1).params.diagnostics, []);
  await diagnostics.replace(result);
  assert.deepEqual(published.at(-1).params.diagnostics, []);
});
