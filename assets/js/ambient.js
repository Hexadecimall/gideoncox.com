// Decorative motion never intercepts a click or enters the accessibility tree.
const layer = document.createElement('div');
layer.className = 'ambient';
layer.setAttribute('aria-hidden', 'true');
for (let i = 0; i < 22; i++) {
  const mark = document.createElement('i');
  mark.className = i % 5 === 0 ? 'ambient-cross' : i % 3 === 0 ? 'ambient-dash' : 'ambient-dot';
  mark.style.setProperty('--x', `${(i * 47 + 7) % 100}%`);
  mark.style.setProperty('--y', `${(i * 31 + 11) % 100}%`);
  mark.style.setProperty('--duration', `${16 + (i * 7) % 19}s`);
  mark.style.setProperty('--delay', `${-i * 3}s`);
  mark.style.setProperty('--drift', `${i % 2 ? -18 : 18}px`);
  layer.append(mark);
}
document.body.prepend(layer);
function visibility() { layer.classList.toggle('ambient-sleep', document.hidden); }
document.addEventListener('visibilitychange', visibility);
visibility();
