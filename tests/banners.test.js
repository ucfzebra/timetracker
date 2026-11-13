import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayBanners } from '../app/src/core/banners.js';

const d = (day, h, m = 0) => new Date(2026, 10, day, h, m); // Nov 2026: 9 Mon, 11 Wed, 12 Thu, 13 Fri, 15 Sun, 16 Mon
const entry = (date, updated_at) => ({ entry_id: 'x' + updated_at, date, updated_at, deleted: false });
const kinds = (a) => a.map((b) => b.kind);
const base = { lastSentAt: null, weekAckFor: null, entries: [], stale: null, lastBackupAt: '2026-11-10T12:00:00.000Z' };

test('no banners on a quiet Wednesday morning', () => {
  assert.deepEqual(todayBanners({ ...base, now: d(11, 9) }), []);
});

test('Wed 16:00: no unsent banner even with an unsent entry', () => {
  const entries = [entry('2026-11-11', '2026-11-11T20:00:00.000Z')];
  assert.deepEqual(kinds(todayBanners({ ...base, now: d(11, 16, 0), entries })), []);
});

test('Wed 17:00 with an unsent entry: unsent banner with count', () => {
  const entries = [entry('2026-11-11', '2026-11-11T20:00:00.000Z'), entry('2026-11-11', '2026-11-11T20:05:00.000Z')];
  const b = todayBanners({ ...base, now: d(11, 17), entries });
  assert.deepEqual(kinds(b), ['unsent']);
  assert.equal(b[0].count, 2);
  assert.equal(b[0].text, '2 entries not sent');
});

test('unsent uses lastSentAt; entries older than it do not count', () => {
  const entries = [entry('2026-11-11', '2026-11-11T20:00:00.000Z'), entry('2026-11-11', '2026-11-11T22:00:00.000Z')];
  const b = todayBanners({ ...base, now: d(11, 17), entries, lastSentAt: '2026-11-11T21:00:00.000Z' });
  assert.equal(b[0].count, 1);
  assert.equal(b[0].text, '1 entry not sent');
  assert.deepEqual(todayBanners({ ...base, now: d(11, 17), entries, lastSentAt: '2026-11-11T23:00:00.000Z' }), []);
});

test('lastSentAt unset: only entries dated today count', () => {
  const entries = [entry('2026-11-10', '2026-11-10T20:00:00.000Z')];
  assert.deepEqual(todayBanners({ ...base, now: d(11, 17), entries }), []);
});

test('Thu 17:00: week banner (and unsent applies Mon-Thu)', () => {
  const entries = [entry('2026-11-12', '2026-11-12T20:00:00.000Z')];
  const b = todayBanners({ ...base, now: d(12, 17), entries });
  assert.deepEqual(kinds(b), ['unsent', 'week']);
  assert.equal(b[1].text, 'Submit your week timecard');
});

test('Thu 16:00: no week banner yet', () => {
  assert.deepEqual(todayBanners({ ...base, now: d(12, 16) }), []);
});

test('Fri 09:00 and Sun: week banner, no unsent banner', () => {
  const entries = [entry('2026-11-13', '2026-11-13T20:00:00.000Z')];
  assert.deepEqual(kinds(todayBanners({ ...base, now: d(13, 9), entries })), ['week']);
  assert.deepEqual(kinds(todayBanners({ ...base, now: d(15, 12), entries })), ['week']);
});

test('Sun with weekAckFor = that week Monday: no week banner', () => {
  assert.deepEqual(todayBanners({ ...base, now: d(15, 12), weekAckFor: '2026-11-09' }), []);
});

test('Mon after ack of previous week: no week banner', () => {
  assert.deepEqual(todayBanners({ ...base, now: d(16, 17), weekAckFor: '2026-11-09' }), []);
});

test('stale timer banner comes first', () => {
  const stale = { entry: { entry_id: 's', nickname: 'Falcon' }, hours: 12.7 };
  const b = todayBanners({ ...base, now: d(11, 9), stale });
  assert.deepEqual(kinds(b), ['stale']);
  assert.equal(b[0].text, 'Timer running 12 h on Falcon. Set end time?');
  assert.equal(b[0].entryId, 's');
});

test('backup banner: entries exist and lastBackupAt missing', () => {
  const entries = [entry('2026-11-11', '2026-11-11T20:00:00.000Z')];
  assert.deepEqual(kinds(todayBanners({ ...base, now: d(11, 9), entries, lastBackupAt: null })), ['backup']);
});

test('backup banner: older than 7 days shows, recent does not, no entries none', () => {
  const entries = [entry('2026-11-11', '2026-11-11T20:00:00.000Z')];
  const old = new Date(2026, 10, 3, 8).toISOString();
  const recent = new Date(2026, 10, 6, 8).toISOString();
  assert.deepEqual(kinds(todayBanners({ ...base, now: d(11, 9), entries, lastBackupAt: old })), ['backup']);
  assert.deepEqual(kinds(todayBanners({ ...base, now: d(11, 9), entries, lastBackupAt: recent })), []);
  assert.deepEqual(kinds(todayBanners({ ...base, now: d(11, 9), lastBackupAt: null })), []);
});
