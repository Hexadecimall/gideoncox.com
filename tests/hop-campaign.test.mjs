import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSave, buySkill, buyUpgrade, statsFor, rewardRun, availablePoints } from '../assets/js/hop/progression.js';
import { Combat } from '../assets/js/hop/combat.js';
const wasm = new WebAssembly.Module(readFileSync(new URL('../assets/wasm/runner.wasm', import.meta.url)));
const create = () => { const e = new WebAssembly.Instance(wasm).exports; e.runner_reset(19); return e; };
test('skills enforce prerequisites, costs and ranks, and refund-compatible stats', () => {
  const save = normalizeSave();
  assert.equal(buySkill(save, 'air'), false);
  assert.equal(buySkill(save, 'health'), true);
  assert.equal(statsFor(save).health, 4);
  assert.equal(buySkill(save, 'dash'), true);
  assert.equal(availablePoints(save), 0);
  assert.equal(buySkill(save, 'damage'), false);
  save.xp = 800;
  assert.equal(buySkill(save, 'air'), true);
  assert.equal(statsFor(save).air, 1);
});
test('stage rewards persist unlocks and upgrades spend the exact currency', () => {
  const save = normalizeSave();
  assert.equal(buyUpgrade(save, 'barrel'), false);
  const reward = rewardRun(save, { distance: 180, stage: 0, kills: 2, won: true });
  assert.equal(save.unlocked, 1);
  assert.equal(save.credits, reward.credits);
  const balance = save.credits;
  assert.equal(buyUpgrade(save, 'barrel'), true);
  assert.equal(save.credits, balance - 60);
  assert.equal(statsFor(save).damage, 10);
  assert.deepEqual(normalizeSave(JSON.parse(JSON.stringify(save))), save);
});
test('health gives damage grace and a dash protects without allowing repeated activation', () => {
  const e = create(); e.runner_configure(3, .3, 3, 0); e.runner_arena(1);
  assert.equal(e.runner_hit(), 1); assert.equal(e.runner_value(11), 2);
  assert.equal(e.runner_hit(), 0);
  for (let i = 0; i < 160; i++) e.runner_step(1 / 120);
  assert.equal(e.runner_dash(), 1); assert.equal(e.runner_dash(), 0); assert.equal(e.runner_hit(), 0);
  e.runner_heal(20); assert.equal(e.runner_value(11), 3);
  e.runner_jump();
  for (let i = 0; i < 40; i++) e.runner_step(1 / 120);
  assert.equal(e.runner_value(4), 1);
});
test('real WASM runner and combat can complete a boss fight with actual shots', () => {
  const e = create(), stats = statsFor(normalizeSave());
  e.runner_configure(9, .3, 3, 1);
  const combat = new Combat(e, stats, 0); combat.beginBattle();
  const initialHp = combat.boss.hp;
  for (let i = 0; i < 3600 && !combat.won && e.runner_value(4) === 1; i++) { e.runner_step(1 / 120); combat.step(1 / 120, true); }
  assert.ok(combat.boss.hp < initialHp);
  assert.equal(combat.won, true);
  assert.equal(e.runner_value(2), 0, 'arena freezes route distance');
  assert.ok(e.runner_value(11) < 9, 'boss projectiles inflict real damage');
});
test('later bosses can be cleared with an early-game build and lane-aware dodging', () => {
  const stats = statsFor(normalizeSave({ skills: { health: 1, damage: 2 }, upgrades: { barrel: 1 } }));
  for (const stage of [1, 2]) {
    const e = create(); e.runner_configure(stats.health, stats.dash, stats.cooldown, stats.air);
    const combat = new Combat(e, stats, stage); combat.beginBattle();
    for (let frame = 0; frame < 6000 && !combat.won && e.runner_value(4) === 1; frame++) {
      const incoming = combat.hostile.filter(p => p.x > 115 && p.x < 270).sort((a, b) => a.x - b.x)[0];
      e.runner_duck(Number(incoming && incoming.y < 195));
      if (incoming && incoming.y >= 195 && incoming.x < 235 && e.runner_value(5) === 0) e.runner_jump();
      e.runner_step(1 / 120); combat.step(1 / 120, true);
    }
    assert.equal(combat.won, true, `stage ${stage + 1} is clearable`);
    assert.ok(e.runner_value(11) > 0);
  }
});
