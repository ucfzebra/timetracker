// Applies and remembers the Appearance choice. theme-boot.js does the same before first paint.
export const THEMES = ['dark', 'light', 'auto'];
const KEY = 'shopclock.theme';
const SURFACE = { dark: '#17140f', light: '#f7f3ec' };

export function readLocalTheme() {
  try { const v = localStorage.getItem(KEY); return THEMES.includes(v) ? v : null; } catch { return null; }
}

export function applyTheme(theme, { save = true } = {}) {
  const t = THEMES.includes(theme) ? theme : 'dark';
  document.documentElement.dataset.theme = t;
  const light = t === 'light' || (t === 'auto' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? SURFACE.light : SURFACE.dark);
  if (save) { try { localStorage.setItem(KEY, t); } catch { /* optional */ } }
  return t;
}
