import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../app/src/store/store.js';
import { createMemoryBackend } from '../app/src/store/memory.js';

function setup(start = new Date(2026, 10, 10, 9, 0, 0)) {
  let t = start.getTime();
  const clock = { set: (d) => { t = d.getTime(); }, adv: (min) => { t += min * 60000; } };
  const store = createStore(createMemoryBackend(), { now: () => new Date(t), source: 'phone' });
  return { store, clock };
}
const base = { nickname: 'Falcon', date: '2026-11-10', start: '09:00', end: '10:30', task: 'Review', description: 'x' };

test('switchTimer ends the first and only one runs', async () => {
  const { store, clock } = setup();
  const a = await store.startTimer('Falcon', 'a', '');
  clock.adv(30);
  const b = await store.switchTimer('Hawk', 'b', '');
  const all = await store.entriesBetween('2026-01-01', '2026-12-31');
  const first = all.find((e) => e.entry_id === a.entry_id);
  assert.equal(first.end, '09:30');
  assert.equal(first.duration_min, 30);
  assert.equal((await store.running()).entry_id, b.entry_id);
  assert.equal(all.filter((e) => e.start && !e.end).length, 1);
});

test('timer across midnight: 75 min, date is start date', async () => {
  const { store, clock } = setup(new Date(2026, 10, 10, 23, 30, 0));
  await store.startTimer('Falcon', '', '');
  clock.set(new Date(2026, 10, 11, 0, 45, 0));
  const e = await store.stopTimer();
  assert.equal(e.duration_min, 75);
  assert.equal(e.date, '2026-11-10');
  assert.equal(e.end, '00:45');
  assert.equal(await store.running(), null);
});

test('timer running 30 h records actual elapsed 1800', async () => {
  const { store, clock } = setup();
  await store.startTimer('Falcon', '', '');
  clock.adv(1800);
  assert.equal((await store.stopTimer()).duration_min, 1800);
});

test('staleTimer after 11 h', async () => {
  const { store, clock } = setup();
  assert.equal(await store.staleTimer(), null);
  await store.startTimer('Falcon', '', '');
  clock.adv(11 * 60);
  assert.ok((await store.staleTimer()).hours >= 10);
});

test('updateEntry bumps updated_at even with a frozen clock; delete tombstones', async () => {
  const { store } = setup();
  const e = await store.addEntry(base);
  assert.equal(e.duration_min, 90);
  assert.equal(e.source, 'phone');
  const u = await store.updateEntry(e.entry_id, { end: '11:00' });
  assert.equal(u.duration_min, 120);
  assert.ok(u.updated_at > e.updated_at);
  const d = await store.deleteEntry(e.entry_id);
  assert.ok(d.updated_at > u.updated_at);
  assert.equal((await store.entriesBetween('2026-11-10', '2026-11-10')).length, 0);
  const all = await store.entriesBetween('2026-11-10', '2026-11-10', { includeDeleted: true });
  assert.equal(all.length, 1);
  assert.equal(all[0].deleted, true);
});

test('renameNickname keeps entries, swaps active names', async () => {
  const { store } = setup();
  await store.addNickname('Falcon');
  await store.addNickname('Owl');
  await store.addEntry(base);
  await store.renameNickname('Falcon', 'Hawk');
  assert.deepEqual(await store.nicknames(), ['Hawk', 'Owl']);
  const [e] = await store.entriesBetween('2026-11-10', '2026-11-10');
  assert.equal(e.nickname, 'Falcon');
  await assert.rejects(() => store.addNickname('hawk'));
});

test('validation', async () => {
  const { store } = setup();
  await assert.rejects(() => store.addEntry({ ...base, task: 'x'.repeat(61) }), RangeError);
  await assert.rejects(() => store.addEntry({ ...base, nickname: '  ' }), RangeError);
  await assert.rejects(() => store.addEntry({ ...base, nickname: 'n'.repeat(25) }), RangeError);
  await assert.rejects(() => store.addEntry({ ...base, description: 'd'.repeat(201) }), RangeError);
  await assert.rejects(() => store.addEntry({ ...base, start: '', end: '', duration_min: -1 }), RangeError);
  const e = await store.addEntry({ ...base, start: '', end: '', duration_min: 45 });
  assert.equal(e.duration_min, 45);
});

test('recentTasks, entriesBetween order, settings', async () => {
  const { store, clock } = setup();
  await store.addEntry({ ...base, task: 'A' });
  clock.adv(1);
  await store.addEntry({ ...base, task: 'B', date: '2026-11-09' });
  clock.adv(1);
  await store.addEntry({ ...base, task: 'A', start: '08:00', end: '08:30' });
  assert.deepEqual(await store.recentTasks('Falcon'), ['A', 'B']);
  assert.deepEqual(await store.recentTasks('Falcon', 1), ['A']);
  const list = await store.entriesBetween('2026-11-09', '2026-11-10');
  assert.deepEqual(list.map((e) => e.date + e.start), ['2026-11-0909:00', '2026-11-1008:00', '2026-11-1009:00']);
  assert.equal(await store.getSetting('windowDays'), 14);
  assert.equal(await store.getSetting('batch'), 0);
  await store.setSetting('windowDays', 7);
  assert.equal(await store.getSetting('windowDays'), 7);
});

test('editing description of a stopped 30 h entry keeps duration_min', async () => {
  const { store, clock } = setup();
  await store.startTimer('Falcon', '', '');
  clock.adv(1800);
  const stopped = await store.stopTimer();
  assert.equal(stopped.duration_min, 1800);
  const u = await store.updateEntry(stopped.entry_id, { description: 'edited' });
  assert.equal(u.duration_min, 1800);
  const v = await store.updateEntry(stopped.entry_id, { end: '10:00' });
  assert.equal(v.duration_min, 60);
});

test('getEntry returns the entry or null', async () => {
  const { store } = setup();
  const e = await store.addEntry(base);
  assert.equal((await store.getEntry(e.entry_id)).task, 'Review');
  assert.equal(await store.getEntry('nope'), null);
});
