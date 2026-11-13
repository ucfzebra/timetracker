import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPatch } from '../app/src/core/patch.js';

const long = { nickname: 'Falcon', date: '2026-11-10', start: '09:00', end: '15:00', duration_min: 1800, task: 'T', description: 'd' };
const form = { nickname: 'Falcon', date: '2026-11-10', mode: 'range', start: '09:00', end: '15:00', duration_min: null, task: 'T', description: 'd' };

test('30 h entry, only description changed: no start/end/duration_min', () => {
  assert.deepEqual(buildPatch(long, { ...form, description: 'new' }), { description: 'new' });
});
test('changing end yields only end', () => {
  assert.deepEqual(buildPatch(long, { ...form, end: '16:00' }), { end: '16:00' });
});
test('duration mode: sets duration and clears times', () => {
  assert.deepEqual(buildPatch(long, { ...form, mode: 'dur', duration_min: 45 }), { start: '', end: '', duration_min: 45 });
});
test('duration entry unchanged yields empty patch', () => {
  const d = { ...long, start: '', end: '', duration_min: 45 };
  assert.deepEqual(buildPatch(d, { ...form, mode: 'dur', start: '', end: '', duration_min: 45 }), {});
});
