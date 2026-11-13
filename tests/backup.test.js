import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeBackup, makeBackup } from '../app/src/core/backup.js';

const E = (id, updated_at, extra = {}) => ({ entry_id: id, nickname: 'Falcon', date: '2026-11-10', updated_at, deleted: false, ...extra });
const inc = (o = {}) => ({ format: 'capture-backup', version: 1, exportedAt: 'x', entries: [], nicknames: [], settings: {}, ...o });
const local = (o = {}) => ({ entries: [], nicknames: [], settings: {}, ...o });

test('makeBackup shape', () => {
  const b = makeBackup({ entries: [E('a', '1')], nicknames: [], settings: {} }, '2026-11-13T00:00:00.000Z');
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
    E('a', '1', { deleted: '1' }), E('b', '1', { deleted: 1 }), E('c', '1', { deleted: true }),
    E('d', '1', { deleted: '0' }), E('e', '1', { deleted: 0 }),
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
