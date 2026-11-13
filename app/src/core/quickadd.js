// Quick-add parser: one dictated/typed sentence -> entry fields. Pure, rule-based, no network.
import { formatHHMM, durationMinutes, addDays } from './time.js';

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, thirty: 30, 'forty-five': 45 };
const HOUR_WORDS = new Set(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']);
const MIN_WORDS = new Set(['fifteen', 'thirty', 'forty-five']);
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const RANGE_SEPS = new Set(['to', 'until', '-']);
const MIN_UNIT = /^(?:minutes?|mins?)$/;
const HOUR_UNIT = /^(?:hours?|hrs?|h)$/;

const norm = (tok) => tok.toLowerCase().replace(/[.,;!?]+$/, '');

function dowOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function numberAt(tokens, i) {
  const t = norm(tokens[i] ?? '');
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  if (t in NUM_WORDS) return NUM_WORDS[t];
  return null;
}

// ---- times ----
function applyMeridiem(h, mer) {
  if (mer === 'am') return h === 12 ? 0 : h;
  if (mer === 'pm') return h === 12 ? 12 : h + 12;
  if (h >= 1 && h <= 6) return h + 12; // 1-6 pm
  return h; // 7-11 am, 12 noon, 0 and 13+ as given
}

// Returns {minutes, len} for a time starting at tokens[i], or null.
function timeAt(tokens, i) {
  const t = norm(tokens[i] ?? '');
  if (!t) return null;
  if (t === 'noon') return { minutes: 720, len: 1 };
  if (t === 'midnight') return { minutes: 0, len: 1 };
  let h, m = 0, len = 1, explicit = null;
  let r;
  if ((r = /^(\d{1,2}):(\d{2})(am|pm)?$/.exec(t))) { h = +r[1]; m = +r[2]; explicit = r[3] ?? null; }
  else if ((r = /^(\d{3,4})(am|pm)?$/.exec(t))) { const d = r[1].padStart(4, '0'); h = +d.slice(0, 2); m = +d.slice(2); explicit = r[2] ?? null; }
  else if ((r = /^(\d{1,2})(am|pm)?$/.exec(t))) { h = +r[1]; explicit = r[2] ?? null; }
  else if (HOUR_WORDS.has(t)) {
    h = NUM_WORDS[t];
    const nx = norm(tokens[i + 1] ?? '');
    if (MIN_WORDS.has(nx)) { m = NUM_WORDS[nx]; len = 2; }
  } else return null;
  if (h > 23 || m > 59) return null;
  if (!explicit) {
    const nx = norm(tokens[i + len] ?? '');
    if (nx === 'am' || nx === 'pm') { explicit = nx; len++; }
  }
  if (explicit && (h < 1 || h > 12)) return null;
  return { minutes: applyMeridiem(h, explicit) * 60 + m, len };
}

// Finds `<time> to|until|- <time>`; returns {from, len, start, end} or null.
function findRange(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const a = timeAt(tokens, i);
    if (!a) continue;
    const sep = norm(tokens[i + a.len] ?? '');
    if (!RANGE_SEPS.has(sep)) continue;
    const b = timeAt(tokens, i + a.len + 1);
    if (!b) continue;
    let from = i, len = a.len + 1 + b.len;
    const prev = norm(tokens[i - 1] ?? '');
    if (prev === 'from' || prev === 'at') { from--; len++; }
    return { from, len, start: formatHHMM(a.minutes), end: formatHHMM(b.minutes) };
  }
  return null;
}

// ---- durations ----
// Returns {minutes, len} for a duration phrase starting at tokens[i], or null.
function durationAt(tokens, i) {
  const t = norm(tokens[i] ?? '');
  const t1 = norm(tokens[i + 1] ?? '');
  if (t === 'half' && t1 === 'an' && HOUR_UNIT.test(norm(tokens[i + 2] ?? ''))) return { minutes: 30, len: 3 };
  if (t === 'half' && /^hours?$/.test(t1)) return { minutes: 30, len: 2 };
  if ((t === 'an' || t === 'a') && /^(?:hour|hr)$/.test(t1)) {
    if (norm(tokens[i + 2] ?? '') === 'and' && norm(tokens[i + 3] ?? '') === 'a' && norm(tokens[i + 4] ?? '') === 'half') return { minutes: 90, len: 5 };
    return { minutes: 60, len: 2 };
  }
  let n, unit, len;
  const attached = /^(\d+(?:\.\d+)?)(h|hrs?|hours?|mins?|minutes?)$/.exec(t);
  if (attached) { n = Number(attached[1]); unit = attached[2]; len = 1; }
  else {
    n = numberAt(tokens, i);
    unit = t1;
    len = 2;
    if (n === null) return null;
  }
  if (MIN_UNIT.test(unit)) return { minutes: Math.round(n), len };
  if (!HOUR_UNIT.test(unit)) return null;
  let minutes = Math.round(n * 60);
  if (norm(tokens[i + len] ?? '') === 'and' && norm(tokens[i + len + 1] ?? '') === 'a' && norm(tokens[i + len + 2] ?? '') === 'half') {
    return { minutes: minutes + 30, len: len + 3 };
  }
  const extra = numberAt(tokens, i + len);
  if (extra !== null && Number.isInteger(extra) && extra < 60) {
    len++;
    if (MIN_UNIT.test(norm(tokens[i + len] ?? ''))) len++;
    minutes += extra;
  }
  return { minutes, len };
}

function findDuration(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const hasFor = norm(tokens[i]) === 'for';
    const d = durationAt(tokens, hasFor ? i + 1 : i);
    if (d) return hasFor ? { from: i, len: d.len + 1, minutes: d.minutes } : { from: i, len: d.len, minutes: d.minutes };
  }
  return null;
}

// ---- days ----
function findDay(tokens, today) {
  for (let i = 0; i < tokens.length; i++) {
    const t = norm(tokens[i]);
    let date = null;
    if (t === 'today') date = today;
    else if (t === 'yesterday') date = addDays(today, -1);
    else if (WEEKDAYS.includes(t)) date = addDays(today, -((dowOf(today) - WEEKDAYS.indexOf(t) + 7) % 7));
    if (date) {
      const on = norm(tokens[i - 1] ?? '') === 'on';
      return { from: on ? i - 1 : i, len: on ? 2 : 1, date };
    }
  }
  return null;
}

// ---- nickname ----
function editDistanceLeq1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) return true;
  const ra = a.slice(i), rb = b.slice(i);
  if (ra.length === rb.length) return ra.slice(1) === rb.slice(1);
  return ra.length > rb.length ? ra.slice(1) === rb : rb.slice(1) === ra;
}

function matchNickname(token, nicknames) {
  const t = norm(token);
  const variants = [t];
  if (t.endsWith("'s")) variants.push(t.slice(0, -2));
  else if (t.endsWith('s')) variants.push(t.slice(0, -1));
  for (const v of variants) {
    const hit = nicknames.find((n) => n.toLowerCase() === v);
    if (hit) return hit;
  }
  if (t.length >= 5) {
    for (const v of variants) {
      const hit = nicknames.find((n) => editDistanceLeq1(n.toLowerCase(), v));
      if (hit) return hit;
    }
  }
  return null;
}

const cut = (tokens, from, len) => tokens.splice(from, len);

export function parseQuickAdd(text, { nicknames = [], today } = {}) {
  const out = { action: 'add', nickname: null, nicknameMatched: false, task: '', description: '', date: today, start: '', end: '', duration_min: null };
  const tokens = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 1 && norm(tokens[0]) === 'stop') return { ...out, action: 'stop' };

  // note <text> at the end of the sentence
  const noteAt = tokens.findIndex((t, i) => i > 0 && norm(t) === 'note');
  if (noteAt > 0) out.description = tokens.splice(noteAt).slice(1).join(' ');

  // action verb
  const first = norm(tokens[0] ?? '');
  if (first === 'start') { out.action = 'start'; tokens.shift(); }
  else if (first === 'switch') {
    out.action = 'switch';
    tokens.shift();
    if (norm(tokens[0] ?? '') === 'to') tokens.shift();
  }

  // day word
  const day = findDay(tokens, today);
  if (day) { out.date = day.date; cut(tokens, day.from, day.len); }

  // time range, else duration
  const range = findRange(tokens);
  if (range) {
    out.start = range.start;
    out.end = range.end;
    out.duration_min = durationMinutes(range.start, range.end);
    cut(tokens, range.from, range.len);
  } else {
    const dur = findDuration(tokens);
    if (dur) { out.duration_min = dur.minutes; cut(tokens, dur.from, dur.len); }
  }

  // nickname, then task
  if (tokens.length) {
    const nick = matchNickname(tokens[0], nicknames);
    if (nick) { out.nickname = nick; out.nicknameMatched = true; tokens.shift(); }
  }
  out.task = tokens.join(' ').trim();
  return out;
}
