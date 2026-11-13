// Browser smoke test. Steps are named; later tasks append to STEPS.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through */ }
  const root = execSync('npm root -g').toString().trim();
  return createRequire(join(root, 'x.js'))('playwright');
}

const APP = fileURLToPath(new URL('../app/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.json': 'application/json',
};

function serve() {
  const server = http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = normalize(join(APP, p));
      if (!file.startsWith(APP)) throw new Error('forbidden');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

const STEPS = [];
const step = (name, fn) => STEPS.push({ name, fn });

const FIRST_RUN = 'Add your first nickname';
const viewText = (page) => page.evaluate(() => document.getElementById('view').textContent);
const today = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function watch(page, errors) {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
}

step('service worker registered', async ({ page }) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
});

step('loads offline on first visit (fresh context, no warm reload)', async ({ browser, url, device }) => {
  const ctx = await browser.newContext(device);
  const offlineErrors = [];
  try {
    const page = await ctx.newPage();
    watch(page, offlineErrors);
    await page.goto(url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 5000 });
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('view').textContent.trim().length > 0);
    const text = await viewText(page);
    if (/failed to start/i.test(text)) throw new Error(text);
    if (!text.includes(FIRST_RUN)) throw new Error(`unexpected view text: ${text}`);
    if (offlineErrors.length) throw new Error('offline page errors: ' + offlineErrors.join(' | '));
  } finally {
    await ctx.close();
  }
});

step('idb backend round-trips each table', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { openIdbBackend } = await import('./src/store/idb.js');
    const b = await openIdbBackend('capture-smoke-' + Date.now());
    const rows = {
      entries: { entry_id: 'e1', date: '2026-11-13', nickname: 'a' },
      nicknames: { name: 'alpha', n: 1 },
      settings: { key: 'windowDays', value: 14 },
    };
    const out = {};
    for (const [t, row] of Object.entries(rows)) {
      await b.put(t, row);
      const key = Object.values(row)[0];
      out[t] = {
        get: JSON.stringify(await b.get(t, key)) === JSON.stringify(row),
        all: (await b.all(t)).length === 1,
        missing: (await b.get(t, 'nope')) === undefined,
      };
    }
    return out;
  });
  for (const [t, o] of Object.entries(r)) {
    if (!o.get || !o.all || !o.missing) throw new Error(`idb ${t}: ${JSON.stringify(o)}`);
  }
});


const dialogs = (page) => page.on('dialog', (d) => d.accept());
const onToday = (page) => page.waitForSelector('#day-total');
const goto = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); };

step('first run: add nickname Falcon', async ({ page, url }) => {
  dialogs(page);
  await page.goto(url);
  await page.waitForSelector('#first-nick');
  await page.fill('#first-nick', 'Falcon');
  await page.click('#first-add');
  await onToday(page);
  const opts = await page.$$eval('#nick option', (o) => o.map((x) => x.value));
  if (opts.join() !== 'Falcon') throw new Error('nicknames: ' + opts);
});

step('start timer', async ({ page }) => {
  await page.fill('#task', 'a');
  await page.click('#start');
  await page.waitForSelector('#running');
  const t = await page.textContent('#run-task');
  if (t !== 'a') throw new Error('run task: ' + t);
  const c = await page.textContent('#clock');
  if (!/^\d\d:\d\d:\d\d$/.test(c)) throw new Error('clock: ' + c);
});

step('switch to Falcon "b"', async ({ page }) => {
  await page.fill('#task', 'b');
  await page.click('#switch');
  await page.waitForFunction(() => document.getElementById('run-task')?.textContent === 'b');
  const n = await page.$$eval('#entries .entry', (r) => r.length);
  if (n !== 2) throw new Error('entries after switch: ' + n);
});

step('stop timer', async ({ page }) => {
  await page.click('#stop');
  await page.waitForSelector('#running', { state: 'detached' });
  const n = await page.$$eval('#entries .entry', (r) => r.length);
  if (n !== 2) throw new Error('entries after stop: ' + n);
});

step('quick add opens Edit prefilled, Save stores it', async ({ page }) => {
  await page.fill('#quick', 'Falcon design review 9 to 11:45');
  await page.press('#quick', 'Enter');
  await page.waitForSelector('#save');
  const v = await page.evaluate(() => ({
    nick: document.getElementById('nick').value, task: document.getElementById('task').value,
    start: document.getElementById('start').value, end: document.getElementById('end').value,
    live: document.getElementById('live').textContent,
  }));
  if (v.nick !== 'Falcon' || v.task !== 'design review' || v.start !== '09:00' || v.end !== '11:45') throw new Error('prefill: ' + JSON.stringify(v));
  if (!v.live.includes('2 h 45 m') || !v.live.includes('2.8 h')) throw new Error('live line: ' + v.live);
  await page.click('#save');
  await onToday(page);
  const total = await page.textContent('#day-total');
  if (parseFloat(total) < 2.8) throw new Error('day total: ' + total);
});

step('double-click Save on a new entry creates exactly one entry', async ({ page }) => {
  const before = await countEntries(page);
  await goto(page, '#/edit/new');
  await page.waitForSelector('#save');
  await page.fill('#start', '12:00');
  await page.fill('#end', '12:30');
  await page.fill('#task', 'double');
  await page.dblclick('#save');
  await onToday(page);
  await page.waitForTimeout(300);
  const after = await countEntries(page);
  if (after !== before + 1) throw new Error(`entries ${before} -> ${after}`);
});

step('week shows Falcon row with today >= 2.8', async ({ page }) => {
  await page.click('#nav a[data-route="week"]');
  await page.waitForSelector('#grid');
  const cell = await page.textContent(`tr[data-nick="Falcon"] td[data-date="${today()}"]`);
  if (!(parseFloat(cell) >= 2.8)) throw new Error('cell: ' + cell);
  const ls = await page.textContent('#last-sent');
  if (!/Last sent/.test(ls)) throw new Error(ls);
});

step('week arrows work; returning from another tab shows the current week', async ({ page }) => {
  const title = () => page.textContent('.week-nav h1');
  const current = await title();
  await page.click('#prev');
  await page.waitForFunction((t) => document.querySelector('.week-nav h1')?.textContent !== t, current);
  await page.click('#nav a[data-route="today"]');
  await onToday(page);
  await page.click('#nav a[data-route="week"]');
  await page.waitForSelector('#grid');
  const back = await title();
  if (back !== current) throw new Error(`expected ${current}, got ${back}`);
});

step('a screen that throws shows the error and a Reload button', async ({ page, errors }) => {
  await page.evaluate(() => {
    window.__getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function () { throw new Error('boom'); };
  });
  try {
    await goto(page, '#/week');
    await page.click('#nav a[data-route="today"]');
    await page.waitForFunction(() => /Something went wrong: boom/.test(document.getElementById('view').textContent));
    const btn = await page.textContent('#view button');
    if (btn !== 'Reload') throw new Error('button: ' + btn);
  } finally {
    await page.evaluate(() => { IDBObjectStore.prototype.getAll = window.__getAll; });
  }
  if (!errors.some((e) => /boom/.test(e))) throw new Error('error not logged');
  errors.length = 0;
  await goto(page, '#/week'); await goto(page, '#/today');
  await onToday(page);
});

step('blocked word shows warning, Save anyway saves', async ({ page }) => {
  await page.evaluate(async () => {
    const { openIdbBackend } = await import('./src/store/idb.js');
    const { createStore } = await import('./src/store/store.js');
    await createStore(await openIdbBackend()).setSetting('blockedWords', ['Orion']);
  });
  await goto(page, '#/edit/new');
  await page.waitForSelector('#save');
  await page.fill('#start', '13:00');
  await page.fill('#end', '13:30');
  await page.fill('#task', 'Orion planning');
  await page.click('#save');
  await page.waitForSelector('#warn .warn');
  const w = await page.textContent('#warn');
  if (!w.includes('Orion')) throw new Error('warning text: ' + w);
  await page.click('#warn-edit');
  const focused = await page.evaluate(() => document.activeElement.id);
  if (focused !== 'task') throw new Error('focus: ' + focused);
  await page.click('#save');
  await page.click('#save-anyway');
  await onToday(page);
  const rows = await page.$$eval('#entries .etask', (r) => r.map((x) => x.textContent));
  if (!rows.includes('Orion planning')) throw new Error('rows: ' + rows);
});

const setSetting = (page, key, value) => page.evaluate(async ([k, v]) => {
  const { openIdbBackend } = await import('./src/store/idb.js');
  const { createStore } = await import('./src/store/store.js');
  await createStore(await openIdbBackend()).setSetting(k, v);
}, [key, value]);
const countEntries = (page) => page.evaluate(async () => {
  const { openIdbBackend } = await import('./src/store/idb.js');
  return (await (await openIdbBackend()).all('entries')).length;
});
const stubShare = (page) => page.evaluate(() => {
  window.__shared = [];
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: async (d) => { window.__shared.push({ name: d.files[0].name, text: d.text, title: d.title }); },
  });
});

step('Settings page renders', async ({ page }) => {
  await goto(page, '#/settings');
  await page.waitForSelector('#work-email');
  const t = await viewText(page);
  if (!t.includes('Falcon') || !t.includes('Ori*')) throw new Error('settings text: ' + t.slice(0, 200));
});

step('Help page renders', async ({ page }) => {
  await goto(page, '#/help');
  await page.waitForFunction(() => /Add to Home Screen/.test(document.getElementById('view').textContent));
  const t = await viewText(page);
  if (!t.includes('Win+H') || !t.includes('Run Immediately')) throw new Error('help text');
});

step('send without work email is refused with a hint', async ({ page }) => {
  await goto(page, '#/today');
  await onToday(page);
  await stubShare(page);
  await page.click('#send');
  await page.waitForSelector('#send-err');
  const t = await page.textContent('#send-err');
  if (!/work email/i.test(t)) throw new Error(t);
});

step('send shares tt-DATE-0001.csv with BEGIN marker', async ({ page }) => {
  await setSetting(page, 'workEmail', 'work@example.com');
  await setSetting(page, 'blockedWords', []);
  await goto(page, '#/week'); await goto(page, '#/today');
  await onToday(page);
  await stubShare(page);
  await page.click('#send');
  await page.waitForSelector('#send-ok');
  const shared = await page.evaluate(() => window.__shared);
  if (shared.length !== 1) throw new Error('shares: ' + shared.length);
  if (!/^tt-\d{4}-\d{2}-\d{2}-0001\.csv$/.test(shared[0].name)) throw new Error('name: ' + shared[0].name);
  if (!shared[0].text.includes('BEGIN TT CSV v1')) throw new Error('body lacks marker');
});

step('send with a blocked word is refused', async ({ page }) => {
  await setSetting(page, 'blockedWords', ['Orion']);
  await goto(page, '#/week'); await goto(page, '#/today');
  await onToday(page);
  await stubShare(page);
  await page.click('#send');
  await page.waitForSelector('#send-blocked a');
  const shared = await page.evaluate(() => window.__shared.length);
  if (shared !== 0) throw new Error('shared despite block');
});

step('export, clear database, import restores entries', async ({ page }) => {
  const before = await countEntries(page);
  if (before < 3) throw new Error('entries before: ' + before);
  await goto(page, '#/settings');
  await page.waitForSelector('#export');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  if (!/^capture-backup-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename())) throw new Error('name: ' + dl.suggestedFilename());
  const path = join(tmpdir(), `capture-smoke-${Date.now()}.json`);
  await dl.saveAs(path);
  await page.waitForFunction(() => /Backup exported/.test(document.getElementById('settings-msg').textContent));
  await page.evaluate(() => new Promise((res, rej) => {
    const o = indexedDB.open('capture');
    o.onsuccess = () => {
      const db = o.result;
      const tx = db.transaction(['entries', 'nicknames', 'settings'], 'readwrite');
      for (const n of ['entries', 'nicknames', 'settings']) tx.objectStore(n).clear();
      tx.oncomplete = () => { db.close(); res(); };
      tx.onerror = () => rej(tx.error);
    };
  }));
  if ((await countEntries(page)) !== 0) throw new Error('db not cleared');
  await page.setInputFiles('#import-file', path);
  await page.waitForFunction(() => /Imported/.test(document.getElementById('settings-msg').textContent));
  const after = await countEntries(page);
  if (after !== before) throw new Error(`entries ${before} -> ${after}`);
});

async function main() {
  const pw = await loadPlaywright();
  const chromium = pw.chromium ?? pw.default.chromium;
  const devices = pw.devices ?? pw.default.devices;
  const { defaultBrowserType, ...device } = devices['iPhone 13'];
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  let failed = false;
  try {
    const ctx = await browser.newContext(device);
    const page = await ctx.newPage();
    const errors = [];
    watch(page, errors);
    await page.goto(url);
    await page.waitForSelector('#view');
    for (const s of STEPS) {
      try {
        await s.fn({ page, errors, url, ctx, browser, device });
        if (errors.length) throw new Error('console errors: ' + errors.join(' | '));
        console.log(`  ok   ${s.name}`);
      } catch (e) {
        failed = true;
        console.error(`  FAIL ${s.name}: ${e.message}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failed) process.exit(1);
  console.log('smoke ok');
}
main().catch((e) => { console.error(e); process.exit(1); });
