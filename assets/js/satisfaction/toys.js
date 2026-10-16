// Each toy owns its small simulation; the page owns input, timing, and sound.
export const TOYS = {
  ripples: { label: 'ripples', hint: 'Tap or drag to disturb the water.' },
  pour: { label: 'falling sand', hint: 'Hold to pour sand. Reset clears the tray.' },
  symmetry: { label: 'symmetry', hint: 'Draw a mirrored pattern.' },
  dominoes: { label: 'dominoes', hint: 'Tap a tile to start the chain.' },
  strings: { label: 'strings', hint: 'Drag across the strings to pluck them.' },
  pendulums: { label: 'pendulum wave', hint: 'Tap to release a fresh wave.' },
  spirograph: { label: 'spirograph', hint: 'Tap to change the curve.' },
  fireworks: { label: 'fireworks', hint: 'Tap anywhere to launch a burst.' },
  sorting: { label: 'sorting', hint: 'Tap to sort. Tap again to shuffle.' },
};
const W = 720, H = 440;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const palettes = [[104, 167, 191], [285, 330, 24], [35, 51, 172], [190, 230, 277]];
export function createToys(context, tone) {
  let mode, time = 0, palette = 0, speed = 1, pointer = { x: -1000, y: -1000 }, pressed = false;
  let rings = [], sparks = [], dominoes = [], strings = [], bars = [], sortAt = 0, sorting = false, sortClock = 0;
  let grains = new Uint8Array(180 * 110), grainTick = 0, last = null, curve = 0, lastCurve = null;
  const ink = document.createElement('canvas'); ink.width = W; ink.height = H;
  const pen = ink.getContext('2d');
  function color(i = 0, light = 67, alpha = 1) { return `hsla(${palettes[palette][i % 3] + i % 17} 65% ${light}% / ${alpha})`; }
  function clearInk() { pen.fillStyle = '#10171a'; pen.fillRect(0, 0, W, H); }
  function shuffle() { bars = Array.from({ length: 64 }, (_, i) => (i + 1) / 64); for (let i = 63; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bars[i], bars[j]] = [bars[j], bars[i]]; } sortAt = 0; sorting = false; }
  function reset(next = mode) {
    mode = next; time = 0; rings = []; sparks = []; grains.fill(0); pressed = false; last = lastCurve = null; curve = 0; grainTick = 0;
    dominoes = Array.from({ length: 90 }, (_, i) => ({ x: 48 + (Math.floor(i / 15) % 2 ? 14 - i % 15 : i % 15) * 44, y: 65 + Math.floor(i / 15) * 61, fall: 0, active: false }));
    strings = Array.from({ length: 18 }, () => ({ amplitude: 0, phase: 0 }));
    clearInk(); shuffle();
  }
  function burst(x, y) {
    for (let i = 0; i < 65 && sparks.length < 700; i++) { const angle = Math.random() * Math.PI * 2, velocity = 40 + Math.random() * 190; sparks.push({ x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, life: 1.2 + Math.random(), max: 2.2, color: i }); }
    tone(120 + x / 3);
  }
  function down(point) {
    pointer = point; pressed = true; last = point;
    if (mode === 'pour') for (let dx = -4; dx <= 4; dx++) { const x = clamp(Math.floor(point.x / 4) + dx, 0, 179), y = clamp(Math.floor(point.y / 4), 0, 109); grains[y * 180 + x] = 1 + Math.floor(time * 2) % 3; }
    if (mode === 'ripples') { rings.push({ ...point, radius: 0, life: 1 }); tone(180 + point.y); }
    if (mode === 'fireworks') burst(point.x, point.y);
    if (mode === 'pendulums') time = 0;
    if (mode === 'spirograph') { curve = (curve + 1) % 7; time = 0; lastCurve = null; clearInk(); }
    if (mode === 'sorting') { if (sortAt >= 63) shuffle(); sorting = true; }
    if (mode === 'dominoes') { const tile = dominoes.reduce((best, tile) => Math.hypot(tile.x - point.x, tile.y - point.y) < Math.hypot(best.x - point.x, best.y - point.y) ? tile : best); tile.active = true; }
  }
  function move(point) {
    if (mode === 'symmetry' && pressed && last) {
      pen.lineWidth = 2.4; pen.lineCap = 'round'; pen.strokeStyle = color(Math.floor(time * 12));
      for (let arm = 0; arm < 8; arm++) for (const mirror of [-1, 1]) {
        pen.save(); pen.translate(W / 2, H / 2); pen.rotate(arm * Math.PI / 4); pen.scale(mirror, 1);
        pen.beginPath(); pen.moveTo(last.x - W / 2, last.y - H / 2); pen.lineTo(point.x - W / 2, point.y - H / 2); pen.stroke(); pen.restore();
      }
    }
    if (mode === 'strings' && last) for (let i = 0; i < strings.length; i++) {
      const x = 70 + i * 34;
      if (Math.min(last.x, point.x) <= x && Math.max(last.x, point.x) >= x && point.y > 55 && point.y < 390) { strings[i].amplitude = Math.min(55, Math.abs(point.x - last.x) + 12); tone(130 * 2 ** (i / 12)); }
    }
    pointer = point; last = point;
  }
  function up() { pressed = false; last = null; }
  function step(dt) {
    dt *= speed; time += dt;
    if (mode === 'ripples') {
      if (pressed && (rings.length === 0 || rings.at(-1).radius > 13)) rings.push({ ...pointer, radius: 0, life: 1 });
      for (const ring of rings) { ring.radius += dt * 105; ring.life -= dt * .32; }
      rings = rings.filter(r => r.life > 0).slice(-70);
    }
    if (mode === 'fireworks') { for (const p of sparks) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 70 * dt; p.life -= dt; } sparks = sparks.filter(p => p.life > 0); }
    if (mode === 'pour') {
      if (pressed) for (let i = 0; i < 14; i++) { const x = clamp(Math.floor(pointer.x / 4 + Math.random() * 9 - 4), 0, 179), y = clamp(Math.floor(pointer.y / 4), 0, 109); grains[y * 180 + x] = 1 + Math.floor(time * 2) % 3; }
      grainTick += dt * 75;
      for (let pass = 0; pass < Math.min(4, Math.floor(grainTick)); pass++) for (let y = 108; y >= 0; y--) {
        const reverse = (y + Math.floor(time * 100)) % 2;
        for (let n = 0; n < 180; n++) { const x = reverse ? 179 - n : n, at = y * 180 + x; if (!grains[at]) continue; const direction = Math.random() < .5 ? -1 : 1; let next = at + 180;
          if (grains[next]) { if (x + direction >= 0 && x + direction < 180 && !grains[next + direction]) next += direction; else if (x - direction >= 0 && x - direction < 180 && !grains[next - direction]) next -= direction; else continue; }
          grains[next] = grains[at]; grains[at] = 0;
        }
      }
      grainTick %= 1;
    }
    if (mode === 'dominoes') for (let i = 0; i < dominoes.length; i++) { const d = dominoes[i]; if (!d.active) continue; const before = d.fall; d.fall = Math.min(1, d.fall + dt * 4); if (before < .52 && d.fall >= .52) { if (i + 1 < dominoes.length) dominoes[i + 1].active = true; tone(200 + i % 12 * 25); } }
    if (mode === 'strings') for (const s of strings) { s.phase += dt * 28; s.amplitude *= Math.exp(-dt * 1.8); }
    if (mode === 'sorting' && sorting && sortAt < 63) {
      sortClock += dt * 20;
      const steps = Math.floor(sortClock); sortClock -= steps;
      for (let step = 0; step < steps && sortAt < 63; step++) { let lowest = sortAt; for (let j = sortAt + 1; j < 64; j++) if (bars[j] < bars[lowest]) lowest = j; [bars[sortAt], bars[lowest]] = [bars[lowest], bars[sortAt]]; tone(120 + bars[sortAt] * 650); sortAt++; }
    }
    if (mode === 'spirograph') {
      for (let i = 0; i < 8; i++) {
        const angle = time * 1.7 - dt * 1.7 * (7 - i) / 8, a = 112, b = 36 + curve * 5, ratio = (a - b) / b;
        const point = { x: W / 2 + (a - b) * Math.cos(angle) + 100 * Math.cos(ratio * angle), y: H / 2 + (a - b) * Math.sin(angle) - 100 * Math.sin(ratio * angle) };
        if (lastCurve) { pen.strokeStyle = color(Math.floor(time / 3), 65, .7); pen.lineWidth = 1.1; pen.beginPath(); pen.moveTo(lastCurve.x, lastCurve.y); pen.lineTo(point.x, point.y); pen.stroke(); } lastCurve = point;
      }
    }
  }
  function draw() {
    context.fillStyle = '#10171a'; context.fillRect(0, 0, W, H);
    if (mode === 'symmetry' || mode === 'spirograph') { context.drawImage(ink, 0, 0); return; }
    if (mode === 'ripples') {
      for (let y = 20; y < H; y += 18) { context.strokeStyle = '#293c413b'; context.beginPath(); for (let x = 0; x <= W; x += 8) { let wave = 0; for (const r of rings) { const d = Math.hypot(x - r.x, y - r.y) - r.radius; wave += Math.sin(d * .1) * Math.exp(-Math.abs(d) / 35) * 11 * r.life; } x ? context.lineTo(x, y + wave) : context.moveTo(x, y + wave); } context.stroke(); }
      for (const r of rings) { context.strokeStyle = color(1, 73, r.life * .6); context.lineWidth = 1.5; context.beginPath(); context.ellipse(r.x, r.y, r.radius, r.radius * .65, 0, 0, Math.PI * 2); context.stroke(); }
    }
    if (mode === 'pour') for (let i = 0; i < grains.length; i++) if (grains[i]) { context.fillStyle = color(grains[i], 61 + i % 7); context.fillRect(i % 180 * 4, Math.floor(i / 180) * 4, 4, 4); }
    if (mode === 'dominoes') for (let i = 0; i < dominoes.length; i++) { const d = dominoes[i]; context.save(); context.translate(d.x, d.y); context.rotate(d.fall * 1.25 * (Math.floor(i / 15) % 2 ? -1 : 1)); context.fillStyle = '#0005'; context.fillRect(-5, -16, 16, 33); context.fillStyle = color(i, d.fall ? 54 : 72); context.fillRect(-7, -26, 14, 32); context.fillStyle = '#19221f'; context.fillRect(-5, -11, 10, 1); context.fillRect(-1, -20, 2, 2); context.fillRect(-1, -4, 2, 2); context.restore(); }
    if (mode === 'strings') for (let i = 0; i < strings.length; i++) { const s = strings[i], x = 70 + i * 34; context.strokeStyle = color(i); context.lineWidth = 1.5; context.beginPath(); context.moveTo(x, 45); for (let y = 50; y <= 395; y += 5) context.lineTo(x + Math.sin((y - 45) / 350 * Math.PI) * Math.sin(s.phase) * s.amplitude, y); context.stroke(); context.fillStyle = color(i); context.fillRect(x - 3, 42, 6, 6); context.fillRect(x - 3, 392, 6, 6); }
    if (mode === 'pendulums') for (let i = 0; i < 18; i++) { const x = 54 + i * 36, length = 130 + i * 7, angle = Math.cos(time * (1.6 + i * .055)) * .44; const bx = x + Math.sin(angle) * 45, by = 65 + length * Math.cos(angle); context.strokeStyle = '#6b7d7770'; context.beginPath(); context.moveTo(x, 45); context.lineTo(bx, by); context.stroke(); context.fillStyle = color(i); context.beginPath(); context.arc(bx, by, 9, 0, Math.PI * 2); context.fill(); }
    if (mode === 'fireworks') for (const p of sparks) { context.fillStyle = color(p.color, 70, Math.min(1, p.life)); context.beginPath(); context.arc(p.x, p.y, 2, 0, Math.PI * 2); context.fill(); }
    if (mode === 'sorting') { for (let i = 0; i < bars.length; i++) { const height = bars[i] * 310; context.fillStyle = color(i < sortAt ? 0 : 2, i < sortAt ? 70 : 42); context.fillRect(40 + i * 10, 380 - height, 7, height); } context.strokeStyle = '#405249'; context.beginPath(); context.moveTo(35, 383); context.lineTo(685, 383); context.stroke(); }
  }
  return { reset, down, move, up, step, draw, setPalette(value) { palette = value % palettes.length; }, setSpeed(value) { speed = value; } };
}
