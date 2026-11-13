// Pure backup build / merge logic. No I/O.
export const BACKUP_FORMAT = 'capture-backup';
export const BACKUP_VERSION = 1;
const IMPORTABLE_SETTINGS = ['blockedWords', 'workEmail', 'strictGuard', 'windowDays'];

// The blocked-word list is itself sensitive, so it stays out of the file unless asked for.
export function makeBackup({ entries, nicknames, settings }, exportedAt, { includeBlocked = false } = {}) {
  const out = { ...settings };
  if (!includeBlocked) delete out.blockedWords;
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt, entries, nicknames, settings: out };
}

const LIM = { nickname: 24, task: 60, description: 200 };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const str = (v, max) => typeof v === 'string' && v.length <= max;
const orEmpty = (v) => (v === undefined || v === null ? '' : v);

function validEntry(e) {
  return str(e.entry_id, 200) && e.entry_id !== ''
    && typeof e.nickname === 'string' && e.nickname.trim() !== '' && e.nickname.length <= LIM.nickname
    && str(orEmpty(e.task), LIM.task) && str(orEmpty(e.description), LIM.description)
    && typeof e.date === 'string' && DATE.test(e.date) && !Number.isNaN(Date.parse(e.date))
    && ['start', 'end'].every((k) => e[k] === undefined || e[k] === null || e[k] === '' || (typeof e[k] === 'string' && HHMM.test(e[k])))
    && Number.isInteger(e.duration_min) && e.duration_min >= 0
    && typeof e.updated_at === 'string' && ISO.test(e.updated_at) && !Number.isNaN(Date.parse(e.updated_at));
}

const SETTING_CHECK = {
  blockedWords: (v) => (Array.isArray(v) && v.every((w) => typeof w === 'string') ? v : undefined),
  strictGuard: (v) => (typeof v === 'boolean' ? v : undefined),
  windowDays: (v) => (Number.isInteger(v) && v >= 7 && v <= 31 ? v : undefined),
  workEmail: (v) => (typeof v === 'string' && (v === '' || /^[^\s@?&]+@[^\s@?&]+$/.test(v)) ? v : undefined),
};

const isTomb = (v) => v === true || v === 1 || v === '1' || v === 'true';

// local: {entries, nicknames (rows incl. inactive), settings (object of stored keys)}
// Returns only what must be written: {entries, nicknames, settings}.
export function mergeBackup(local, incoming) {
  if (!incoming || typeof incoming !== 'object' || incoming.format !== BACKUP_FORMAT) throw new Error('This is not a Capture backup file.');
  if (incoming.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version: ${incoming.version}`);
  if (!Array.isArray(incoming.entries) || !Array.isArray(incoming.nicknames)
    || !incoming.settings || typeof incoming.settings !== 'object') throw new Error('This is not a Capture backup file.');

  const have = new Map(local.entries.map((e) => [e.entry_id, e]));
  const entries = [];
  let skipped = 0;
  for (const raw of incoming.entries) {
    if (!raw || typeof raw !== 'object' || !validEntry(raw)) { skipped++; continue; }
    const e = {
      entry_id: raw.entry_id, nickname: raw.nickname, date: raw.date,
      start: orEmpty(raw.start), end: orEmpty(raw.end), duration_min: raw.duration_min,
      task: orEmpty(raw.task), description: orEmpty(raw.description),
      source: typeof raw.source === 'string' ? raw.source : '',
      updated_at: raw.updated_at, deleted: isTomb(raw.deleted),
    };
    const cur = have.get(e.entry_id);
    if (!cur || Date.parse(e.updated_at) > Date.parse(cur.updated_at)) entries.push(e);
  }

  const rows = new Map(local.nicknames.map((n) => [n.name, n]));
  let next = local.nicknames.reduce((m, n) => Math.max(m, n.sort_order), -1) + 1;
  const nicknames = [];
  for (const n of incoming.nicknames) {
    if (!n || !str(n.name, LIM.nickname) || !n.name.trim()) { skipped++; continue; }
    const cur = rows.get(n.name);
    if (!cur) {
      nicknames.push({ name: n.name, active: !!n.active, sort_order: Number.isFinite(n.sort_order) ? n.sort_order : next++ });
    } else if (!cur.active && n.active) {
      nicknames.push({ ...cur, active: true });
    }
  }

  const settings = {};
  for (const k of IMPORTABLE_SETTINGS) {
    if (!(k in incoming.settings) || k in local.settings) continue;
    const v = SETTING_CHECK[k](incoming.settings[k]);
    if (v === undefined) skipped++; else settings[k] = v;
  }
  // Batch numbers must never go backwards, or the work side would see repeats.
  const ib = incoming.settings.batch;
  const lb = Number.isInteger(local.settings.batch) ? local.settings.batch : 0;
  if (Number.isInteger(ib) && ib >= 0 && ib > lb) settings.batch = ib;
  return { entries, nicknames, settings, skipped };
}
