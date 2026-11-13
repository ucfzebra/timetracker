// Sending to work: pure batch preparation + a thin side-effecting sender.
import { buildEmail } from './core/csv.js';
import { findBlocked } from './core/guard.js';
import { addDays, localDate } from './core/time.js';

const isTomb = (e) => e.deleted === true || e.deleted === 1 || e.deleted === '1';

export function prepareBatch({ entries, settings, today, generatedAt }) {
  const windowDays = settings.windowDays ?? 14;
  const from = addDays(today, -windowDays + 1);
  const inWindow = entries.filter((e) => e.date >= from && e.date <= today);
  const words = settings.blockedWords || [];
  const blocked = inWindow.filter((e) => !isTomb(e)
    && (findBlocked(e.task, words).length || findBlocked(e.description, words).length));
  if (blocked.length) return { ok: false, blocked };
  const batch = (settings.batch || 0) + 1;
  // Tombstones carry no text: the work side only needs entry_id + deleted.
  const outgoing = inWindow.map((e) => (isTomb(e) ? { ...e, task: '', description: '' } : e));
  const email = buildEmail(outgoing, { today, batch, windowDays, generatedAt, to: settings.workEmail, });
  return { ok: true, batch, email, count: inWindow.length };
}

export async function sendBatch(store, { today, now = new Date(), nav = globalThis.navigator, open } = {}) {
  const [workEmail, blockedWords, windowDays, batch] = await Promise.all([
    store.getSetting('workEmail'), store.getSetting('blockedWords'),
    store.getSetting('windowDays'), store.getSetting('batch'),
  ]);
  if (!workEmail || !String(workEmail).trim()) return { ok: false, reason: 'no-email' };
  const to = String(workEmail).trim();
  const entries = await store.entriesBetween('0000-01-01', '9999-12-31', { includeDeleted: true });
  const prep = prepareBatch({
    entries, settings: { workEmail: to, blockedWords, windowDays, batch },
    today: today ?? localDate(now), generatedAt: now.toISOString(),
  });
  if (!prep.ok) return { ok: false, blocked: prep.blocked };
  const { email } = prep;
  const persist = async () => {
    await store.setSetting('batch', prep.batch);
    await store.setSetting('lastSentAt', now.toISOString());
  };

  const file = new File([email.csv], email.filename, { type: 'text/csv' });
  const data = { files: [file], title: email.subject, text: email.body };
  if (nav && typeof nav.canShare === 'function' && typeof nav.share === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share(data);
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled' };
      throw e;
    }
    await persist();
    return { ok: true, method: 'share', count: prep.count };
  }
  const url = `mailto:${to}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;
  (open || ((u) => { location.href = u; }))(url);
  await persist();
  return { ok: true, method: 'mailto', count: prep.count };
}
