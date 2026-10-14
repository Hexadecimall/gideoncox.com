import { loadRenderer } from './wasm.js';

const drawing = document.querySelector('#drawing');
const undo = document.querySelector('#undo-drawing');
const clear = document.querySelector('#clear-drawing');
const inks = [...document.querySelectorAll('[data-ink]')];
const drawingStatus = document.querySelector('#drawing-status');
const history = [];
let ink = parseInt((window.sitePreferences?.values.brushColor || '#c6f277').slice(1), 16);
let activePointer = null;
let last = [80, 48];
let keyboard = false;

function position(event) {
  const box = drawing.getBoundingClientRect();
  return [Math.max(0, Math.min(159, Math.floor((event.clientX - box.left) * 160 / box.width))), Math.max(0, Math.min(95, Math.floor((event.clientY - box.top) * 96 / box.height)))];
}

async function startDrawing() {
  try {
    const runtime = await loadRenderer();
    const applyBrush = () => {
      const preferences = window.sitePreferences?.values;
      runtime.set_brush_size(preferences?.brushSize || 3);
      ink = parseInt((preferences?.brushColor || '#c6f277').slice(1), 16);
      inks.forEach(button => button.setAttribute('aria-pressed', String(parseInt(button.dataset.ink, 16) === ink)));
    };
    applyBrush();
    window.addEventListener('site-preferences-changed', applyBrush);
    const context = drawing.getContext('2d', { alpha: false });
    const pixels = new Uint8ClampedArray(runtime.memory.buffer, runtime.drawing_buffer(), 160 * 96 * 4);
    const frame = new ImageData(pixels, 160, 96);
    function paint() {
      context.putImageData(frame, 0, 0);
      if (keyboard && document.activeElement === drawing) {
        context.strokeStyle = '#edf1ef';
        context.lineWidth = 1;
        context.strokeRect(last[0] - 2.5, last[1] - 2.5, 5, 5);
      }
    }
    function remember() {
      history.push(pixels.slice());
      if (history.length > 12) history.shift();
      undo.disabled = false;
    }
    runtime.clear_drawing();
    paint();
    clear.disabled = false;
    inks.forEach(button => button.disabled = false);
    drawingStatus.textContent = 'Draw with your mouse or finger.';
    inks.forEach(button => button.addEventListener('click', () => {
      ink = parseInt(button.dataset.ink, 16);
      inks.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    }));
    drawing.addEventListener('pointerdown', event => {
      if (event.button !== 0 || activePointer !== null) return;
      event.preventDefault();
      keyboard = false;
      drawing.focus({ preventScroll: true });
      activePointer = event.pointerId;
      drawing.setPointerCapture(activePointer);
      remember();
      last = position(event);
      runtime.draw_line(...last, ...last, ink);
      paint();
    });
    drawing.addEventListener('pointermove', event => {
      if (event.pointerId !== activePointer) return;
      const next = position(event);
      runtime.draw_line(...last, ...next, ink);
      last = next;
      paint();
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => drawing.addEventListener(type, event => {
      if (event.pointerId === activePointer) activePointer = null;
    }));
    drawing.addEventListener('keydown', event => {
      const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!steps[event.key] && event.code !== 'Space') return;
      event.preventDefault();
      keyboard = true;
      const [dx, dy] = steps[event.key] ?? [0, 0];
      const next = [Math.max(0, Math.min(159, last[0] + dx * 3)), Math.max(0, Math.min(95, last[1] + dy * 3))];
      if (event.shiftKey || event.code === 'Space') {
        remember();
        runtime.draw_line(...last, ...next, ink);
      }
      last = next;
      paint();
    });
    drawing.addEventListener('blur', paint);
    undo.addEventListener('click', () => {
      if (!history.length) return;
      pixels.set(history.pop());
      undo.disabled = !history.length;
      paint();
    });
    clear.addEventListener('click', () => { remember(); runtime.clear_drawing(); paint(); });
  } catch (error) {
    drawingStatus.textContent = 'The drawing pad couldn’t load. Try refreshing.';
    console.error(error);
  }
}
startDrawing();
