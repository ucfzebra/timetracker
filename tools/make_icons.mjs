// Rasterize app/icons/mark.svg into the PNG app icons with the global Playwright Chromium.
// Run from the repo root: node tools/make_icons.mjs
// Icons are opaque (iOS ignores transparency): the mark sits on surface-100 (#f7f3ec).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const ICONS = fileURLToPath(new URL('../app/icons/', import.meta.url));
const root = execFileSync('npm', ['root', '-g']).toString().trim();
const { chromium } = createRequire(join(root, 'x.js'))('playwright');

const svg = readFileSync(join(ICONS, 'mark.svg'), 'utf8');
const browser = await chromium.launch();
try {
  for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    // A 6% margin keeps the plate clear of the iOS corner mask.
    const pad = Math.round(size * 0.06);
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#f7f3ec">
      <div style="width:${size}px;height:${size}px;box-sizing:border-box;padding:${pad}px">
      ${svg.replace('<svg ', '<svg style="width:100%;height:100%;display:block" ')}</div></body></html>`);
    await page.screenshot({ path: join(ICONS, name), omitBackground: false });
    await page.close();
    console.log('wrote', name);
  }
} finally {
  await browser.close();
}
