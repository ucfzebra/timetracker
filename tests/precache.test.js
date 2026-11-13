import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('../app/', import.meta.url));
const sw = readFileSync(join(APP, 'sw.js'), 'utf8');
const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

function reachable(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const src = readFileSync(entry, 'utf8');
  for (const m of src.matchAll(/^\s*(?:import|export)\b[^'"\n;]*?from\s+['"]([^'"]+)['"]/gm)) {
    if (m[1].startsWith('.')) reachable(join(dirname(entry), m[1]), seen);
  }
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
  for (const abs of reachable(join(APP, 'src/app.js'))) {
    const rel = relative(APP, abs);
    assert.ok(listed.has(rel), `not precached: ${rel}`);
  }
});
