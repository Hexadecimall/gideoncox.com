// Both execution modes share the same terminal renderer and preferences.
export function createDisplay(surface) {
  const options = () => {
    const prefs = window.sitePreferences?.values || {};
    return {
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono'),
      fontSize: prefs.terminalFontSize || 13,
      cursorStyle: prefs.terminalCursor || 'bar',
      cursorBlink: prefs.terminalBlink !== false,
      scrollback: prefs.terminalScrollback || 2500,
      theme: {
        background: '#0c110f', foreground: '#d6e0d2', cursor: prefs.accent || '#c6f277',
        selectionBackground: '#c6f27740', black: '#0c110f', red: '#eb8c7b',
        green: '#c6f277', yellow: '#e3cb83', blue: '#88c9dc', magenta: '#c0adf7',
        cyan: '#91d5b9', white: '#edf1ef', brightBlack: '#758673',
      },
    };
  };
  const terminal = new window.Terminal({ ...options(), lineHeight: 1.25, screenReaderMode: true, allowProposedApi: false });
  const fit = new window.FitAddon.FitAddon();
  terminal.loadAddon(fit);
  terminal.open(surface);
  const resize = () => { if (surface.getBoundingClientRect().width) fit.fit(); };
  new ResizeObserver(resize).observe(surface);
  window.addEventListener('site-preferences-changed', () => { Object.assign(terminal.options, options()); resize(); });
  window.visualViewport?.addEventListener('resize', resize);
  terminal.attachCustomKeyEventHandler(event => !(event.type === 'keydown' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && terminal.hasSelection()));
  resize();
  return { terminal, fit, resize };
}
