import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Shell } from '../assets/js/terminal/shell.js';
const ark = new WebAssembly.Module(readFileSync(new URL('../assets/wasm/ark-core.wasm', import.meta.url)));
const rust = new WebAssembly.Module(readFileSync(new URL('../assets/wasm/terminal.wasm', import.meta.url)));
const create = () => new Shell(ark, rust);

test('Ark expansion, functions, branches, loops and pipes use real values', () => {
  const shell = create();
  assert.equal(shell.run('name=world; echo "hello $name"').out, 'hello world\n');
  assert.equal(shell.run('hello() { echo hi $1; }; hello bob').out, 'hi bob\n');
  assert.equal(shell.run('printf "b\\na\\n" | sort | head -n 1').out, 'a\n');
  assert.equal(shell.run('i=0; while test $i -lt 3; do echo $i; i=$((i+1)); done').out, '0\n1\n2\n');
  assert.equal(shell.run('for x in a b c; do if test $x = b; then continue; fi; echo $x; done').out, 'a\nc\n');
  assert.equal(shell.run('false && echo no; true || echo no; echo $(echo yes)').out, 'yes\n');
});
test('redirection, globbing and snapshots share the same filesystem', () => {
  const shell = create();
  shell.run('mkdir notes; echo first > notes/a; echo second >> notes/a');
  assert.equal(shell.run('cat < notes/a').out, 'first\nsecond\n');
  assert.equal(shell.run('echo notes/*').out, 'notes/a\n');
  shell.run('missing 2> errors');
  assert.match(shell.files.request('read', 'errors')[0], /command not available/);
  const restored = create();
  restored.files.restore(shell.files.snapshot());
  assert.equal(restored.run('cat notes/a').out, 'first\nsecond\n');
});
test('parse errors recover and incomplete input is preserved for continuation', () => {
  const shell = create();
  assert.throws(() => shell.run('echo "unfinished'), error => error.incomplete === true);
  assert.equal(shell.run('echo "finished"').out, 'finished\n');
  assert.throws(() => shell.run('|'), Error);
  assert.equal(shell.run('echo recovered').out, 'recovered\n');
});
test('subshells isolate variables and cwd; scripts cannot loop without bounds', () => {
  const shell = create();
  assert.equal(shell.run('a=outside; (a=inside; cd /); echo $a; pwd').out, 'outside\n/home/web\n');
  assert.throws(() => shell.run('while true; do :; done'), /limit reached/);
  assert.equal(shell.run('echo still-working').out, 'still-working\n');
});
