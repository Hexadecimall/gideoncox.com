import { prepareEditorIsolation } from './zed/isolation.js?v=2';

const frame = document.querySelector('.zed-frame');
const compact = matchMedia('(max-width: 600px), (pointer: coarse) and (max-width: 960px)');
if (compact.matches) {
  // The screen keyboard only resizes the top-level visual viewport.
  location.replace(frame.dataset.src);
} else if (!await prepareEditorIsolation().catch(() => false)) {
  frame.src = frame.dataset.src;
}
