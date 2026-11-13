import { createStore } from './store/store.js';
import { openIdbBackend } from './store/idb.js';

const ROUTES = {
  today: './ui/today.js',
  edit: './ui/edit.js',
  week: './ui/week.js',
  settings: './ui/settings.js',
  help: './ui/help.js',
};
const NAV_ACTIVE = { today: 'today', edit: 'today', week: 'week', settings: 'settings', help: 'settings' };

function detectSource() {
  const standalone =
    (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
    navigator.standalone === true;
  return standalone ? 'phone' : 'web';
}

function parseHash(hash) {
  const parts = (hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  const name = ROUTES[parts[0]] ? parts[0] : 'today';
  return { name, params: { id: parts[1] ? decodeURIComponent(parts[1]) : undefined } };
}

async function boot() {
  try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
  const store = createStore(await openIdbBackend(), { source: detectSource() });
  const view = document.getElementById('view');
  let token = 0;

  const navigate = (hash) => {
    if (location.hash === hash) render();
    else location.hash = hash;
  };

  async function render() {
    const mine = ++token;
    const { name, params } = parseHash(location.hash);
    for (const a of document.querySelectorAll('#nav a')) {
      a.classList.toggle('active', a.dataset.route === NAV_ACTIVE[name]);
    }
    let mod;
    try {
      mod = await import(ROUTES[name]);
    } catch {
      mod = null;
    }
    if (mine !== token) return;
    view.replaceChildren();
    if (!mod || typeof mod.render !== 'function') {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = "This screen isn't available yet.";
      view.append(p);
      return;
    }
    await mod.render(view, { store, navigate, params });
  }

  addEventListener('hashchange', render);
  await render();
}

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('sw failed', e)));
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('view').textContent = 'Capture failed to start: ' + e.message;
});
