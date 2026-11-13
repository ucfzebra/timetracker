import { h, monthDay } from './dom.js';
import { weekGrid } from '../core/summary.js';
import { localDate, weekStart, addDays, formatTenths } from '../core/time.js';

let shown = null; // Monday of the week being viewed; null means the current week
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const cell = (t) => (t ? formatTenths(t) : '–');

function lastSent(iso) {
  if (!iso) return 'Last sent: never';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `Last sent: ${localDate(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export async function render(el, { store, navigate }) {
  const start = shown || weekStart(localDate(new Date()));
  const entries = await store.entriesBetween(start, addDays(start, 6));
  const g = weekGrid(entries, start);
  const cols = [0, 1, 2, 3, 4];
  if (g.dayTotals[5] || g.dayTotals[6]) cols.push(5, 6);
  const go = (n) => { shown = addDays(start, n * 7); navigate('#/week'); };

  const head = h('tr', {}, h('th', {}), cols.map((i) => h('th', {}, DAY[i])), h('th', {}, 'Σ'));
  const body = g.rows.map((r) => h('tr', { 'data-nick': r.nickname },
    h('th', { scope: 'row' }, r.nickname),
    cols.map((i) => h('td', { 'data-date': g.days[i] }, cell(r.perDay[i]))),
    h('td', { class: 'sum' }, cell(r.total)),
  ));
  const total = h('tr', { class: 'total' },
    h('th', { scope: 'row' }, 'Total'),
    cols.map((i) => h('td', {}, cell(g.dayTotals[i]))),
    h('td', { class: 'sum' }, cell(g.total)),
  );

  el.append(
    h('div', { class: 'week-nav' },
      h('button', { id: 'prev', 'aria-label': 'Previous week', onclick: () => go(-1) }, '‹'),
      h('h1', {}, 'Week of ' + monthDay(start)),
      h('button', { id: 'next', 'aria-label': 'Next week', onclick: () => go(1) }, '›'),
    ),
    h('table', { class: 'grid', id: 'grid' }, h('thead', {}, head), h('tbody', {}, body, total)),
    h('p', { class: 'muted' }, `Expected ${formatTenths(g.expected)} h this week. Hours are a rounded preview.`),
    h('p', { class: 'muted', id: 'last-sent' }, lastSent(await store.getSetting('lastSentAt'))),
  );
}
