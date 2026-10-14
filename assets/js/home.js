const canvas = document.querySelector('#orbit-canvas');
const context = canvas.getContext('2d');
const scatter = document.querySelector('#orbit-scatter');
const pause = document.querySelector('#orbit-pause');
const status = document.querySelector('#orbit-status');
const live = document.querySelector('.orbit-live');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let engine;
let points;
let count = 0;
let frame = 0;
let lastTime = 0;
let paused = false;
let visible = true;
let pointer = null;
let dimensions = { width: 0, height: 0, scale: 1 };
const reduced = () => {
  const preference = window.sitePreferences?.values.motion;
  return preference === 'reduced' || (preference !== 'full' && motion.matches);
};
const accent = () => window.sitePreferences?.values.accent || '#c6f277';

function draw() {
  if (!points) return;
  const { width, height, scale } = dimensions;
  context.clearRect(0, 0, width, height);
  const projected = [];
  for (let i = 0; i < count; i++) {
    const at = i * 7;
    projected.push([width / 2 + points[at] * scale, height / 2 + points[at + 1] * scale, points[at + 6]]);
  }
  context.strokeStyle = accent();
  context.lineWidth = .65;
  for (let i = 0; i < count; i++) {
    const [x, y, depth] = projected[i];
    const next = projected[(i + 12) % count];
    const distance = Math.hypot(x - next[0], y - next[1]);
    if (distance > scale * .2) continue;
    context.globalAlpha = .04 + (depth + 1) * .055;
    context.beginPath(); context.moveTo(x, y); context.lineTo(next[0], next[1]); context.stroke();
  }
  for (const [x, y, depth] of projected) {
    context.globalAlpha = Math.max(.12, Math.min(.95, .5 + depth * .5));
    context.fillStyle = depth > .35 ? '#e5f4cb' : accent();
    const radius = .75 + (depth + 1) * .45;
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
  }
  context.globalAlpha = 1;
}
function resize() {
  const box = canvas.getBoundingClientRect();
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(box.width * ratio);
  canvas.height = Math.round(box.height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  dimensions = { width: box.width, height: box.height, scale: Math.min(box.width * .45, box.height * .69) };
  draw();
}
function tick(now) {
  frame = 0;
  if (!engine || paused || !visible || document.hidden || reduced()) return;
  const delta = lastTime ? Math.min(.035, (now - lastTime) / 1000) : .016;
  lastTime = now;
  engine.orbit_step(delta, pointer?.[0] || 0, pointer?.[1] || 0, Number(Boolean(pointer)));
  draw();
  frame = requestAnimationFrame(tick);
}
function start() {
  cancelAnimationFrame(frame);
  lastTime = 0;
  const stopped = paused || reduced();
  pause.textContent = reduced() ? 'Motion off' : stopped ? 'Play' : 'Pause';
  pause.disabled = reduced();
  pause.setAttribute('aria-pressed', String(stopped));
  live.textContent = stopped ? '○ still' : '● live';
  if (!stopped && visible && !document.hidden) frame = requestAnimationFrame(tick);
  draw();
}
function position(event) {
  const box = canvas.getBoundingClientRect();
  pointer = [(event.clientX - box.left - dimensions.width / 2) / dimensions.scale, (event.clientY - box.top - dimensions.height / 2) / dimensions.scale];
}
canvas.addEventListener('pointermove', position);
canvas.addEventListener('pointerdown', event => {
  position(event);
  if (event.pointerType !== 'mouse') {
    engine?.orbit_step(.035, ...pointer, 1);
    draw();
  }
});
['pointerleave', 'pointercancel', 'pointerup'].forEach(name => canvas.addEventListener(name, () => { pointer = null; }));
function burst() {
  if (!engine) return;
  engine.orbit_scatter();
  if (paused || reduced()) {
    for (let i = 0; i < 12; i++) engine.orbit_step(.035, 0, 0, 0);
    draw();
  }
}
scatter.addEventListener('click', burst);
canvas.addEventListener('keydown', event => {
  if (event.code === 'Space') { event.preventDefault(); burst(); }
});
pause.addEventListener('click', () => {
  if (reduced()) { status.textContent = 'Motion is disabled in your settings.'; return; }
  paused = !paused;
  start();
});
new ResizeObserver(resize).observe(canvas);
new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; start(); }).observe(canvas);
document.addEventListener('visibilitychange', start);
window.addEventListener('site-preferences-changed', start);
motion.addEventListener('change', start);

try {
  const response = await fetch(new URL('../wasm/orbit.wasm', import.meta.url));
  if (!response.ok) throw new Error('Field unavailable');
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
  engine = instance.exports;
  engine.orbit_init();
  count = engine.orbit_count();
  points = new Float32Array(engine.memory.buffer, engine.orbit_buffer(), count * 7);
  status.textContent = 'Drag to interact · Space to scatter';
  resize();
  start();
} catch {
  status.textContent = 'Couldn’t load the field. The links below still work.';
  scatter.disabled = true;
  pause.disabled = true;
}
// Keep old shared game links useful after moving Hop to its own page.
if (location.hash === '#hop') location.replace('/games/hop/');
