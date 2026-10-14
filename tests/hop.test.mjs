import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const module = new WebAssembly.Module(readFileSync(new URL('../assets/wasm/runner.wasm', import.meta.url)));
const create = () => new WebAssembly.Instance(module).exports;

test('two jumps spin; a third jump is refused', () => {
  const engine = create(); engine.runner_reset(1);
  assert.equal(engine.runner_jump(), 1);
  engine.runner_step(1 / 120);
  assert.ok(engine.runner_value(7) > 0);
  assert.equal(engine.runner_jump(), 1);
  assert.equal(engine.runner_jump(), 0);
});
test('corner impact freezes, launches, and ends without scoring during the effect', () => {
  const engine = create(); engine.runner_reset(100);
  for (let frame = 0; frame < 350 && engine.runner_value(4) === 1; frame++) {
    if (frame === 217) engine.runner_jump();
    engine.runner_step(1 / 120);
  }
  assert.equal(engine.runner_value(4), 3);
  const x = engine.runner_value(6), y = engine.runner_value(0), score = engine.runner_value(2);
  for (let i = 0; i < 30; i++) engine.runner_step(1 / 120);
  assert.equal(engine.runner_value(6), x);
  assert.equal(engine.runner_value(0), y);
  for (let i = 0; i < 80; i++) engine.runner_step(1 / 120);
  assert.ok(engine.runner_value(6) > x);
  assert.ok(engine.runner_value(0) < y);
  assert.equal(engine.runner_value(2), score);
  for (let i = 0; i < 240; i++) engine.runner_step(1 / 120);
  assert.equal(engine.runner_value(4), 2);
  engine.runner_reset(1);
  assert.equal(engine.runner_value(8), 0);
  assert.equal(engine.runner_value(7), 0);
});

test('ducking clears the beam and incoming flyer; standing hits the beam', () => {
  function play(duck) {
    const engine = create(); engine.runner_reset(100);
    const seen = new Set();
    for (let frame = 0; frame < 1400 && engine.runner_value(4) === 1; frame++) {
      const hazards = Array.from({ length: 4 }, (_, i) => ({
        x: engine.runner_obstacle(i, 0), width: engine.runner_obstacle(i, 1), kind: engine.runner_obstacle(i, 3),
      })).filter(hazard => hazard.x + hazard.width > 110).sort((a, b) => a.x - b.x);
      const hazard = hazards[0];
      if (hazard.x < 210 && hazard.kind < 2 && engine.runner_value(5) === 0) engine.runner_jump();
      if (hazard.kind === 1 && hazard.x < 155 && engine.runner_value(5) === 1 && engine.runner_value(1) > -80) engine.runner_jump();
      engine.runner_duck(Number(duck));
      engine.runner_step(1 / 120);
      if (hazard.x < 140) seen.add(hazard.kind);
      if (engine.runner_value(2) > 1250) break;
    }
    return { state: engine.runner_value(4), seen };
  }
  assert.equal(play(false).state, 2);
  const ducked = play(true);
  assert.equal(ducked.state, 1);
  assert.ok(ducked.seen.has(2) && ducked.seen.has(3));
});
