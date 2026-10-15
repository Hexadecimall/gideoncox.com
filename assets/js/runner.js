const canvas = document.querySelector('#hop-canvas');
const context = canvas.getContext('2d');
const overlay = document.querySelector('#hop-overlay');
const message = document.querySelector('#hop-message');
const start = document.querySelector('#hop-start');
const pauseButton = document.querySelector('#hop-pause');
const duckButton = document.querySelector('#hop-duck');
const duckKeys = new Set();
let duckPointer = false;
const setDuck = () => engine?.runner_duck(Number(duckPointer || duckKeys.size > 0));
const fullscreenButton = document.querySelector('#hop-fullscreen');
const game = document.querySelector('#hop');
let wasFullscreen = false;
const scoreOutput = document.querySelector('#hop-score');
const bestOutput = document.querySelector('#hop-best');
const status = document.querySelector('#hop-status');
const systemMotion = matchMedia('(prefers-reduced-motion: reduce)');
const preferences = () => window.sitePreferences?.values || {};
const reducedMotion = { get matches() {
  const prefs = preferences();
  return prefs.motion === 'reduced' || (prefs.motion !== 'full' && systemMotion.matches) || prefs.hopEffects === false;
} };
const jumpCodes = () => [preferences().jumpKey || 'Space', 'ArrowUp', 'KeyW'];
const duckCodes = () => [preferences().duckKey || 'ArrowDown', 'KeyS'];
let engine;
let mode = 'loading';
let frame = 0;
let lastTime = 0;
let accumulator = 0;
let best = 0;
let particles = [];
try { best = Math.max(0, Number(localStorage.getItem('hop-best')) || 0); } catch {}
bestOutput.value = String(best);

function draw() {
  const distance = engine?.runner_value(2) ?? 0;
  const y = engine?.runner_value(0) ?? 196;
  const jumps = engine?.runner_value(5) ?? 0;
  const x = engine?.runner_value(6) ?? 110;
  const angle = engine?.runner_value(7) ?? 0;
  const launched = Boolean(engine?.runner_value(8));
  const launchTime = engine?.runner_value(9) ?? 0;
  const crouching = Boolean(engine?.runner_value(10));
  const scroll = reducedMotion.matches ? 0 : distance;
  context.save();
  context.fillStyle = preferences().hopSky || '#101619';
  context.fillRect(0, 0, 720, 280);
  if (launched && !reducedMotion.matches) {
    const zoom = launchTime < .65 ? 1 + 1.2 * Math.min(1, launchTime / .22)
      : 1 + 1.2 * Math.max(0, 1 - (launchTime - .65) / .4);
    const shake = launchTime > .65 ? 10 * Math.max(0, 1 - (launchTime - .65) / 1.3) : 0;
    context.translate(121 + Math.sin(launchTime * 105) * shake, 165 + Math.cos(launchTime * 137) * shake);
    context.scale(zoom, zoom);
    context.translate(-121, -165);
  }
  context.strokeStyle = '#202b2d';
  context.lineWidth = 1;
  for (let i = 0; i < 15; i++) {
    const x = ((i * 57 - scroll * .12) % 800 + 800) % 800;
    const h = 17 + (i * 37) % 64;
    context.strokeRect(Math.floor(x), 218 - h, 32, h);
  }
  for (let i = 0; i < 28; i++) {
    const x = ((i * 137 - scroll * .05) % 720 + 720) % 720;
    const py = 20 + (i * 43) % 120;
    context.fillStyle = i % 4 === 0 ? '#7a8b76' : '#34423e';
    context.fillRect(Math.floor(x), py, 2, 2);
  }
  context.fillStyle = '#18231e';
  context.fillRect(0, 218, 720, 62);
  context.fillStyle = '#667b4c';
  context.fillRect(0, 218, 720, 2);
  context.fillStyle = '#2a382b';
  for (let i = 0; i < 28; i++) context.fillRect(((i * 32 - distance) % 896 + 896) % 896, 232 + i % 3 * 12, 12, 2);
  for (let i = 0; i < 4 && engine; i++) {
    const x = engine.runner_obstacle(i, 0);
    const width = engine.runner_obstacle(i, 1);
    const height = engine.runner_obstacle(i, 2);
    if (x > 720 || x + width < 0) continue;
    const kind = engine.runner_obstacle(i, 3);
    if (kind === 1) {
      context.fillStyle = '#090e11';
      context.fillRect(x, 218, width, 62);
      context.fillStyle = '#88c9dc';
      context.fillRect(x - 3, 218, 3, 9);
      context.fillRect(x + width, 218, 3, 9);
      context.fillStyle = '#22383d';
      context.fillRect(x + 4, 256, width - 8, 1);
    } else if (kind === 2) {
      const top = engine.runner_obstacle(i, 4);
      const flap = reducedMotion.matches ? 0 : Math.sin(distance * .2) * 8;
      context.fillStyle = '#9bb5d2';
      context.beginPath();
      context.moveTo(x + 11, top + 8);
      context.lineTo(x + 21, top - 7 + flap);
      context.lineTo(x + 26, top + 13);
      context.fill();
      context.fillStyle = '#88c9dc';
      context.fillRect(x + 3, top + 6, width - 3, 13);
      context.fillStyle = '#e5f5fa';
      context.fillRect(x + 5, top + 7, 5, 5);
      context.fillStyle = '#15212a';
      context.fillRect(x + 5, top + 9, 2, 2);
      context.fillStyle = '#f0a972';
      context.beginPath();
      context.moveTo(x + 3, top + 10);
      context.lineTo(x - 5, top + 15);
      context.lineTo(x + 3, top + 17);
      context.fill();
    } else if (kind === 3) {
      const top = Math.max(0, engine.runner_obstacle(i, 4));
      const height = 201 - top;
      context.fillStyle = '#30333c';
      context.fillRect(x, top, width, height);
      context.strokeStyle = '#8b91a0';
      context.strokeRect(x + .5, top + .5, width - 1, height - 1);
      context.strokeStyle = '#414651';
      for (let rib = x + 15; rib < x + width; rib += 23) {
        context.beginPath(); context.moveTo(rib, top); context.lineTo(rib, 190); context.stroke();
      }
      context.fillStyle = '#c0adf7';
      context.fillRect(x, 196, width, 5);
      context.fillStyle = '#151b20';
      for (let mark = 6; mark < width - 6; mark += 13) context.fillRect(x + mark, 196, 5, 5);
    } else {
      context.fillStyle = '#3b3028';
      context.fillRect(x, 218 - height, width, height);
      context.strokeStyle = '#c69570';
      context.strokeRect(x + .5, 218 - height + .5, width - 1, height - 1);
      context.fillStyle = '#f0a972';
      context.fillRect(x + 4, 222 - height, width - 8, 3);
    }
  }
  for (const p of particles) {
    context.globalAlpha = Math.max(0, p.life / .3);
    context.fillStyle = '#c6f277';
    context.fillRect(p.x, p.y, 3, 3);
  }
  context.globalAlpha = 1;
  context.fillStyle = '#0b0e11';
  context.fillRect(107, 219, 28, 4);
  context.save();
  context.translate(x + 11, y + (crouching ? 6 : 11));
  if (crouching) context.scale(1.13, 12 / 22);
  context.rotate(reducedMotion.matches ? 0 : angle);
  const whiteCap = launched && launchTime >= .22;
  if (whiteCap) {
    const forehead = context.createLinearGradient(0, -11, 0, 11);
    forehead.addColorStop(0, '#ffffff');
    forehead.addColorStop(.28, '#f9fff1');
    forehead.addColorStop(.7, '#dbf6ad');
    forehead.addColorStop(1, preferences().hopPlayer || '#c6f277');
    context.fillStyle = forehead;
  } else {
    context.fillStyle = mode === 'over' && !launched ? '#f0a972' : (preferences().hopPlayer || '#c6f277');
  }
  context.fillRect(-11, -11, 22, 22);
  if (!whiteCap) {
    context.fillStyle = '#e5ffb9';
    context.fillRect(-9, -11, 18, 3);
  }
  if (launched) {
    // The eyes widen as the camera closes in, then stay wide during flight.
    const surprise = Math.min(1, launchTime / .22);
    const eyeHeight = 2 + surprise * 4;
    for (const eyeX of [-4, 5]) {
      context.fillStyle = '#ffffff';
      context.strokeStyle = '#263321';
      context.lineWidth = .8;
      context.beginPath();
      context.ellipse(eyeX, 0, 2 + surprise * 1.7, eyeHeight, 0, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = '#263321';
      context.fillRect(eyeX + .5, -1.5, 1.4, 3);
    }
  } else {
    context.fillStyle = '#263321';
    context.fillRect(-4, -3, 3, 4);
    context.fillRect(4, -3, 3, 4);
  }
  context.restore();
  for (let i = 0; i < 2 && !launched; i++) {
    context.fillStyle = i < 2 - jumps ? '#c6f277' : '#394535';
    context.fillRect(x + 4 + i * 9, y - 20, 5, 3);
  }
  context.restore();
  if (launched && launchTime >= .6) {
    context.save();
    if (!reducedMotion.matches && launchTime < 2) {
      context.strokeStyle = '#e5ffb950';
      context.lineWidth = 2;
      for (let i = 0; i < 18; i++) {
        const direction = i * Math.PI / 9;
        const length = 190 + (i % 4) * 22;
        context.beginPath();
        context.moveTo(350 + Math.cos(direction) * length, 140 + Math.sin(direction) * length * .5);
        context.lineTo(350 + Math.cos(direction) * 470, 140 + Math.sin(direction) * 270);
        context.stroke();
      }
    }
    context.translate(460, 83);
    context.rotate(-.2);
    context.font = '900 italic 47px ui-monospace, monospace';
    context.textAlign = 'center';
    context.lineWidth = 9;
    context.strokeStyle = '#0b0e11';
    context.strokeText('NUTSHOT!!', 0, 0);
    context.fillStyle = '#f6ffe9';
    context.fillText('NUTSHOT!!', 0, 0);
    context.restore();
  }
}

function stopFrame() { cancelAnimationFrame(frame); lastTime = 0; accumulator = 0; }

function gameOver() {
  mode = 'over';
  stopFrame();
  const score = Math.floor(engine.runner_value(2) / 12);
  if (score > best) {
    best = score;
    bestOutput.value = String(best);
    try { localStorage.setItem('hop-best', String(best)); } catch {}
  }
  message.textContent = `${score} m`;
  start.textContent = 'Retry';
  overlay.hidden = false;
  pauseButton.disabled = true;
  duckButton.disabled = true;
  duckKeys.clear(); duckPointer = false; setDuck();
  status.textContent = `Run ended at ${score} meters. Press Enter to retry.`;
}

function tick(now) {
  if (mode !== 'running') return;
  const elapsed = lastTime ? Math.min((now - lastTime) / 1000, .05) : 0;
  lastTime = now;
  accumulator += elapsed;
  while (accumulator >= 1 / 120 && mode === 'running') {
    engine.runner_step(1 / 120);
    accumulator -= 1 / 120;
    if (engine.runner_value(4) === 2) gameOver();
  }
  particles = particles.filter(p => {
    p.x -= elapsed * 180;
    p.y += elapsed * p.vy;
    p.life -= elapsed;
    return p.life > 0;
  });
  scoreOutput.value = String(Math.floor(engine.runner_value(2) / 12));
  draw();
  if (mode === 'running') frame = requestAnimationFrame(tick);
}

function run() {
  if (!engine) return;
  if (mode !== 'paused') {
    engine.runner_reset(crypto.getRandomValues(new Uint32Array(1))[0]);
    particles = [];
    scoreOutput.value = '0';
  }
  mode = 'running';
  duckButton.disabled = false;
  overlay.hidden = true;
  pauseButton.disabled = false;
  pauseButton.textContent = 'Pause';
  status.textContent = 'Game running. Space or tap to jump, twice for a double jump.';
  stopFrame();
  canvas.focus({ preventScroll: true });
  frame = requestAnimationFrame(tick);
}

function pause() {
  if (mode !== 'running') return;
  mode = 'paused';
  duckKeys.clear(); duckPointer = false; setDuck();
  duckButton.disabled = true;
  stopFrame();
  message.textContent = 'Paused';
  start.textContent = 'Resume';
  overlay.hidden = false;
  pauseButton.textContent = 'Resume';
  status.textContent = 'Game paused.';
  draw();
}

function jump() {
  if (mode !== 'running') return;
  if (engine.runner_jump() && !reducedMotion.matches) {
    for (let i = 0; i < 5; i++) particles.push({ x: 110 + i * 4, y: engine.runner_value(0) + 22, vy: 25 + i * 12, life: .3 });
  }
}

start.addEventListener('click', run);
pauseButton.addEventListener('click', () => mode === 'paused' ? run() : pause());
fullscreenButton.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement === game) await document.exitFullscreen();
    else await game.requestFullscreen();
  } catch {
    status.textContent = 'Fullscreen is unavailable in this browser.';
  }
});
document.addEventListener('fullscreenchange', () => {
  const active = document.fullscreenElement === game;
  fullscreenButton.textContent = active ? 'Exit fullscreen' : 'Fullscreen';
  if (wasFullscreen && !active) pause();
  wasFullscreen = active;
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') pause(); });
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  event.preventDefault();
  canvas.focus({ preventScroll: true });
  jump();
});
canvas.addEventListener('keydown', event => {
  if ([...jumpCodes(), ...duckCodes(), 'KeyP', 'Escape', 'Enter'].includes(event.code)) event.preventDefault();
  if (event.repeat) return;
  if (duckCodes().includes(event.code) && mode === 'running') { duckKeys.add(event.code); setDuck(); return; }
  if (event.code === 'Enter' && mode !== 'running') run();
  else if (jumpCodes().includes(event.code)) jump();
  else if (event.code === 'KeyP') mode === 'paused' ? run() : pause();
  else if (event.code === 'Escape') pause();
});
document.addEventListener('keyup', event => { duckKeys.delete(event.code); setDuck(); });
window.addEventListener('blur', pause);
duckButton.addEventListener('pointerdown', event => {
  if (event.button !== 0 || mode !== 'running') return;
  event.preventDefault();
  duckButton.setPointerCapture(event.pointerId);
  duckPointer = true; setDuck();
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  duckButton.addEventListener(type, () => { duckPointer = false; setDuck(); });
}
duckButton.addEventListener('keydown', event => {
  if (['Space', 'Enter', 'ArrowDown', 'KeyS'].includes(event.code) && mode === 'running') {
    event.preventDefault(); duckKeys.add(event.code); setDuck();
  }
});
duckButton.addEventListener('blur', () => { duckKeys.clear(); setDuck(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
document.querySelectorAll('#menu-toggle, #cps-toggle, #quote-toggle').forEach(button => button.addEventListener('click', pause));
new IntersectionObserver(entries => {
  if (!entries[0].isIntersecting) pause();
}, { threshold: 0 }).observe(canvas);

draw();
try {
  const response = await fetch(new URL('../wasm/runner.wasm?v=2', import.meta.url));
  if (!response.ok) throw new Error('Game unavailable');
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
  engine = instance.exports;
  engine.runner_reset(7);
  mode = 'ready';
  start.disabled = false;
  start.textContent = 'Start';
  status.textContent = 'Game ready.';
  draw();
} catch {
  message.textContent = 'Couldn’t load the game. Reload to retry.';
  start.hidden = true;
  status.textContent = 'Game could not load.';
}

window.addEventListener('site-preferences-changed', () => { if (mode !== 'running') draw(); });
