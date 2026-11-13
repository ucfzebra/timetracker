import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from '../app/src/core/quickadd.js';

const opts = { nicknames: ['Falcon', 'Heron', 'Admin', 'Kestrel'], today: '2026-11-13' };
const p = (s) => parseQuickAdd(s, opts);
const base = { action: 'add', nickname: null, nicknameMatched: false, task: '', description: '', date: '2026-11-13', start: '', end: '', duration_min: null };
const eq = (input, exp) => test(input, () => assert.deepEqual(p(input), { ...base, ...exp }));

eq('Falcon design review 9 to 11:45', { nickname: 'Falcon', nicknameMatched: true, task: 'design review', start: '09:00', end: '11:45', duration_min: 165 });
eq('Heron test procedure for 45 minutes', { nickname: 'Heron', nicknameMatched: true, task: 'test procedure', duration_min: 45 });
eq('Admin training an hour and a half yesterday', { nickname: 'Admin', nicknameMatched: true, task: 'training', duration_min: 90, date: '2026-11-12' });
eq('falcons design review 1 to 2:30 note rev B', { nickname: 'Falcon', nicknameMatched: true, task: 'design review', start: '13:00', end: '14:30', duration_min: 90, description: 'rev B' });
eq('switch to Heron drawing check', { action: 'switch', nickname: 'Heron', nicknameMatched: true, task: 'drawing check' });
eq('stop', { action: 'stop' });
eq('Kestral sync for 30 min', { nickname: 'Kestrel', nicknameMatched: true, task: 'sync', duration_min: 30 });
eq('Zebra thing for 10 min', { task: 'Zebra thing', duration_min: 10 });
eq('Falcon review 9:30 am to noon', { nickname: 'Falcon', nicknameMatched: true, task: 'review', start: '09:30', end: '12:00', duration_min: 150 });
eq('Heron fix for 2 hours 15', { nickname: 'Heron', nicknameMatched: true, task: 'fix', duration_min: 135 });
eq('Falcon x 930 to 1015', { nickname: 'Falcon', nicknameMatched: true, task: 'x', start: '09:30', end: '10:15', duration_min: 45 });
eq('Admin y monday for 1.5 hours', { nickname: 'Admin', nicknameMatched: true, task: 'y', date: '2026-11-09', duration_min: 90 });
eq('Falcon z nine thirty to eleven', { nickname: 'Falcon', nicknameMatched: true, task: 'z', start: '09:30', end: '11:00', duration_min: 90 });

// extras
eq('start Falcon wiring', { action: 'start', nickname: 'Falcon', nicknameMatched: true, task: 'wiring' });
eq('Switch Heron bench', { action: 'switch', nickname: 'Heron', nicknameMatched: true, task: 'bench' });
eq('Falcon half an hour', { nickname: 'Falcon', nicknameMatched: true, duration_min: 30 });
eq('Falcon a 2 hours 15 minutes', { nickname: 'Falcon', nicknameMatched: true, task: 'a', duration_min: 135 });
eq('Falcon q 2 pm to 3 pm', { nickname: 'Falcon', nicknameMatched: true, task: 'q', start: '14:00', end: '15:00', duration_min: 60 });
eq('Falcon q 11 pm - 1 am', { nickname: 'Falcon', nicknameMatched: true, task: 'q', start: '23:00', end: '01:00', duration_min: 120 });
eq('Falcon q 8 until 12', { nickname: 'Falcon', nicknameMatched: true, task: 'q', start: '08:00', end: '12:00', duration_min: 240 });
eq('Falcon q midnight to 1', { nickname: 'Falcon', nicknameMatched: true, task: 'q', start: '00:00', end: '13:00', duration_min: 780 });
eq('Falcon q friday for 20 min', { nickname: 'Falcon', nicknameMatched: true, task: 'q', duration_min: 20 });
eq('Falcon q thursday for 20 min', { nickname: 'Falcon', nicknameMatched: true, task: 'q', duration_min: 20, date: '2026-11-12' });
eq('Falcon Mixed Case 9 to 10 NOTE Keep THIS', { nickname: 'Falcon', nicknameMatched: true, task: 'Mixed Case', start: '09:00', end: '10:00', duration_min: 60, description: 'Keep THIS' });
eq('hello', { task: 'hello' });
