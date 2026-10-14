const keys = { Escape: '\x1b', Tab: '\t', ControlC: '\x03', ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowLeft: '\x1b[D', ArrowRight: '\x1b[C', Enter: '\r' };
document.querySelectorAll('[data-terminal-key]').forEach(button => {
  // Keep the software keyboard open while using terminal-only keys.
  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', () => window.dispatchEvent(new CustomEvent('terminal-input', { detail: keys[button.dataset.terminalKey] })));
});
