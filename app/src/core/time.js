// Time maths. All date maths uses Date.UTC on YYYY-MM-DD strings so DST never shifts a date.

const DAY = 1440;

export function parseHHMM(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatHHMM(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

export function durationMinutes(start, end) {
  const s = parseHHMM(start), e = parseHHMM(end);
  if (s === null || e === null) return NaN;
  return e >= s ? e - s : e + DAY - s;
}

export function toTenths(minutes) {
  return Math.floor((minutes + 3) / 6);
}

export function formatTenths(tenths) {
  return Math.floor(tenths / 10) + '.' + (tenths % 10);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function localDate(d) {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toUtc(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms) {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(date, n) {
  return fromUtc(toUtc(date) + n * 86400000);
}

export function weekStart(date) {
  const dow = new Date(toUtc(date)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}
