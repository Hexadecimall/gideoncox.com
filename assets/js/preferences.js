// Applied before paint on every page. Only known, bounded values are accepted.
(() => {
  const defaults = {
    accent: '#c6f277', background: '#0b0e11', font: 'mono', motion: 'system', density: 'comfortable',
    terminalFontSize: 13, terminalCursor: 'bar', terminalBlink: true, terminalScrollback: 2500,
    editorFontSize: 14, editorTabSize: 2, editorWrap: false,
    brushSize: 3, brushColor: '#c6f277', cpsSeconds: 5,
    hopPlayer: '#c6f277', hopSky: '#101619', hopEffects: true, jumpKey: 'Space', duckKey: 'ArrowDown',
  };
  const choices = { font: ['mono', 'menlo', 'consolas'], motion: ['system', 'reduced', 'full'], density: ['comfortable', 'compact'], terminalCursor: ['bar', 'block', 'underline'], jumpKey: ['Space', 'ArrowUp', 'KeyW', 'KeyZ'], duckKey: ['ArrowDown', 'KeyS', 'KeyX'] };
  const ranges = { terminalFontSize: [10, 22], terminalScrollback: [100, 10000], editorFontSize: [10, 24], editorTabSize: [2, 8], brushSize: [1, 9], cpsSeconds: [3, 30] };
  const key = 'site-preferences-v1';
  let values = { ...defaults };
  function validate(input) {
    const result = { ...defaults };
    for (const [name, fallback] of Object.entries(defaults)) {
      const value = input?.[name];
      if (choices[name]) { if (choices[name].includes(value)) result[name] = value; }
      else if (ranges[name]) { if (Number.isFinite(value)) result[name] = Math.round(Math.max(ranges[name][0], Math.min(ranges[name][1], value))); }
      else if (typeof fallback === 'boolean') { if (typeof value === 'boolean') result[name] = value; }
      else if (/^#[0-9a-f]{6}$/i.test(value)) result[name] = value;
    }
    return result;
  }
  function load() {
    try { values = validate(JSON.parse(localStorage.getItem(key))); } catch { values = { ...defaults }; }
    apply();
  }
  function apply() {
    const root = document.documentElement;
    root.style.setProperty('--lime', values.accent);
    root.style.setProperty('--bg', values.background);
    root.style.setProperty('--mono', { mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', menlo: 'Menlo, monospace', consolas: 'Consolas, "Liberation Mono", monospace' }[values.font]);
    root.style.setProperty('--terminal-font-size', values.terminalFontSize + 'px');
    root.style.setProperty('--editor-font-size', values.editorFontSize + 'px');
    root.style.setProperty('--editor-tab-size', values.editorTabSize);
    root.dataset.motion = values.motion;
    root.dataset.density = values.density;
    window.dispatchEvent(new CustomEvent('site-preferences-changed', { detail: { ...values } }));
  }
  window.sitePreferences = {
    get values() { return { ...values }; },
    defaults,
    update(changes) {
      values = validate({ ...values, ...changes });
      localStorage.setItem(key, JSON.stringify(values));
      apply();
    },
    reset() { values = { ...defaults }; localStorage.removeItem(key); apply(); },
  };
  window.addEventListener('storage', event => { if (event.key === key) load(); });
  load();
})();
