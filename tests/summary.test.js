import test from 'node:test';
import assert from 'node:assert/strict';
import { dayTotals, weekGrid } from '../app/src/core/summary.js';

const e = (nickname, date, duration_min, extra = {}) => ({
  entry_id: Math.random().toString(36).slice(2), nickname, date, start: '08:00', end: '09:00',
  duration_min, task: '', description: '', source: 'web', updated_at: '', deleted: false, ...extra,
});

test('dayTotals sums minutes per nickname then rounds', () => {
  const r = dayTotals([e('Falcon', '2026-11-13', 90), e('Falcon', '2026-11-13', 72)], '2026-11-13');
  assert.deepEqual(r, { rows: [{ nickname: 'Falcon', minutes: 162, tenths: 27 }], totalTenths: 27 });
});

test('two 4-minute entries give 1 tenth, not 2', () => {
  const r = dayTotals([e('Heron', '2026-11-13', 4), e('Heron', '2026-11-13', 4)], '2026-11-13');
  assert.equal(r.rows[0].tenths, 1);
  assert.equal(r.totalTenths, 1);
});

test('dayTotals total is sum of rounded rows; ignores deleted, running, other dates', () => {
  const r = dayTotals([
    e('A', '2026-11-13', 4), e('B', '2026-11-13', 4),
    e('A', '2026-11-13', 60, { deleted: true }),
    e('A', '2026-11-13', 0, { end: '' }),
    e('A', '2026-11-12', 60),
  ], '2026-11-13');
  assert.equal(r.totalTenths, 2);
  assert.deepEqual(r.rows.map(x => x.nickname), ['A', 'B']);
});

test('weekGrid for 2026-11-13', () => {
  const g = weekGrid([
    e('Falcon', '2026-11-09', 60), e('Falcon', '2026-11-13', 30),
    e('Heron', '2026-11-10', 120), e('Heron', '2026-11-16', 600),
    e('Ghost', '2026-11-11', 60, { deleted: true }),
  ], '2026-11-13');
  assert.equal(g.days[0], '2026-11-09');
  assert.equal(g.days[6], '2026-11-15');
  assert.equal(g.expected, 400);
  assert.deepEqual(g.expectedPerDay, [100, 100, 100, 100, 0, 0, 0]);
  assert.deepEqual(g.rows.map(r => r.nickname), ['Heron', 'Falcon']);
  assert.deepEqual(g.rows[0].perDay, [0, 20, 0, 0, 0, 0, 0]);
  assert.deepEqual(g.rows[1].perDay, [10, 0, 0, 0, 5, 0, 0]);
  assert.deepEqual(g.rows.map(r => r.total), [20, 15]);
  assert.deepEqual(g.dayTotals, [10, 20, 0, 0, 5, 0, 0]);
  assert.equal(g.total, 35);
});

test('weekGrid ties sort by name', () => {
  const g = weekGrid([e('B', '2026-11-09', 60), e('A', '2026-11-09', 60)], '2026-11-09');
  assert.deepEqual(g.rows.map(r => r.nickname), ['A', 'B']);
});
