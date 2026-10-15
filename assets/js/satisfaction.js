const canvas = document.querySelector('#satisfaction-canvas');
const context = canvas.getContext('2d');
const sheet = document.querySelector('#bubble-sheet');
const status = document.querySelector('#satisfaction-status');
const modes = document.querySelectorAll('[data-satisfaction-mode]');
const soundButton = document.querySelector('#satisfaction-sound');
const pauseButton = document.querySelector('#satisfaction-pause');
const sand = document.createElement('canvas');
sand.width = 720; sand.height = 440;
const sandContext = sand.getContext('2d');
let mode = 'bubbles';
let sound = false;
let audio;
let engine;
let paused = false;
let frame = 0;
let previousTime = 0;
let accumulator = 0;
let pressed = false;
let draggingBubbles = false;
let pointer = { x: -1000, y: -1000 };
let previousPoint = null;
let popCount = 0;
let lastSound = 0;
let visible = true;
const reducedMotion = () => document.documentElement.dataset.motion === 'reduced'
  || (document.documentElement.dataset.motion !== 'full' && matchMedia('(prefers-reduced-motion: reduce)').matches);

function tone(frequency = 280) {
  if (!sound) return;
  const now = performance.now();
  if (now - lastSound < 45) return;
  lastSound = now;
  audio ||= new AudioContext();
  if (audio.state === 'suspended') audio.resume();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(65, audio.currentTime + .08);
  gain.gain.setValueAtTime(.055, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .1);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(); oscillator.stop(audio.currentTime + .1);
}

for (let i = 0; i < 40; i++) {
  const bubble = document.createElement('button');
  bubble.className = 'bubble';
  bubble.style.setProperty('--i', i);
  bubble.setAttribute('aria-label', `Bubble ${i + 1}`);
  bubble.setAttribute('aria-pressed', 'false');
  bubble.addEventListener('click', () => pop(bubble));
  sheet.append(bubble);
}
function pop(bubble) {
  if (!bubble || bubble.getAttribute('aria-pressed') === 'true') return;
  bubble.setAttribute('aria-pressed', 'true');
  tone(210 + (popCount % 5) * 35);
  popCount++;
  const visibleBubbles = [...sheet.children].filter(node => node.offsetHeight > 0);
  if (visibleBubbles.every(node => node.getAttribute('aria-pressed') === 'true')) status.textContent = 'All bubbles popped. Reset makes a new sheet.';
}
sheet.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  draggingBubbles = true;
  pop(event.target.closest('.bubble'));
});
sheet.addEventListener('pointermove', event => {
  if (draggingBubbles) pop(document.elementFromPoint(event.clientX, event.clientY)?.closest('.bubble'));
});
window.addEventListener('pointerup', () => { draggingBubbles = false; pressed = false; previousPoint = null; });
window.addEventListener('pointercancel', () => { draggingBubbles = false; pressed = false; previousPoint = null; });

function resetSand() {
  sandContext.fillStyle = '#c4ad7d'; sandContext.fillRect(0, 0, 720, 440);
  // Fixed grain positions avoid flicker and keep each reset reproducible.
  let seed = 417;
  for (let i = 0; i < 24000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const x = seed % 720;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    sandContext.fillStyle = i % 2 ? '#67593825' : '#fff3cc35';
    sandContext.fillRect(x, seed % 440, 1, 1);
  }
}
function rake(from, to) {
  for (let tooth = -3; tooth <= 3; tooth++) {
    sandContext.lineCap = 'round';
    sandContext.lineWidth = 4;
    sandContext.strokeStyle = '#76613f';
    sandContext.beginPath(); sandContext.moveTo(from.x + tooth * 9, from.y); sandContext.lineTo(to.x + tooth * 9, to.y); sandContext.stroke();
    sandContext.lineWidth = 1.4;
    sandContext.strokeStyle = '#eed9a7';
    sandContext.beginPath(); sandContext.moveTo(from.x + tooth * 9 - 2, from.y - 1); sandContext.lineTo(to.x + tooth * 9 - 2, to.y - 1); sandContext.stroke();
  }
}
function draw() {
  if (mode === 'rake') { context.drawImage(sand, 0, 0); return; }
  context.fillStyle = '#10171a'; context.fillRect(0, 0, 720, 440);
  if (!engine) return;
  for (let i = 0; i < engine.beads_count(); i++) {
    const x = engine.beads_value(i, 0), y = engine.beads_value(i, 1);
    const hue = 90 + (i % 25) * 3.2;
    context.fillStyle = `hsl(${hue} 35% 17%)`;
    context.beginPath(); context.arc(x + 1, y + 3, 5, 0, Math.PI * 2); context.fill();
    context.fillStyle = `hsl(${hue} 47% 65%)`;
    context.beginPath(); context.arc(x, y, 4, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#e9f5cfb0'; context.fillRect(x - 1.5, y - 2, 1.5, 1.5);
  }
}
function stop() { cancelAnimationFrame(frame); frame = 0; previousTime = 0; accumulator = 0; }
function tick(now) {
  if (paused || document.hidden || mode !== 'magnet') { stop(); return; }
  accumulator += previousTime ? Math.min((now - previousTime) / 1000, .05) : 0;
  previousTime = now;
  while (accumulator >= 1 / 120) {
    engine?.beads_step(1 / 120, pointer.x, pointer.y, Number(pressed));
    accumulator -= 1 / 120;
  }
  draw();
  frame = requestAnimationFrame(tick);
}
function resume() { if (!frame && !paused && visible && mode === 'magnet' && !document.hidden) frame = requestAnimationFrame(tick); }
function reset() {
  pressed = false; previousPoint = null; popCount = 0;
  for (const bubble of sheet.children) bubble.setAttribute('aria-pressed', 'false');
  sheet.classList.remove('is-resetting');
  if (!reducedMotion()) requestAnimationFrame(() => sheet.classList.add('is-resetting'));
  resetSand(); engine?.beads_reset(); draw();
  status.textContent = mode === 'bubbles' ? 'New bubble sheet.' : mode === 'rake' ? 'Fresh sand.' : 'Beads reset.';
}
function choose(next) {
  mode = next; stop(); pressed = false; previousPoint = null;
  sheet.hidden = mode !== 'bubbles'; canvas.hidden = mode === 'bubbles';
  pauseButton.hidden = mode !== 'magnet';
  soundButton.hidden = mode !== 'bubbles';
  for (const button of modes) button.setAttribute('aria-pressed', String(button.dataset.satisfactionMode === mode));
  canvas.setAttribute('aria-label', mode === 'rake' ? 'Sand rake. Drag to draw grooves. Arrow keys move; Space holds the rake.' : 'Magnetic beads. Move to push, hold to pull. Arrow keys move; Space attracts.');
  reset(); resume();
}
function move(event) {
  const bounds = canvas.getBoundingClientRect();
  const next = { x: (event.clientX - bounds.left) * 720 / bounds.width, y: (event.clientY - bounds.top) * 440 / bounds.height };
  if (pressed && mode === 'rake') rake(previousPoint || next, next);
  pointer = next; previousPoint = next;
  if (mode === 'rake') draw();
}
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  canvas.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId); pressed = true; move(event);
});
canvas.addEventListener('pointermove', move);
canvas.addEventListener('pointerleave', () => { if (!pressed) pointer = { x: -1000, y: -1000 }; });
canvas.addEventListener('lostpointercapture', () => { pressed = false; previousPoint = null; });
canvas.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) return;
  event.preventDefault();
  if (pointer.x < 0) pointer = { x: 360, y: 220 };
  const from = { ...pointer };
  if (event.key === ' ') pressed = true;
  if (event.key === 'ArrowLeft') pointer.x -= 10;
  if (event.key === 'ArrowRight') pointer.x += 10;
  if (event.key === 'ArrowUp') pointer.y -= 10;
  if (event.key === 'ArrowDown') pointer.y += 10;
  pointer.x = Math.max(0, Math.min(720, pointer.x)); pointer.y = Math.max(0, Math.min(440, pointer.y));
  if (mode === 'rake' && pressed) { rake(from, pointer); draw(); }
});
canvas.addEventListener('keyup', event => { if (event.key === ' ') pressed = false; });
canvas.addEventListener('blur', () => { pressed = false; pointer = { x: -1000, y: -1000 }; });
for (const button of modes) button.addEventListener('click', () => choose(button.dataset.satisfactionMode));
document.querySelector('#satisfaction-reset').addEventListener('click', reset);
soundButton.addEventListener('click', () => { sound = !sound; soundButton.setAttribute('aria-pressed', String(sound)); soundButton.textContent = sound ? 'sound on' : 'sound off'; if (sound) tone(); });
pauseButton.addEventListener('click', () => { paused = !paused; pauseButton.textContent = paused ? 'resume' : 'pause'; paused ? stop() : resume(); });
document.addEventListener('visibilitychange', () => document.hidden ? stop() : resume());
new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; visible ? resume() : stop(); }).observe(canvas);
choose('bubbles');
try {
  const response = await fetch('/assets/wasm/satisfaction.wasm');
  if (!response.ok) throw new Error('Could not load magnetic beads');
  engine = (await WebAssembly.instantiate(await response.arrayBuffer())).instance.exports;
  engine.beads_reset();
  document.querySelector('[data-satisfaction-mode=magnet]').disabled = false;
} catch { status.textContent = 'Magnetic beads could not load. Bubbles and sand are available.'; }
