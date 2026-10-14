const toggle = document.querySelector('#menu-toggle');
const menu = document.querySelector('#site-menu');
const header = document.querySelector('#site-header');
const folders = [...document.querySelectorAll('[data-menu-panel]')];
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const motions = new Map();
let menuOpen = false;

export function reveal(element, open, sidebar = false) {
  const wasHidden = element.hidden;
  const currentHeight = element.getBoundingClientRect().height;
  const currentTransform = getComputedStyle(element).transform;
  motions.get(element)?.cancel();
  element.inert = !open;
  if (open) element.hidden = false;
  if (window.sitePreferences?.values.motion === 'reduced' || (window.sitePreferences?.values.motion !== 'full' && motionPreference.matches)) {
    element.hidden = !open;
    motions.delete(element);
    return;
  }
  const frames = sidebar
    ? [{ transform: wasHidden ? 'translateX(-100%)' : currentTransform }, { transform: open ? 'translateX(0)' : 'translateX(-100%)' }]
    : [{ height: `${wasHidden ? 0 : currentHeight}px`, opacity: wasHidden ? 0 : 1 }, { height: `${open ? element.scrollHeight : 0}px`, opacity: open ? 1 : 0 }];
  const animation = element.animate(frames, { duration: open ? 240 : 180, easing: 'cubic-bezier(.22,.7,.25,1)' });
  motions.set(element, animation);
  animation.finished.then(() => {
    if (motions.get(element) !== animation) return;
    element.hidden = !open;
    motions.delete(element);
  }).catch(() => {});
}

export function setMenu(open, restoreFocus = false) {
  menuOpen = open;
  reveal(menu, open, true);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  if (restoreFocus) toggle.focus();
}

toggle.addEventListener('click', () => setMenu(!menuOpen));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuOpen) setMenu(false, true);
});
document.addEventListener('click', event => {
  if (menuOpen && !header.contains(event.target)) setMenu(false);
});
menu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMenu(false)));
folders.forEach(button => button.addEventListener('click', () => {
  const expand = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(expand));
  reveal(document.getElementById(button.getAttribute('aria-controls')), expand);
}));
motionPreference.addEventListener('change', event => {
  if (event.matches) motions.forEach(animation => animation.finish());
});
