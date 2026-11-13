import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('../app/', import.meta.url));
const sw = readFileSync(join(APP, 'sw.js'), 'utf8');
const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

function reachable(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const src = readFileSync(entry, 'utf8');
  const specs = [
    // import/export ... from '...' (also multi-line), then side-effect imports
    ...[...src.matchAll(/^\s*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]),
    ...[...src.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]),
  ];
  for (const s of specs) if (s.startsWith('.')) reachable(join(dirname(entry), s), seen);
  return seen;
}

test('every listed precache file exists', () => {
  for (const f of shell) {
    if (f === './') continue;
    assert.ok(existsSync(join(APP, f)), `missing: ${f}`);
  }
});

test('every module statically reachable from app.js is precached', () => {
  const listed = new Set(shell);
  const roots = [join(APP, 'src/app.js')];
  const app = readFileSync(roots[0], 'utf8');
  // Screens are loaded by dynamic import via the ROUTES table, so walk those targets too.
  const routes = app.match(/const ROUTES = \{([\s\S]*?)\};/)[1];
  for (const m of routes.matchAll(/'(\.[^']+)'/g)) roots.push(join(APP, 'src', m[1]));
  const seen = new Set();
  for (const r of roots) {
    assert.ok(existsSync(r), `ROUTES target missing: ${relative(APP, r)}`);
    reachable(r, seen);
  }
  for (const abs of seen) {
    const rel = relative(APP, abs);
    assert.ok(listed.has(rel), `not precached: ${rel}`);
  }
  assert.ok(seen.size > roots.length, 'walked imports');
});

test('multi-line and side-effect imports are followed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pc-'));
  writeFileSync(join(dir, 'a.js'), "import {\n  x,\n  y\n} from './b.js';\nimport './c.js';\n");
  writeFileSync(join(dir, 'b.js'), 'export const x = 1, y = 2;\n');
  writeFileSync(join(dir, 'c.js'), '\n');
  const got = [...reachable(join(dir, 'a.js'))].map((f) => relative(dir, f)).sort();
  assert.deepEqual(got, ['a.js', 'b.js', 'c.js']);
});
