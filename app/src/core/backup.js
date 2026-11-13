// Pure backup build / merge logic. No I/O.
export const BACKUP_FORMAT = 'capture-backup';
export const BACKUP_VERSION = 1;
const IMPORTABLE_SETTINGS = ['blockedWords', 'workEmail', 'strictGuard', 'windowDays'];

export function makeBackup({ entries, nicknames, settings }, exportedAt) {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt, entries, nicknames, settings };
}

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
  for (const raw of incoming.entries) {
    if (!raw || typeof raw.entry_id !== 'string' || !raw.entry_id) continue;
    const e = { ...raw, deleted: isTomb(raw.deleted) };
    const cur = have.get(e.entry_id);
    if (!cur || String(e.updated_at ?? '') > String(cur.updated_at ?? '')) entries.push(e);
  }

  const rows = new Map(local.nicknames.map((n) => [n.name, n]));
  let next = local.nicknames.reduce((m, n) => Math.max(m, n.sort_order), -1) + 1;
  const nicknames = [];
  for (const n of incoming.nicknames) {
    if (!n || typeof n.name !== 'string' || !n.name) continue;
    const cur = rows.get(n.name);
    if (!cur) {
      nicknames.push({ name: n.name, active: !!n.active, sort_order: Number.isFinite(n.sort_order) ? n.sort_order : next++ });
    } else if (!cur.active && n.active) {
      nicknames.push({ ...cur, active: true });
    }
  }

  const settings = {};
  for (const k of IMPORTABLE_SETTINGS) {
    if (k in incoming.settings && !(k in local.settings)) settings[k] = incoming.settings[k];
  }
  return { entries, nicknames, settings };
}
