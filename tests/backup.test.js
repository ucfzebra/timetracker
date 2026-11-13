import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeBackup, makeBackup } from '../app/src/core/backup.js';

const E = (id, updated_at, extra = {}) => ({ entry_id: id, nickname: 'Falcon', date: '2026-11-10', start: '', end: '', duration_min: 0, task: '', description: '', updated_at, deleted: false, ...extra });
const inc = (o = {}) => ({ format: 'capture-backup', version: 1, exportedAt: 'x', entries: [], nicknames: [], settings: {}, ...o });
const local = (o = {}) => ({ entries: [], nicknames: [], settings: {}, ...o });

test('makeBackup shape', () => {
  const b = makeBackup({ entries: [E('a', '2026-11-10T10:00:00.000Z')], nicknames: [], settings: {} }, '2026-11-13T00:00:00.000Z');
  assert.equal(b.format, 'capture-backup');
  assert.equal(b.version, 1);
  assert.equal(b.exportedAt, '2026-11-13T00:00:00.000Z');
});

test('rejects bad format or version', () => {
  assert.throws(() => mergeBackup(local(), { format: 'nope', version: 1 }), /not a Capture backup/);
  assert.throws(() => mergeBackup(local(), inc({ version: 2 })), /version/);
  assert.throws(() => mergeBackup(local(), null), /not a Capture backup/);
  assert.throws(() => mergeBackup(local(), inc({ entries: 'x' })), /not a Capture backup/);
});

test('newer incoming wins, older ignored, new added', () => {
  const l = local({ entries: [E('a', '2026-11-10T10:00:00.000Z', { task: 'old' }), E('b', '2026-11-10T12:00:00.000Z', { task: 'keep' })] });
  const r = mergeBackup(l, inc({ entries: [
    E('a', '2026-11-10T11:00:00.000Z', { task: 'new' }),
    E('b', '2026-11-10T11:00:00.000Z', { task: 'older' }),
    E('c', '2026-11-10T09:00:00.000Z'),
  ] }));
  assert.deepEqual(r.entries.map((e) => e.entry_id).sort(), ['a', 'c']);
  assert.equal(r.entries.find((e) => e.entry_id === 'a').task, 'new');
});

test("tombstone '1', 1, true normalized to boolean true; others false", () => {
  const r = mergeBackup(local(), inc({ entries: [
    E('a', '2026-11-10T10:00:00.000Z', { deleted: '1' }), E('b', '2026-11-10T10:00:00.000Z', { deleted: 1 }), E('c', '2026-11-10T10:00:00.000Z', { deleted: true }),
    E('d', '2026-11-10T10:00:00.000Z', { deleted: '0' }), E('e', '2026-11-10T10:00:00.000Z', { deleted: 0 }),
  ] }));
  const by = Object.fromEntries(r.entries.map((e) => [e.entry_id, e.deleted]));
  assert.deepEqual(by, { a: true, b: true, c: true, d: false, e: false });
});

test('nicknames: added, active if either active, order kept', () => {
  const l = local({ nicknames: [{ name: 'Falcon', active: false, sort_order: 0 }, { name: 'Heron', active: true, sort_order: 1 }] });
  const r = mergeBackup(l, inc({ nicknames: [
    { name: 'Falcon', active: true, sort_order: 0 },
    { name: 'Heron', active: false, sort_order: 1 },
    { name: 'Admin', active: true, sort_order: 2 },
  ] }));
  const by = Object.fromEntries(r.nicknames.map((n) => [n.name, n]));
  assert.equal(by.Falcon.active, true);
  assert.equal(by.Heron, undefined); // unchanged locally, nothing to write
  assert.equal(by.Admin.active, true);
  assert.equal(by.Admin.sort_order, 2);
});

test('settings: only whitelisted keys, only when absent; batch never imported', () => {
  const l = local({ settings: { workEmail: 'me@work' } });
  const r = mergeBackup(l, inc({ settings: {
    workEmail: 'other@work', blockedWords: ['Ori*'], strictGuard: true, windowDays: 10, batch: 99, lastSentAt: 'z',
  } }));
  assert.deepEqual(r.settings, { blockedWords: ['Ori*'], strictGuard: true, windowDays: 10 });
});

const good = (o = {}) => E('g', '2026-11-10T10:00:00.000Z', { start: '09:00', end: '10:00', duration_min: 60, task: 't', description: '', ...o });

test('bad entry rows are skipped and counted', () => {
  const bad = [
    good({ entry_id: '' }), good({ date: undefined }), good({ date: '11/10/2026' }), good({ task: 5 }),
    good({ description: 'x'.repeat(201) }), good({ task: 'x'.repeat(61) }), good({ nickname: 'x'.repeat(25) }),
    good({ nickname: '' }), good({ start: '9am' }), good({ end: 7 }), good({ duration_min: 'abc' }),
    good({ duration_min: -1 }), good({ duration_min: 1.5 }), good({ updated_at: 'yesterday' }), good({ updated_at: undefined }),
    null,
  ];
  const r = mergeBackup(local(), inc({ entries: [...bad, good()] }));
  assert.equal(r.entries.length, 1);
  assert.equal(r.skipped, bad.length);
});

test('bad settings are skipped, good ones kept', () => {
  const r = mergeBackup(local(), inc({ settings: { blockedWords: 'x', windowDays: 'abc', workEmail: { a: 1 }, strictGuard: 'yes' } }));
  assert.deepEqual(r.settings, {});
  assert.equal(r.skipped, 4);
  for (const workEmail of ['a b@c.d', 'a@b.c?x=1', 'a@b.c&d', 'nope']) {
    assert.equal(mergeBackup(local(), inc({ settings: { workEmail } })).skipped, 1, workEmail);
  }
  for (const windowDays of [6, 32, 10.5]) assert.equal(mergeBackup(local(), inc({ settings: { windowDays } })).skipped, 1);
  assert.equal(mergeBackup(local(), inc({ settings: { blockedWords: ['a', 1] } })).skipped, 1);
  const ok = mergeBackup(local(), inc({ settings: { workEmail: 'me@work.example', windowDays: 7, blockedWords: [], strictGuard: false } }));
  assert.equal(ok.skipped, 0);
  assert.equal(Object.keys(ok.settings).length, 4);
});

test('null task/description and missing/null start/end import as empty strings', () => {
  const raw = good({ task: null, description: null });
  delete raw.start; raw.end = null;
  const r = mergeBackup(local(), inc({ entries: [raw] }));
  assert.equal(r.skipped, 0);
  const e = r.entries[0];
  assert.deepEqual([e.task, e.description, e.start, e.end], ['', '', '', '']);
});

test('unknown fields are not stored; entry has exactly the contract fields', () => {
  const r = mergeBackup(local(), inc({ entries: [good({ evil: 'x', __proto_x: 1 })] }));
  assert.deepEqual(Object.keys(r.entries[0]).sort(), [
    'date', 'deleted', 'description', 'duration_min', 'end', 'entry_id', 'nickname', 'source', 'start', 'task', 'updated_at']);
});

test('numeric task or description is skipped', () => {
  const r = mergeBackup(local(), inc({ entries: [good({ task: 5 }), good({ description: 7 })] }));
  assert.equal(r.entries.length, 0);
  assert.equal(r.skipped, 2);
});

test('mixed-precision timestamps: truly newer row wins', () => {
  const l = local({ entries: [good({ updated_at: '2026-11-10T10:00:00.500Z', task: 'local' })] });
  // ...00Z is older than ...00.500Z though it sorts after as a string
  assert.equal(mergeBackup(l, inc({ entries: [good({ updated_at: '2026-11-10T10:00:00Z', task: 'older' })] })).entries.length, 0);
  const l2 = local({ entries: [good({ updated_at: '2026-11-10T10:00:00Z', task: 'local' })] });
  assert.equal(mergeBackup(l2, inc({ entries: [good({ updated_at: '2026-11-10T10:00:00.500Z', task: 'newer' })] })).entries[0].task, 'newer');
});
