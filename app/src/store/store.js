import { parseHHMM, formatHHMM, durationMinutes, localDate } from '../core/time.js';
import { uuid } from '../core/ids.js';

const LIMITS = { nickname: 24, task: 60, description: 200 };
const STALE_HOURS = 10;
const DEFAULTS = {
  windowDays: 14,
  batch: 0,
  strictGuard: false,
  blockedWords: [],
  workEmail: '',
  lastSentAt: null,
  lastBackupAt: null,
  weekAckFor: null,
};

function validate(e, recompute = true) {
  if (typeof e.nickname !== 'string' || e.nickname.trim() === '') throw new RangeError('nickname required');
  for (const f of ['nickname', 'task', 'description']) {
    if (String(e[f] ?? '').length > LIMITS[f]) throw new RangeError(`${f} exceeds ${LIMITS[f]} characters`);
  }
  if (recompute && e.start && e.end) {
    const d = durationMinutes(e.start, e.end);
    if (Number.isNaN(d)) throw new RangeError('invalid start/end');
    e.duration_min = d;
  } else if (!Number.isInteger(e.duration_min) || e.duration_min < 0) {
    throw new RangeError('duration_min must be a non-negative integer');
  }
  return e;
}

function startMs(e) {
  const [y, mo, d] = e.date.split('-').map(Number);
  const m = parseHHMM(e.start);
  return new Date(y, mo - 1, d, Math.floor(m / 60), m % 60).getTime();
}

const hhmm = (d) => formatHHMM(d.getHours() * 60 + d.getMinutes());

export function createStore(backend, { now = () => new Date(), source = 'web' } = {}) {
  function stamp(prev) {
    const t = now().getTime();
    const p = prev ? Date.parse(prev) : -Infinity;
    return new Date(t > p ? t : p + 1).toISOString();
  }

  // Promise-chain mutex: entry writes and timer operations run one at a time, so two
  // overlapping taps can never both see "nothing running" and start two timers.
  let chain = Promise.resolve();
  const serial = (fn) => (...args) => {
    const p = chain.then(() => fn(...args));
    chain = p.catch(() => {});
    return p;
  };

  async function addEntryUnlocked(input) {
    const e = validate({
      nickname: input.nickname,
      date: input.date,
      start: input.start ?? '',
      end: input.end ?? '',
      duration_min: input.duration_min ?? 0,
      task: input.task ?? '',
      description: input.description ?? '',
    });
    e.nickname = e.nickname.trim();
    e.entry_id = uuid();
    e.source = source;
    e.deleted = false;
    e.updated_at = stamp(null);
    await backend.put('entries', e);
    return e;
  }

  const addEntry = serial(addEntryUnlocked);

  const updateEntry = serial(async (id, patch) => {
    const prev = await backend.get('entries', id);
    if (!prev) throw new Error(`no such entry: ${id}`);
    const e = { ...prev, ...patch, entry_id: prev.entry_id, source: prev.source };
    // Recompute from start/end only when the patch touches them; otherwise keep the
    // stored duration (a stopped timer may span more than 24 h).
    const touchesTimes = 'start' in patch || 'end' in patch;
    validate(e, touchesTimes && !('duration_min' in patch));
    e.nickname = e.nickname.trim();
    e.updated_at = stamp(prev.updated_at);
    await backend.put('entries', e);
    return e;
  });

  async function getEntry(id) {
    return (await backend.get('entries', id)) || null;
  }

  const deleteEntry = serial(async (id) => {
    const prev = await backend.get('entries', id);
    if (!prev) throw new Error(`no such entry: ${id}`);
    const e = { ...prev, deleted: true, updated_at: stamp(prev.updated_at) };
    await backend.put('entries', e);
    return e;
  });

  async function entriesBetween(from, to, { includeDeleted = false } = {}) {
    const all = await backend.all('entries');
    return all
      .filter((e) => e.date >= from && e.date <= to && (includeDeleted || !e.deleted))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  }

  async function running() {
    const all = await backend.all('entries');
    return all.find((e) => !e.deleted && e.start && !e.end) || null;
  }

  async function stopTimerUnlocked() {
    const r = await running();
    if (!r) return null;
    const n = now();
    const elapsed = Math.max(0, Math.floor((n.getTime() - startMs(r)) / 60000));
    // Written directly: updateEntry would recompute duration from HH:MM, losing whole days.
    const e = { ...r, end: hhmm(n), duration_min: elapsed, updated_at: stamp(r.updated_at) };
    await backend.put('entries', e);
    return e;
  }

  // Validation runs inside addEntry; the previous timer is stopped only after we
  // know the new one is valid, so a bad nickname never stops the running timer.
  async function startTimerUnlocked(nickname, task = '', description = '') {
    validate({ nickname, task, description, duration_min: 0 });
    await stopTimerUnlocked();
    const n = now();
    // start/end are set by hand: addEntry with only a start keeps duration 0.
    return addEntryUnlocked({ nickname, date: localDate(n), start: hhmm(n), end: '', duration_min: 0, task, description });
  }

  const stopTimer = serial(stopTimerUnlocked);
  const startTimer = serial(startTimerUnlocked);
  const switchTimer = startTimer;

  async function staleTimer() {
    const r = await running();
    if (!r) return null;
    const hours = (now().getTime() - startMs(r)) / 3600000;
    return hours > STALE_HOURS ? { entry: r, hours } : null;
  }

  async function nicknames() {
    return (await backend.all('nicknames'))
      .filter((n) => n.active)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((n) => n.name);
  }

  async function activeRows() {
    return (await backend.all('nicknames')).filter((n) => n.active);
  }

  async function checkNewName(name) {
    const t = typeof name === 'string' ? name.trim() : '';
    if (!t) throw new Error('nickname required');
    if (t.length > LIMITS.nickname) throw new RangeError(`nickname exceeds ${LIMITS.nickname} characters`);
    const lower = t.toLowerCase();
    if ((await activeRows()).some((n) => n.name.toLowerCase() === lower)) throw new Error(`nickname already exists: ${t}`);
    return t;
  }

  async function addNickname(name) {
    const t = await checkNewName(name);
    const all = await backend.all('nicknames');
    const sort_order = all.reduce((m, n) => Math.max(m, n.sort_order), -1) + 1;
    const row = { name: t, active: true, sort_order };
    await backend.put('nicknames', row);
    return row;
  }

  async function renameNickname(oldName, newName) {
    const old = await backend.get('nicknames', oldName);
    if (!old || !old.active) throw new Error(`no such nickname: ${oldName}`);
    const t = await checkNewName(newName);
    const row = { name: t, active: true, sort_order: old.sort_order };
    await backend.put('nicknames', row);
    await backend.put('nicknames', { ...old, active: false });
    return row;
  }

  async function archiveNickname(name) {
    const old = await backend.get('nicknames', name);
    if (!old) throw new Error(`no such nickname: ${name}`);
    await backend.put('nicknames', { ...old, active: false });
  }

  async function getSetting(key, dflt) {
    const row = await backend.get('settings', key);
    if (row) return row.value;
    return dflt !== undefined ? dflt : DEFAULTS[key];
  }

  async function setSetting(key, value) {
    await backend.put('settings', { key, value });
  }

  // Raw access for backup export / import. Import merges are decided by core/backup.js.
  async function exportAll() {
    return {
      entries: await backend.all('entries'),
      nicknames: await backend.all('nicknames'),
      settings: Object.fromEntries((await backend.all('settings')).map((r) => [r.key, r.value])),
    };
  }

  async function importRows({ entries = [], nicknames = [], settings = {} }) {
    for (const e of entries) await backend.put('entries', e);
    for (const n of nicknames) await backend.put('nicknames', n);
    for (const [key, value] of Object.entries(settings)) await backend.put('settings', { key, value });
  }

  async function recentTasks(nickname, limit = 8) {
    const all = (await backend.all('entries'))
      .filter((e) => !e.deleted && e.nickname === nickname && e.task)
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
    const out = [];
    for (const e of all) {
      if (!out.includes(e.task)) out.push(e.task);
      if (out.length >= limit) break;
    }
    return out;
  }

  return {
    addEntry, updateEntry, deleteEntry, getEntry, entriesBetween, running,
    startTimer, stopTimer, switchTimer, staleTimer,
    nicknames, addNickname, renameNickname, archiveNickname,
    getSetting, setSetting, recentTasks, exportAll, importRows,
  };
}
