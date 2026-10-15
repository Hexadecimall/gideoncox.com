import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const module = new WebAssembly.Module(readFileSync(new URL('../assets/wasm/satisfaction.wasm', import.meta.url)));
const create = () => { const engine = new WebAssembly.Instance(module).exports; engine.beads_reset(); return engine; };

test('magnet pulls real beads, then springs return to their original positions', () => {
  const engine = create();
  const index = 150;
  const x = engine.beads_value(index, 0), y = engine.beads_value(index, 1);
  for (let i = 0; i < 120; i++) engine.beads_step(1 / 120, x + 60, y, 1);
  assert.ok(engine.beads_value(index, 0) > x + 8);
  for (let i = 0; i < 1200; i++) engine.beads_step(1 / 120, -1000, -1000, 0);
  assert.ok(Math.abs(engine.beads_value(index, 0) - x) < .01);
  assert.ok(Math.abs(engine.beads_value(index, 1) - y) < .01);
});

test('hover repels; reset restores every bead after sustained interaction', () => {
  const engine = create();
  const home = Array.from({ length: engine.beads_count() }, (_, i) => [engine.beads_value(i, 0), engine.beads_value(i, 1)]);
  const [x, y] = home[150];
  for (let i = 0; i < 120; i++) engine.beads_step(1 / 120, x + 40, y, 0);
  assert.ok(engine.beads_value(150, 0) < x - 5);
  for (let i = 0; i < 2400; i++) engine.beads_step(1 / 120, 360, 220, 1);
  for (let i = 0; i < home.length; i++) assert.ok(Number.isFinite(engine.beads_value(i, 0)) && Number.isFinite(engine.beads_value(i, 1)));
  engine.beads_reset();
  for (let i = 0; i < home.length; i++) assert.deepEqual([engine.beads_value(i, 0), engine.beads_value(i, 1)], home[i]);
});
