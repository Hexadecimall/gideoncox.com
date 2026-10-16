import { STAGES } from './progression.js';
import { playSound } from './audio.js';
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export class Combat {
  constructor(engine, stats, stage = 0, endless = false) {
    this.engine = engine; this.stats = stats; this.stage = stage; this.endless = endless;
    this.shots = []; this.hostile = []; this.enemies = []; this.effects = []; this.boss = null;
    this.elapsed = 0; this.spawnAt = 5; this.fireCooldown = 0; this.kills = 0; this.combo = 0; this.comboTime = 0; this.won = false;
    this.battleStarted = false; this.shotId = 0;
  }
  player() { return { x: 113, y: this.engine.runner_value(0) + 2, w: 16, h: this.engine.runner_value(10) ? 8 : 18 }; }
  burst(x, y, color = '#c6f277', count = 10) { for (let i = 0; i < count; i++) this.effects.push({ x, y, vx: (Math.random() - .5) * 160, vy: (Math.random() - .5) * 160, life: .5, color }); }
  fire() {
    if (this.fireCooldown > 0 || this.won || this.engine.runner_value(4) !== 1) return false;
    const p = this.player();
    this.shots.push({ id: ++this.shotId, x: p.x + 20, y: p.y + p.h / 2 - 2, w: 13, h: 4, hit: new Set() });
    this.fireCooldown = this.stats.interval; playSound('shot');
    return true;
  }
  beginBattle() {
    this.battleStarted = true; this.engine.runner_arena(1); this.enemies = []; this.hostile = [];
    if (this.stats.repair) this.engine.runner_heal(1);
    const stage = STAGES[this.stage];
    this.boss = { x: 595, y: 145, w: 65, h: 70, hp: stage.hp, max: stage.hp, attack: 0, clock: 1.8, telegraph: 0, hit: 0 };
  }
  step(dt, firing) {
    if (this.won || this.engine.runner_value(4) !== 1) return;
    this.elapsed += dt; this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.comboTime -= dt; if (this.comboTime <= 0) this.combo = 0;
    if (firing) this.fire();
    const distance = this.engine.runner_value(2) / 12;
    if (!this.endless && !this.battleStarted && distance >= STAGES[this.stage].distance) this.beginBattle();
    if (!this.boss && this.elapsed >= this.spawnAt) {
      this.spawnAt = this.elapsed + Math.max(3.5, 7 - this.stage);
      this.enemies.push({ x: 745, y: Math.random() < .5 ? 160 : 105, w: 30, h: 26, hp: 16 + this.stage * 5, shot: 1.7, hit: 0 });
    }
    const p = this.player();
    for (const enemy of this.enemies) {
      enemy.x -= dt * (110 + this.stage * 20); enemy.shot -= dt; enemy.hit = Math.max(0, enemy.hit - dt);
      if (enemy.shot <= 0 && enemy.x > 230) {
        enemy.shot = 2.5;
        const dx = p.x - enemy.x, dy = p.y - enemy.y, length = Math.hypot(dx, dy);
        this.hostile.push({ x: enemy.x, y: enemy.y + 12, w: 8, h: 8, vx: dx / length * 195, vy: dy / length * 195 });
      }
      if (overlaps(p, enemy) && this.engine.runner_hit()) this.burst(p.x, p.y, '#efa87d');
    }
    if (this.boss) {
      const b = this.boss; b.clock -= dt; b.hit = Math.max(0, b.hit - dt);
      b.y = 142 + Math.sin(this.elapsed * 1.6) * (this.stage === 2 ? 24 : 8);
      b.telegraph = b.clock < .9 ? 1 - b.clock / .9 : 0;
      if (b.clock <= 0) {
        const lane = b.attack % 2 ? 178 : 205;
        const count = (b.hp < b.max * .5 ? 3 : 2) + (this.stage === 1 ? 1 : 0);
        for (let i = 0; i < count; i++) this.hostile.push({ x: b.x + i * 62, y: lane, w: this.stage === 1 && b.attack % 2 ? 42 : b.attack % 3 === 2 ? 32 : 12, h: 9, vx: -250 - this.stage * 35, vy: 0 });
        b.attack++; b.clock = Math.max(1.4, 2.5 - this.stage * .25 - (b.hp < b.max * .5 ? .35 : 0));
      }
    }
    for (const shot of this.shots) {
      shot.x += 620 * dt;
      for (const enemy of [...this.enemies, ...(this.boss ? [this.boss] : [])]) {
        if (enemy.hp <= 0 || shot.hit.has(enemy) || !overlaps(shot, enemy)) continue;
        shot.hit.add(enemy); enemy.hp -= this.stats.damage; enemy.hit = .1;
        this.burst(shot.x, shot.y, STAGES[this.stage].accent, 4);
        if (!this.stats.pierce || enemy === this.boss) shot.x = 900;
        if (enemy.hp <= 0) {
          this.burst(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, STAGES[this.stage].accent, 30);
          if (enemy === this.boss) { this.won = true; this.hostile = []; playSound('clear'); }
          else { this.kills++; this.combo++; this.comboTime = 5; if (this.stats.siphon && this.kills % 4 === 0) this.engine.runner_heal(1); }
        }
      }
    }
    for (const shot of this.hostile) {
      shot.x += shot.vx * dt; shot.y += shot.vy * dt;
      if (overlaps(p, shot)) { if (this.engine.runner_hit()) { this.burst(p.x, p.y, '#efa87d'); playSound('hit'); } shot.x = -100; }
    }
    for (const effect of this.effects) { effect.x += effect.vx * dt; effect.y += effect.vy * dt; effect.life -= dt; }
    this.effects = this.effects.filter(p => p.life > 0).slice(-250);
    this.shots = this.shots.filter(p => p.x < 760);
    this.hostile = this.hostile.filter(p => p.x > -40 && p.y < 300 && p.y > -60);
    this.enemies = this.enemies.filter(p => p.x > -50 && p.hp > 0);
  }
  draw(ctx, reducedMotion) {
    const accent = STAGES[this.stage].accent;
    for (const enemy of this.enemies) {
      ctx.fillStyle = enemy.hit ? '#fff' : '#606e80'; ctx.fillRect(enemy.x, enemy.y + 5, enemy.w, enemy.h - 5);
      ctx.fillStyle = '#ef9a89'; ctx.fillRect(enemy.x + 3, enemy.y + 11, 8, 4);
      ctx.strokeStyle = '#b0bfd1'; ctx.beginPath(); ctx.moveTo(enemy.x - 9, enemy.y + 4); ctx.lineTo(enemy.x + 39, enemy.y + 4); ctx.stroke();
    }
    if (this.boss) {
      const b = this.boss, lane = b.attack % 2 ? 182 : 209;
      if (b.telegraph) { ctx.strokeStyle = `rgba(240,150,120,${.15 + b.telegraph * .45})`; ctx.setLineDash([6, 8]); ctx.beginPath(); ctx.moveTo(0, lane); ctx.lineTo(b.x, lane); ctx.stroke(); ctx.setLineDash([]); }
      ctx.save(); ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
      if (!reducedMotion) ctx.rotate(Math.sin(this.elapsed * 2) * .04);
      ctx.fillStyle = b.hit ? '#fff' : '#29323e'; ctx.fillRect(-34, -35, 68, 70);
      ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.strokeRect(-34, -35, 68, 70);
      ctx.fillStyle = accent; ctx.fillRect(-24, -14, 18, 8); ctx.fillRect(7, -14, 18, 8);
      ctx.fillStyle = '#11151a'; ctx.fillRect(-18, -12, 5, 4); ctx.fillRect(12, -12, 5, 4);
      ctx.fillStyle = '#485764'; ctx.fillRect(-22, 14, 44, 8);
      if (this.stage === 1) { ctx.fillStyle = accent; for (let x = -24; x < 26; x += 10) ctx.fillRect(x, 16, 5, 16); }
      if (this.stage === 2) { ctx.strokeStyle = accent; ctx.rotate(this.elapsed * .8); ctx.strokeRect(-45, -45, 90, 90); }
      ctx.restore();
      ctx.fillStyle = '#20272f'; ctx.fillRect(210, 20, 300, 6);
      ctx.fillStyle = accent; ctx.fillRect(210, 20, 300 * Math.max(0, b.hp / b.max), 6);
      ctx.font = '11px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillText(STAGES[this.stage].boss, 360, 14); ctx.textAlign = 'start';
    }
    if (this.combo > 1) { ctx.fillStyle = accent; ctx.font = '11px ui-monospace, monospace'; ctx.fillText(`${this.combo} chain`, 20, 22); }
    ctx.fillStyle = '#d5f69b'; for (const p of this.shots) { ctx.shadowBlur = reducedMotion ? 0 : 9; ctx.shadowColor = '#c6f277'; ctx.fillRect(p.x, p.y, p.w, p.h); } ctx.shadowBlur = 0;
    ctx.fillStyle = '#ef9a89'; for (const p of this.hostile) ctx.fillRect(p.x, p.y, p.w, p.h);
    for (const p of this.effects) { ctx.globalAlpha = p.life * 2; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 3, 3); } ctx.globalAlpha = 1;
    const dash = this.engine.runner_value(13), invulnerable = this.engine.runner_value(12);
    if (dash > 0 || invulnerable > 0) { const p = this.player(); ctx.strokeStyle = dash > 0 ? '#b9abf5' : '#d5f69b'; ctx.lineWidth = 2; ctx.strokeRect(p.x - 6, p.y - 5, p.w + 12, p.h + 10); }
  }
}
