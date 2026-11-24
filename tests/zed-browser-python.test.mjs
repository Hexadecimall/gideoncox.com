import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BrowserPython } from '../assets/js/zed/browser-python.js';
import { LspFrames, lspFrame } from '../assets/js/zed/lsp-stream.js';
import { WorkerHost } from './fixtures/zed-worker-host.mjs';

test('LSP frames preserve split Unicode bytes and multiple messages', () => {
  const first = { jsonrpc: '2.0', method: 'text', params: 'π 🐍' };
  const next = { jsonrpc: '2.0', id: 2, result: null };
  const a = lspFrame(first);
  const b = lspFrame(next);
  const tail = Uint8Array.from([...a.slice(-3), ...b]);
  const reader = new LspFrames();
  assert.deepEqual(reader.push(a.slice(0, 7)), []);
  assert.deepEqual(reader.push(a.slice(7, -3)), []);
  assert.deepEqual(reader.push(tail), [first, next]);
});

test('browser Pyright resolves project imports and returns core LSP results', { timeout: 20_000 }, async context => {
  const encode = new TextEncoder();
  const root = '/home/web/sample';
  const source = root + '/main.py';
  const uri = 'file://' + source;
  const helper = root + '/helpers.py';
  const contents = new Map([
    [source, 'from helpers import calculate\nresult = calculate(3)\nwrong: str = result\n'],
    [helper, 'def calculate(n: int) -> int:\n    return n + 1\n'],
  ]);
  const fs = {
    list_browser_paths: async () => JSON.stringify([...contents.keys()].map(path => ({ path, isDirectory: false }))),
    read_browser_file: async path => encode.encode(contents.get(path)),
  };
  const vendor = new URL('../assets/vendor/pyright/', import.meta.url);
  const python = new BrowserPython(fs, () => new WorkerHost(new URL('pyright.worker.js', vendor)),
    async () => JSON.parse(await readFile(new URL('typeshed-stdlib.json', vendor), 'utf8')));
  context.after(() => python.close());
  const command = 'zed-browser-pyright';
  await assert.rejects(python.processOpen({ command, cwd: '/outside' }), /browser files only/);
  const { id } = await python.processOpen({ command, cwd: root });
  const frames = new LspFrames();
  const inbox = [];
  const send = message => python.processWrite(id, lspFrame({ jsonrpc: '2.0', ...message }));
  const receive = async (match, description) => {
    let index;
    const deadline = AbortSignal.timeout(5000);
    const timeout = new Promise((_, reject) => {
      deadline.addEventListener('abort', () => reject(new Error(`Timed out waiting for ${description}`)), { once: true });
    });
    while ((index = inbox.findIndex(match)) < 0) {
      const result = await Promise.race([python.processRead(id), timeout]);
      assert.equal(result.ended, false, new TextDecoder().decode(result.stderr));
      for (const message of frames.push(result.stdout)) {
        if (typeof message.method === 'string' && message.id !== undefined) {
          if (message.method === 'workspace/configuration') {
            assert.ok(message.params.items.every(item => item.scopeUri === 'file://' + root));
          }
          const response = message.method === 'workspace/configuration'
            ? message.params.items.map(() => null) : null;
          await send({ id: message.id, result: response });
        } else inbox.push(message);
      }
    }
    return inbox.splice(index, 1)[0];
  };
  const reply = async id => {
    const message = await receive(item => item.id === id, `response ${id}`);
    assert.equal(message.error, undefined, JSON.stringify(message));
    return message.result;
  };
  try {
    await send({ id: 1, method: 'initialize', params: {
      processId: null, rootPath: root, rootUri: 'file://' + root,
      workspaceFolders: [{ uri: 'file://' + root, name: 'sample' }],
      capabilities: {
        workspace: {
          workspaceFolders: true,
          configuration: true,
          didChangeWatchedFiles: { dynamicRegistration: true, relativePatternSupport: true },
          workspaceEdit: { documentChanges: true },
        },
        window: { workDoneProgress: true },
      },
    } });
    const { capabilities } = await reply(1);
    assert.ok(capabilities.hoverProvider && capabilities.completionProvider && capabilities.definitionProvider);
    await send({ method: 'initialized', params: {} });
    await send({ method: 'textDocument/didOpen', params: {
      textDocument: { uri, languageId: 'python', version: 1, text: contents.get(source) },
    } });
    const params = { textDocument: { uri }, position: { line: 1, character: 11 } };
    await send({ id: 2, method: 'textDocument/hover', params });
    assert.match(JSON.stringify(await reply(2)), /calculate/);
    await send({ id: 3, method: 'textDocument/definition', params });
    assert.match(JSON.stringify(await reply(3)), /helpers\.py/);
    await send({ id: 4, method: 'textDocument/completion', params });
    const completions = await reply(4);
    assert.ok((completions.items ?? completions).some(item => item.label === 'calculate'));
    const diagnostic = await receive(item => item.method === 'textDocument/publishDiagnostics'
      && item.params.uri === uri && item.params.diagnostics.some(issue => /str/.test(issue.message)), 'initial type error');
    assert.equal(diagnostic.params.diagnostics[0].range.start.line, 2);
    await send({ id: 5, method: 'textDocument/signatureHelp', params: {
      ...params, position: { line: 1, character: 19 },
    } });
    assert.equal((await reply(5)).signatures[0].label, '(n: int) -> int');
    await send({ id: 6, method: 'textDocument/rename', params: { ...params, newName: 'compute' } });
    const edits = JSON.stringify(await reply(6));
    assert.match(edits, /main\.py/);
    assert.match(edits, /compute/);
    await send({ method: 'textDocument/didChange', params: {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: contents.get(source).replace('wrong: str', 'wrong: int') }],
    } });
    await receive(item => item.method === 'textDocument/publishDiagnostics'
      && item.params.uri === uri && item.params.diagnostics.length === 0, 'cleared diagnostic after edit');
    await send({ id: 7, method: 'shutdown', params: null });
    await reply(7);
    await send({ method: 'exit', params: null });
    assert.equal((await python.processRead(id)).exitCode, 0);
  } finally {
    await python.processClose(id);
  }
});
