import { reveal, setMenu } from './navigation.js';

const disclosure = document.querySelector('#cps-toggle');
const panel = document.querySelector('#cps-panel');
function expand(open) {
  if (open && document.querySelector('#menu-toggle').getAttribute('aria-expanded') === 'true') setMenu(false);
  disclosure.setAttribute('aria-expanded', String(open));
  reveal(panel, open);
}
disclosure.addEventListener('click', () => expand(disclosure.getAttribute('aria-expanded') !== 'true'));
document.querySelector('#menu-toggle').addEventListener('click', () => {
  if (disclosure.getAttribute('aria-expanded') === 'true') expand(false);
});
document.addEventListener('click', event => {
  if (disclosure.getAttribute('aria-expanded') === 'true' && !event.target.closest('#cps-tester, a[href="#cps-tester"]')) expand(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && disclosure.getAttribute('aria-expanded') === 'true') {
    expand(false);
    disclosure.focus();
  }
});
document.querySelector('a[href="#cps-tester"]')?.addEventListener('click', () => expand(true));
if (location.hash === '#cps-tester') expand(true);

const target = document.querySelector('#cps-target');
const title = target.querySelector('strong');
const score = document.querySelector('#cps-score');
const total = document.querySelector('#cps-clicks');
const remaining = document.querySelector('#cps-time');
const progress = document.querySelector('#cps-progress');
const status = document.querySelector('#cps-status');
const reset = document.querySelector('#cps-reset');
let duration = (window.sitePreferences?.values.cpsSeconds || 5) * 1000;
function updateDuration() {
  if (state === 'running') return;
  duration = (window.sitePreferences?.values.cpsSeconds || 5) * 1000;
  document.querySelector('.cps-heading > span').textContent = `${duration / 1000}-second test`;
  if (state === 'ready') remaining.value = (duration / 1000).toFixed(1);
}
let state = 'ready';
let clicks = 0;
let started = 0;
let frame = 0;
let timeout = 0;

function finish() {
  if (state !== 'running') return;
  state = 'finished';
  cancelAnimationFrame(frame);
  clearTimeout(timeout);
  remaining.value = '0.0';
  score.value = (clicks / (duration / 1000)).toFixed(1);
  progress.style.transform = 'scaleX(0)';
  target.disabled = true;
  title.textContent = `${score.value} CPS`;
  status.textContent = `${clicks} clicks in ${duration / 1000} seconds. ${score.value} clicks per second.`;
  reset.hidden = false;
}

function tick() {
  if (state !== 'running') return;
  const elapsed = performance.now() - started;
  if (elapsed >= duration) { finish(); return; }
  remaining.value = ((duration - elapsed) / 1000).toFixed(1);
  score.value = (clicks / Math.max(1, elapsed / 1000)).toFixed(1);
  progress.style.transform = `scaleX(${1 - elapsed / duration})`;
  frame = requestAnimationFrame(tick);
}

target.addEventListener('click', () => {
  if (state === 'finished') return;
  if (state === 'running' && performance.now() - started >= duration) { finish(); return; }
  if (state === 'ready') {
    updateDuration();
    state = 'running';
    started = performance.now();
    title.textContent = 'Click';
    status.textContent = 'Test running.';
    timeout = setTimeout(finish, duration);
    frame = requestAnimationFrame(tick);
  }
  clicks += 1;
  total.value = String(clicks);
});
target.addEventListener('keydown', event => {
  if (event.repeat && (event.key === 'Enter' || event.code === 'Space')) event.preventDefault();
});
reset.addEventListener('click', () => {
  state = 'ready';
  clicks = 0;
  total.value = '0';
  score.value = '0.0';
  updateDuration();
  remaining.value = (duration / 1000).toFixed(1);
  progress.style.transform = 'scaleX(1)';
  title.textContent = 'Click to start';
  status.textContent = 'Your first click starts the timer.';
  target.disabled = false;
  reset.hidden = true;
  target.focus({ preventScroll: true });
});

window.addEventListener('site-preferences-changed', updateDuration);
updateDuration();
