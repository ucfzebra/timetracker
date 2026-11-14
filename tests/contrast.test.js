import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/styles.css', import.meta.url), 'utf8');

function vars(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

export function themes(src) {
  const light = src.match(/^:root\s*\{([^}]*)\}/m);
  const dark = src.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/);
  assert.ok(light, 'light :root block');
  assert.ok(dark, 'dark :root block');
  return { light: vars(light[1]), dark: vars(dark[1]) };
}

function lum(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// [text, background] pairs the stylesheet actually uses for text.
const PAIRS = [
  ['ink', 'surface-100'], ['ink', 'surface-200'],
  ['ink-muted', 'surface-100'], ['ink-muted', 'surface-200'],
  ['accent-ink', 'accent'], ['steel-ink', 'steel'],
  // secondary (outline) buttons and links: steel text on the page and on cards
  ['steel', 'surface-100'], ['steel', 'surface-200'],
  // state words: banner labels, "Done", errors
  ['warning', 'surface-200'], ['success', 'surface-200'],
  ['danger', 'surface-100'], ['danger', 'surface-200'],
];

test('ratio matches known WCAG values', () => {
  assert.equal(ratio('#000000', '#ffffff').toFixed(1), '21.0');
  assert.equal(ratio('#777777', '#ffffff').toFixed(2), '4.48');
});

for (const [name, t] of Object.entries(themes(css))) {
  test(`${name} theme defines the brand tokens`, () => {
    for (const k of ['surface-100', 'surface-200', 'ink', 'ink-muted', 'border', 'accent', 'accent-ink', 'steel', 'steel-ink', 'success', 'warning', 'danger']) {
      assert.match(t[k] || '', /^#[0-9a-f]{6}$/, `--${k} in ${name}`);
    }
  });
  for (const [fg, bg] of PAIRS) {
    test(`${name}: ${fg} on ${bg} >= 4.5:1`, () => {
      const r = ratio(t[fg], t[bg]);
      assert.ok(r >= 4.5, `${fg} ${t[fg]} on ${bg} ${t[bg]} = ${r.toFixed(2)}`);
    });
  }
}
