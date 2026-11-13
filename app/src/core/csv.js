// CSV + email builder. Format is a fixed contract with the work-side app.
import { toTenths, formatTenths, addDays } from './time.js';

export const CSV_HEADER = ['entry_id', 'nickname', 'date', 'start', 'end', 'duration_min',
  'task', 'description', 'source', 'updated_at', 'deleted'];

const BEGIN = '-----BEGIN TT CSV v1-----';
const END = '-----END TT CSV v1-----';

function field(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[,"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function row(e) {
  return CSV_HEADER.map((k) => {
    if (k === 'deleted') return e.deleted === true || e.deleted === 1 ? '1' : '0';
    if (k === 'duration_min') {
      const n = Number(e.duration_min);
      return Number.isFinite(n) ? String(Math.round(n)) : '';
    }
    return field(e[k]);
  }).join(',');
}

export function toCsv(entries) {
  return [CSV_HEADER.join(','), ...entries.map(row)].join('\r\n');
}

export function parseCsv(text) {
  const rows = [];
  let cur = [], f = '', q = false, i = 0;
  const endRow = () => { cur.push(f); f = ''; rows.push(cur); cur = []; };
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { f += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      f += c; i++;
    } else if (c === '"') { q = true; i++; }
    else if (c === ',') { cur.push(f); f = ''; i++; }
    else if (c === '\r' || c === '\n') {
      endRow();
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else { f += c; i++; }
  }
  if (f !== '' || cur.length) endRow();
  const [header, ...data] = rows;
  if (!header) return [];
  return data.filter((r) => !(r.length === 1 && r[0] === ''))
    .map((r) => Object.fromEntries(header.map((h, j) => [h, r[j] ?? ''])));
}

export function buildEmail(entries, { today, batch, windowDays, generatedAt, to }) {
  const from = addDays(today, -windowDays + 1);
  const nnnn = String(batch).padStart(4, '0');
  const csv = toCsv(entries);

  // Preview totals: minutes summed per nickname per day, rounded to tenths per day.
  const perDay = new Map();
  for (const e of entries) {
    if (e.deleted === true || e.deleted === 1) continue;
    const k = JSON.stringify([e.nickname, e.date]);
    perDay.set(k, (perDay.get(k) || 0) + (Number(e.duration_min) || 0));
  }
  const totals = new Map();
  for (const [k, min] of perDay) {
    const [nick] = JSON.parse(k);
    totals.set(nick, (totals.get(nick) || 0) + toTenths(min));
  }
  const lines = [`Time Tracker export · ${generatedAt} · window ${from}..${today}`, ''];
  for (const [nick, t] of totals) lines.push(`${nick}: ${formatTenths(t)} h`);
  if (totals.size) lines.push('');
  lines.push(BEGIN, csv, END);

  return {
    to,
    subject: `[TT] ${today} batch ${nnnn} (${entries.length} entries)`,
    body: lines.join('\n'),
    filename: `tt-${today}-${nnnn}.csv`,
    csv,
  };
}
