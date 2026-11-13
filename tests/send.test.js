import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareBatch, sendBatch, loadSendInput, prepareSend, deliver, mailtoUrl } from '../app/src/send.js';
import { createStore } from '../app/src/store/store.js';
import { createMemoryBackend } from '../app/src/store/memory.js';

const E = (id, date, extra = {}) => ({
  entry_id: id, nickname: 'Falcon', date, start: '09:00', end: '10:00', duration_min: 60,
  task: 't', description: '', source: 'web', updated_at: '2026-11-13T10:00:00.000Z', deleted: false, ...extra,
});
const settings = { workEmail: 'w@work.example', blockedWords: [], windowDays: 14, batch: 0 };
const args = { today: '2026-11-13', generatedAt: '2026-11-13T12:00:00.000Z' };

test('clean entries: ok, batch incremented, email built', () => {
  const r = prepareBatch({ entries: [E('a', '2026-11-13')], settings: { ...settings, batch: 4 }, ...args });
  assert.equal(r.ok, true);
  assert.equal(r.batch, 5);
  assert.equal(r.email.filename, 'tt-2026-11-13-0005.csv');
  assert.equal(r.email.to, 'w@work.example');
  assert.match(r.email.subject, /^\[TT\] 2026-11-13 batch 0005 \(1 entries\)$/);
  assert.ok(r.email.body.includes('-----BEGIN TT CSV v1-----'));
});

test('window bounds: today-13 included, today-14 and future excluded; tombstones included', () => {
  const entries = [
    E('in1', '2026-10-31'), E('out', '2026-10-30'), E('fut', '2026-11-14'),
    E('tomb', '2026-11-01', { deleted: true }),
  ];
  const r = prepareBatch({ entries, settings, ...args });
  assert.equal(r.ok, true);
  assert.ok(r.email.csv.includes('in1') && r.email.csv.includes('tomb'));
  assert.ok(!r.email.csv.includes('out') && !r.email.csv.includes('fut'));
});

test('blocked word in task or description blocks; tombstones and out-of-window ignored', () => {
  const s = { ...settings, blockedWords: ['Ori*'] };
  const bad1 = E('b1', '2026-11-12', { task: 'Orion review' });
  const bad2 = E('b2', '2026-11-12', { description: 'about Orion' });
  const r = prepareBatch({ entries: [bad1, bad2, E('ok', '2026-11-12')], settings: s, ...args });
  assert.equal(r.ok, false);
  assert.deepEqual(r.blocked.map((e) => e.entry_id), ['b1', 'b2']);
  const r2 = prepareBatch({
    entries: [E('t', '2026-11-12', { task: 'Orion', deleted: true }), E('old', '2026-01-01', { task: 'Orion' })],
    settings: s, ...args,
  });
  assert.equal(r2.ok, true);
});

test('tombstone with blocked word is sent with blank task and description', () => {
  const s = { ...settings, blockedWords: ['Orion'] };
  const t = E('tomb', '2026-11-12', { deleted: true, task: 'Orion secret', description: 'Orion note' });
  const r = prepareBatch({ entries: [t], settings: s, ...args });
  assert.equal(r.ok, true);
  assert.ok(!r.email.csv.includes('Orion'));
  assert.ok(!r.email.body.includes('Orion'));
  assert.ok(r.email.csv.includes('tomb'));
});

function mk() {
  const store = createStore(createMemoryBackend(), { now: () => new Date(2026, 10, 13, 12, 0, 0) });
  return store;
}
const now = new Date(2026, 10, 13, 12, 0, 0);

test('sendBatch: no email', async () => {
  const store = mk();
  const r = await sendBatch(store, { today: '2026-11-13', now });
  assert.deepEqual(r, { ok: false, reason: 'no-email' });
});

test('sendBatch via share persists batch and lastSentAt after resolve', async () => {
  const store = mk();
  await store.setSetting('workEmail', 'w@work.example');
  await store.addEntry({ nickname: 'Falcon', date: '2026-11-13', start: '09:00', end: '10:00', task: 'x' });
  const shared = [];
  const nav = { canShare: () => true, share: async (d) => { shared.push(d); } };
  const r = await sendBatch(store, { today: '2026-11-13', now, nav, method: 'share' });
  assert.equal(r.ok, true);
  assert.equal(r.method, 'share');
  assert.equal(r.count, 1);
  assert.match(shared[0].files[0].name, /^tt-2026-11-13-0001\.csv$/);
  assert.equal(await store.getSetting('batch'), 1);
  assert.equal(await store.getSetting('lastSentAt'), now.toISOString());
});

test('sendBatch: AbortError cancels, nothing persisted', async () => {
  const store = mk();
  await store.setSetting('workEmail', 'w@work.example');
  await store.addEntry({ nickname: 'Falcon', date: '2026-11-13', start: '09:00', end: '10:00', task: 'x' });
  const nav = { canShare: () => true, share: async () => { throw Object.assign(new Error('c'), { name: 'AbortError' }); } };
  const r = await sendBatch(store, { today: '2026-11-13', now, nav, method: 'share' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'cancelled');
  assert.equal(await store.getSetting('batch'), 0);
  assert.equal(await store.getSetting('lastSentAt'), null);
});

test('sendBatch: mailto fallback opens link and persists', async () => {
  const store = mk();
  await store.setSetting('workEmail', 'w@work.example');
  await store.addEntry({ nickname: 'Falcon', date: '2026-11-13', start: '09:00', end: '10:00', task: 'x' });
  const opened = [];
  const r = await sendBatch(store, { today: '2026-11-13', now, nav: {}, open: (u) => opened.push(u) });
  assert.equal(r.method, 'mailto');
  assert.ok(opened[0].startsWith('mailto:w%40work.example?subject=%5BTT%5D'));
  assert.equal(await store.getSetting('batch'), 1);
});

test('sendBatch: blocked sends nothing', async () => {
  const store = mk();
  await store.setSetting('workEmail', 'w@work.example');
  await store.setSetting('blockedWords', ['Orion']);
  await store.addEntry({ nickname: 'Falcon', date: '2026-11-13', start: '09:00', end: '10:00', task: 'Orion' });
  let called = false;
  const r = await sendBatch(store, { today: '2026-11-13', now, method: 'share', open: () => { called = true; }, nav: { canShare: () => true, share: async () => { called = true; } } });
  assert.equal(r.ok, false);
  assert.equal(r.blocked.length, 1);
  assert.equal(called, false);
  assert.equal(await store.getSetting('batch'), 0);
});

async function ready(extra = {}) {
  const store = mk();
  await store.setSetting('workEmail', 'w+x@work.example');
  await store.addEntry({ nickname: 'Falcon', date: '2026-11-13', start: '09:00', end: '10:00', task: 'x' });
  for (const [k, v] of Object.entries(extra)) await store.setSetting(k, v);
  return store;
}

test('default send is mailto even when share is available; address and subject encoded', async () => {
  const store = await ready();
  const opened = [];
  let shared = false;
  const nav = { canShare: () => true, share: async () => { shared = true; } };
  const r = await sendBatch(store, { today: '2026-11-13', now, nav, open: (u) => opened.push(u) });
  assert.equal(r.method, 'mailto');
  assert.equal(shared, false);
  assert.ok(opened[0].startsWith('mailto:' + encodeURIComponent('w+x@work.example') + '?subject=%5BTT%5D%202026-11-13%20batch%200001'));
  const body = decodeURIComponent(opened[0].split('&body=')[1]);
  assert.ok(body.includes('-----BEGIN TT CSV v1-----') && body.includes('-----END TT CSV v1-----'));
  assert.ok(body.includes('entry_id,nickname,date'));
  assert.equal(await store.getSetting('batch'), 1);
  assert.equal(await store.getSetting('lastSentAt'), now.toISOString());
});

test('mailtoUrl encodes the address', () => {
  assert.equal(mailtoUrl('a&b@c.d', { subject: 's', body: 'b' }), 'mailto:a%26b%40c.d?subject=s&body=b');
});

test('share: NotAllowedError falls back to mailto and persists', async () => {
  const store = await ready();
  const opened = [];
  const nav = { canShare: () => true, share: async () => { throw Object.assign(new Error('n'), { name: 'NotAllowedError' }); } };
  const r = await sendBatch(store, { today: '2026-11-13', now, nav, method: 'share', open: (u) => opened.push(u) });
  assert.equal(r.ok, true);
  assert.equal(r.method, 'mailto');
  assert.equal(opened.length, 1);
  assert.equal(await store.getSetting('batch'), 1);
});

test('share without file-share support uses mailto', async () => {
  const store = await ready();
  const opened = [];
  const r = await sendBatch(store, { today: '2026-11-13', now, nav: { canShare: () => false, share: async () => {} }, method: 'share', open: (u) => opened.push(u) });
  assert.equal(r.method, 'mailto');
  assert.equal(opened.length, 1);
});

test('prepared send calls navigator.share synchronously (keeps user activation)', async () => {
  const store = await ready();
  const input = await loadSendInput(store);
  const prep = prepareSend(input, { today: '2026-11-13', now });
  assert.equal(prep.ok, true);
  const calls = [];
  const nav = { canShare: () => true, share: async (d) => { calls.push(d); } };
  const p = deliver(store, prep, { method: 'share', nav });
  assert.equal(calls.length, 1, 'share must be called before any await');
  assert.equal(calls[0].files[0].name, 'tt-2026-11-13-0001.csv');
  assert.ok(calls[0].title.startsWith('[TT] 2026-11-13 batch 0001'));
  assert.equal((await p).method, 'share');
  assert.equal(await store.getSetting('batch'), 1);
});

test('prepared mailto opens synchronously; no-email and blocked are reported by prepareSend', async () => {
  const store = await ready();
  const opened = [];
  const p = deliver(store, prepareSend(await loadSendInput(store), { today: '2026-11-13', now }), { open: (u) => opened.push(u) });
  assert.equal(opened.length, 1);
  await p;
  const empty = mk();
  assert.deepEqual(prepareSend(await loadSendInput(empty), { today: '2026-11-13', now }), { ok: false, reason: 'no-email' });
  const bl = await ready({ blockedWords: ['x'] });
  assert.equal(prepareSend(await loadSendInput(bl), { today: '2026-11-13', now }).blocked.length, 1);
});
