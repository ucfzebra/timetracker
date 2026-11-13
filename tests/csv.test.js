import test from 'node:test';
import assert from 'node:assert/strict';
import { CSV_HEADER, toCsv, parseCsv, buildEmail } from '../app/src/core/csv.js';

const e = {entry_id:'id1',nickname:'Falcon',date:'2026-11-13',start:'12:30',end:'13:42',duration_min:72,
  task:'Design review',description:'rev "B", pkg\nline2 ✓',source:'phone',updated_at:'2026-11-13T18:43:10Z',deleted:false};
test('round trip', () => assert.deepEqual(parseCsv(toCsv([e]))[0].description, e.description));
test('header', () => assert.equal(toCsv([]).split('\r\n')[0], CSV_HEADER.join(',')));
test('email', () => {
  const m = buildEmail([e], {today:'2026-11-13', batch:42, windowDays:14, generatedAt:'2026-11-13 17:02', to:'me@work'});
  assert.equal(m.subject, '[TT] 2026-11-13 batch 0042 (1 entries)');
  assert.equal(m.filename, 'tt-2026-11-13-0042.csv');
  assert.match(m.body, /-----BEGIN TT CSV v1-----\r?\n[\s\S]*-----END TT CSV v1-----/);
  assert.match(m.body, /window 2026-10-31\.\.2026-11-13/);
  assert.ok(m.body.includes(m.csv.trim()));
  assert.equal(m.to, 'me@work');
  assert.match(m.body, /^Time Tracker export · 2026-11-13 17:02 · window 2026-10-31\.\.2026-11-13\n\nFalcon: 1\.2 h\n\n-----BEGIN/);
});
test('tombstone', () => assert.match(toCsv([{...e, deleted:true}]), /,1\r?\n?$/));
test('empty fields and deleted forms', () => {
  const r = parseCsv(toCsv([{...e, start:undefined, end:'', description:undefined, deleted:1, duration_min:30.0}]))[0];
  assert.equal(r.start, ''); assert.equal(r.end, ''); assert.equal(r.description, '');
  assert.equal(r.deleted, '1'); assert.equal(r.duration_min, '30');
});
test('summary excludes tombstones, rounds per day', () => {
  const m = buildEmail([
    {...e, duration_min:10}, {...e, entry_id:'b', duration_min:10},
    {...e, entry_id:'c', duration_min:600, deleted:true},
    {...e, entry_id:'d', nickname:'Owl', date:'2026-11-12', duration_min:60},
  ], {today:'2026-11-13', batch:1, windowDays:14, generatedAt:'x', to:''});
  assert.match(m.body, /Falcon: 0\.3 h/); // 20 min -> 3 tenths
  assert.match(m.body, /Owl: 1\.0 h/);
  assert.match(m.subject, /\(4 entries\)/);
});
