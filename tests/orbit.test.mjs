import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('particle field remains finite through interaction and settles after scattering', async () => {
  const { instance } = await WebAssembly.instantiate(await readFile(new URL('../assets/wasm/orbit.wasm', import.meta.url)));
  const core = instance.exports;
  core.orbit_init();
  const data = new Float32Array(core.memory.buffer, core.orbit_buffer(), core.orbit_count() * 7);
  for (let round = 0; round < 10; round++) {
    core.orbit_scatter();
    for (let i = 0; i < 180; i++) core.orbit_step(1 / 60, .2, -.1, 1);
  }
  for (let i = 0; i < 600; i++) core.orbit_step(1 / 60, 0, 0, 0);
  assert.ok([...data].every(Number.isFinite));
  for (let i = 0; i < core.orbit_count(); i++) {
    assert.ok(Math.abs(data[i * 7]) < 1.2);
    assert.ok(Math.abs(data[i * 7 + 1]) < 1.2);
  }
});
