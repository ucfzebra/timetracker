// Browser smoke test. Steps are named; later tasks append to STEPS.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

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

step('no console errors on load', async ({ errors, page }) => {
  await page.waitForTimeout(500);
  if (errors.length) throw new Error(errors.join('\n'));
});

step('unbuilt screen shows placeholder', async ({ page }) => {
  // Remove once Tasks 8-9 add ui/*.js; harmless if the screen exists.
  await page.waitForFunction(() => document.getElementById('view').textContent.trim().length > 0);
});

step('service worker registered', async ({ page }) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
});

step('loads offline from cache', async ({ page, ctx, url }) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the SW
  await page.waitForTimeout(300);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('view').textContent.trim().length > 0);
  await ctx.setOffline(false);
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

async function main() {
  const { chromium } = await loadPlaywright();
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  let failed = false;
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      // Screens not built yet 404 on dynamic import; the app handles that.
      if (/Failed to load resource.*404/.test(m.text()) && /src\/ui\//.test(m.location().url || '')) return;
      errors.push(m.text());
    });
    await page.goto(url);
    await page.waitForSelector('#view');
    for (const s of STEPS) {
      try {
        await s.fn({ page, errors, url, ctx });
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
