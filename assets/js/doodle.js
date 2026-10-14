import { reveal, setMenu } from './navigation.js';

const toggle = document.querySelector('#doodle-toggle');
const panel = document.querySelector('#doodle-panel');
function expand(open) {
  if (open) setMenu(false);
  toggle.setAttribute('aria-expanded', String(open));
  reveal(panel, open);
}
toggle.addEventListener('click', () => expand(toggle.getAttribute('aria-expanded') !== 'true'));
document.addEventListener('click', event => {
  if (!event.target.closest('.doodle-section') && toggle.getAttribute('aria-expanded') === 'true') expand(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
    expand(false);
    toggle.focus();
  }
});
if (location.hash === '#doodle-pad') expand(true);
window.addEventListener('hashchange', () => { if (location.hash === '#doodle-pad') expand(true); });
