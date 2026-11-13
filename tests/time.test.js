import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHHMM, formatHHMM, durationMinutes, toTenths, formatTenths, localDate, addDays, weekStart } from '../app/src/core/time.js';
import { uuid, nowIso } from '../app/src/core/ids.js';

const table = [[0,0],[2,0],[3,1],[8,1],[9,2],[54,9],[72,12],[162,27],[165,28],[480,80],[600,100]];
for (const [m,t] of table) test(`tenths ${m}`, () => assert.equal(toTenths(m), t));
test('format', () => { assert.equal(formatTenths(27),'2.7'); assert.equal(formatTenths(100),'10.0'); assert.equal(formatTenths(0),'0.0'); });
test('duration', () => assert.equal(durationMinutes('09:00','11:45'), 165));
test('midnight', () => assert.equal(durationMinutes('22:30','01:15'), 165));
test('equal times', () => assert.equal(durationMinutes('09:00','09:00'), 0));
test('bad', () => assert.equal(parseHHMM('25:00'), null));
test('parse/format', () => {
  assert.equal(parseHHMM('09:00'), 540);
  assert.equal(parseHHMM('9:00'), null);
  assert.equal(parseHHMM('12:60'), null);
  assert.equal(parseHHMM(null), null);
  assert.equal(formatHHMM(540), '09:00');
  assert.equal(formatHHMM(1439), '23:59');
});
test('weekStart', () => { assert.equal(weekStart('2026-11-13'),'2026-11-09'); assert.equal(weekStart('2026-11-09'),'2026-11-09'); assert.equal(weekStart('2026-11-15'),'2026-11-09'); });
test('addDays across month', () => assert.equal(addDays('2026-10-31', 1), '2026-11-01'));
test('addDays negative', () => assert.equal(addDays('2026-03-01', -1), '2026-02-28'));
test('localDate', () => assert.equal(localDate(new Date(2026, 10, 3, 23, 59)), '2026-11-03'));
test('ids', () => {
  assert.match(uuid(), /^[0-9a-f-]{36}$/);
  assert.ok(!Number.isNaN(Date.parse(nowIso())));
});
