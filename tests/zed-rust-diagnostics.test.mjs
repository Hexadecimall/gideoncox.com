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

test('Rust offers versioned Quick Fix edits for a complete, unchanged compiler suggestion', async () => {
  const cwd = '/home/web/ws';
  const second = '/home/web/ws/crate/src/helper.rs';
  const secondUri = fileUri(second);
  const source = new Map([[uri, '"🙂"; true\n'], [secondUri, 'false\n']]);
  const published = [];
  const diagnostics = new RustDiagnostics(message => published.push(message), key => source.get(key), key => key === uri ? 3 : undefined);
  const span = { file_name: 'src/test #1.rs', is_primary: true,
    line_start: 1, line_end: 1, column_start: 6, column_end: 10 };
  const fix = { ...span, suggested_replacement: 'flag', suggestion_applicability: 'MachineApplicable' };
  const helper = { ...fix, file_name: 'src/helper.rs', column_start: 1, column_end: 6, suggested_replacement: 'true' };
  const files = await cargoDiagnostics(cwd, [[path, encoder.encode(source.get(uri))],
    [second, encoder.encode(source.get(secondUri))]], [{ directory: '/workspace/crate', message: {
      level: 'warning', code: { code: 'clippy::bool_comparison' }, message: 'simplify expression', spans: [span],
      children: [
        { message: 'Simplify both expressions', spans: [fix, helper] },
        { message: 'Uncertain replacement', spans: [{ ...fix, suggestion_applicability: 'MaybeIncorrect' }] },
        { message: 'Replacement outside the project', spans: [fix, { ...helper, file_name: '../helper.rs' }] },
      ],
    } }]);
  diagnostics.initialize();
  await diagnostics.replace(files);
  const [diagnostic] = published.at(-1).params.diagnostics;
  assert.equal(diagnostic.fixes, undefined);
  const cursor = { line: 0, character: 8 };
  const params = { textDocument: { uri }, range: { start: cursor, end: cursor }, context: { only: ['quickfix'] } };
  const [action] = await diagnostics.quickFixes(params);
  assert.deepEqual(action, { title: 'Simplify both expressions', kind: 'quickfix', diagnostics: [diagnostic], edit: {
    documentChanges: [
      { textDocument: { uri, version: 3 }, edits: [{ range: diagnostic.range, newText: 'flag' }] },
      { textDocument: { uri: secondUri, version: null }, edits: [{ range: {
        start: { line: 0, character: 0 }, end: { line: 0, character: 5 },
      }, newText: 'true' }] },
    ],
  } });
  assert.equal((await diagnostics.quickFixes(params)).length, 1);
  assert.deepEqual(await diagnostics.quickFixes({ ...params, context: { only: ['refactor'] } }), []);
  source.set(secondUri, 'edited\n');
  assert.deepEqual(await diagnostics.quickFixes(params), []);
});
