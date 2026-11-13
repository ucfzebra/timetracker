// Summaries for the Today total and the Week grid. Minutes are summed per (nickname, day)
// and rounded once; every higher total is a sum of those rounded cells.
import { toTenths, weekStart, addDays } from './time.js';

const EXPECTED_PER_DAY = [100, 100, 100, 100, 0, 0, 0]; // Mon–Thu, tenths

function countable(entries, from, to) {
  return entries.filter(x => !x.deleted && !(x.end === '' && x.start) && x.date >= from && x.date <= to);
}

const byTotalThenName = (a, b) => b.total - a.total || (a.nickname < b.nickname ? -1 : a.nickname > b.nickname ? 1 : 0);

export function dayTotals(entries, date) {
  const mins = new Map();
  for (const x of countable(entries, date, date)) {
    mins.set(x.nickname, (mins.get(x.nickname) || 0) + x.duration_min);
  }
  const rows = [...mins].map(([nickname, minutes]) => ({ nickname, minutes, tenths: toTenths(minutes) }));
  rows.sort((a, b) => b.tenths - a.tenths || (a.nickname < b.nickname ? -1 : a.nickname > b.nickname ? 1 : 0));
  return { rows, totalTenths: rows.reduce((s, r) => s + r.tenths, 0) };
}

export function weekGrid(entries, anyDate) {
  const start = weekStart(anyDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const mins = new Map(); // nickname -> number[7]
  for (const x of countable(entries, days[0], days[6])) {
    const i = days.indexOf(x.date);
    if (i < 0) continue;
    if (!mins.has(x.nickname)) mins.set(x.nickname, new Array(7).fill(0));
    mins.get(x.nickname)[i] += x.duration_min;
  }
  const rows = [...mins].map(([nickname, m]) => {
    const perDay = m.map(toTenths);
    return { nickname, perDay, total: perDay.reduce((s, v) => s + v, 0) };
  }).sort(byTotalThenName);
  const dayTot = days.map((_, i) => rows.reduce((s, r) => s + r.perDay[i], 0));
  return {
    days, rows, dayTotals: dayTot,
    total: dayTot.reduce((s, v) => s + v, 0),
    expected: EXPECTED_PER_DAY.reduce((s, v) => s + v, 0),
    expectedPerDay: [...EXPECTED_PER_DAY],
  };
}
