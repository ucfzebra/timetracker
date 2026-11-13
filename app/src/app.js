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
  let id;
  try { id = parts[1] ? decodeURIComponent(parts[1]) : undefined; } catch { id = parts[1]; }
  return { name, params: { id } };
}

async function boot() {
  try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
  const store = createStore(await openIdbBackend(), { source: detectSource() });
  const view = document.getElementById('view');
  let token = 0;
  let waiters = [];

  // Resolves once the screen for `hash` has rendered, so callers can keep their button
  // disabled through the navigation (a 5 s cap guards against a lost hashchange).
  const navigate = (hash) => new Promise((resolve) => {
    waiters.push(resolve);
    setTimeout(resolve, 5000);
    if (location.hash === hash) render();
    else location.hash = hash;
  });
  const settle = () => {
    const w = waiters;
    waiters = [];
    for (const r of w) r();
  };

  let shownRoute = null; // route of the screen currently in #view

  const message = (text, withReload) => {
    const box = document.createElement('div');
    const p = document.createElement('p');
    p.className = withReload ? 'error' : 'muted';
    p.textContent = text;
    box.append(p);
    if (withReload) {
      const b = document.createElement('button');
      b.textContent = 'Reload';
      b.addEventListener('click', () => location.reload());
      box.append(b);
    }
    return box;
  };

  async function render() {
    const mine = ++token;
    const isCurrent = () => mine === token;
    const { name, params } = parseHash(location.hash);
    for (const a of document.querySelectorAll('#nav a')) {
      a.classList.toggle('active', a.dataset.route === NAV_ACTIVE[name]);
    }
    try {
      let mod = null;
      try {
        mod = await import(ROUTES[name]);
      } catch (e) {
        console.error('screen failed to load', e);
      }
      if (!isCurrent()) return;
      let box;
      if (!mod || typeof mod.render !== 'function') {
        box = message("This screen isn't available yet.", false);
      } else {
        // Render off-screen; only the newest render is swapped in, so a slow earlier
        // render can never append to (or replace) a newer screen.
        box = document.createElement('div');
        box.className = 'screen';
        try {
          await mod.render(box, { store, navigate, params, isCurrent, prev: shownRoute });
        } catch (e) {
          console.error(e);
          box = message('Something went wrong: ' + (e && e.message ? e.message : String(e)), true);
        }
      }
      if (!isCurrent()) return;
      view.replaceChildren(box);
      shownRoute = name;
    } finally {
      if (isCurrent()) settle();
    }
  }

  addEventListener('hashchange', render);
  await render();
}

if ('serviceWorker' in navigator) {
  // After a deploy the new worker takes over (skipWaiting + claim). Reload once so the page
  // runs the new core and screen modules together. Not on first install (no controller yet).
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('sw failed', e)));
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('view').textContent = 'Capture failed to start: ' + e.message;
});
