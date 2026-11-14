import test from 'node:test';
import assert from 'node:assert/strict';
import { dayTotals, weekGrid, homeStats } from '../app/src/core/summary.js';

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

// 2026-11-09 is a Monday; 2026-11-12 Thursday; 2026-11-13 Friday.
test('homeStats: workday shows today vs 10.0 and week vs 40.0', () => {
  const s = homeStats([
    e('Falcon', '2026-11-09', 600), e('Heron', '2026-11-12', 255), e('Falcon', '2026-11-12', 126),
  ], '2026-11-12');
  assert.deepEqual(s.day, { tenths: 64, expected: 100, dayOff: false, pct: 64, done: false });
  assert.deepEqual(s.week, { tenths: 164, expected: 400, pct: 41, done: false });
});

test('homeStats: Friday is a day off (no percentage), weekend hours still count', () => {
  const s = homeStats([e('Falcon', '2026-11-13', 60)], '2026-11-13');
  assert.deepEqual(s.day, { tenths: 10, expected: 0, dayOff: true, pct: null, done: false });
  assert.equal(s.week.tenths, 10);
});

test('homeStats: reaching the expected hours marks done', () => {
  const four = ['09', '10', '11', '12'].map((d) => e('Falcon', `2026-11-${d}`, 600));
  const s = homeStats([...four, e('Falcon', '2026-11-12', 30)], '2026-11-12');
  assert.equal(s.day.done, true);
  assert.equal(s.day.pct, 105);
  assert.deepEqual(s.week, { tenths: 405, expected: 400, pct: 101, done: true });
});

test('homeStats: running timers and deleted entries do not count', () => {
  const s = homeStats([
    e('Falcon', '2026-11-12', 0, { end: '' }), e('Falcon', '2026-11-12', 60, { deleted: true }),
  ], '2026-11-12');
  assert.equal(s.day.tenths, 0);
  assert.equal(s.week.tenths, 0);
});
