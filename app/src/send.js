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

// Indirection for opening the mail link; tests and the smoke run replace io.open.
export const io = { open: (u) => { location.href = u; } };

export const mailtoUrl = (to, email) =>
  `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;

// Everything async a send needs. The Today screen loads this while rendering so that the
// tap handler can build the email and call navigator.share without awaiting first.
export async function loadSendInput(store) {
  const [workEmail, blockedWords, windowDays, batch, entries] = await Promise.all([
    store.getSetting('workEmail'), store.getSetting('blockedWords'),
    store.getSetting('windowDays'), store.getSetting('batch'),
    store.entriesBetween('0000-01-01', '9999-12-31', { includeDeleted: true }),
  ]);
  return { workEmail, blockedWords, windowDays, batch, entries };
}

// Synchronous: no-email / blocked checks and the finished email.
export function prepareSend(input, { today, now = new Date() } = {}) {
  const to = String(input.workEmail || '').trim();
  if (!to) return { ok: false, reason: 'no-email' };
  const prep = prepareBatch({
    entries: input.entries,
    settings: { workEmail: to, blockedWords: input.blockedWords, windowDays: input.windowDays, batch: input.batch },
    today: today ?? localDate(now), generatedAt: now.toISOString(),
  });
  if (!prep.ok) return { ok: false, blocked: prep.blocked };
  return { ...prep, to, now };
}

// method 'mailto' (default) opens the mail link; 'share' shares the CSV as a file when the
// browser can, falling back to mailto when it cannot or refuses (NotAllowedError).
// batch / lastSentAt are written only after the link opened or the share resolved.
export function deliver(store, prep, { method = 'mailto', nav = globalThis.navigator, open } = {}) {
  const { email } = prep;
  const persist = async (how) => {
    await store.setSetting('batch', prep.batch);
    await store.setSetting('lastSentAt', prep.now.toISOString());
    return { ok: true, method: how, count: prep.count };
  };
  const mail = () => {
    (open || io.open)(mailtoUrl(prep.to, email));
    return persist('mailto');
  };
  if (method !== 'share') return mail();
  const file = new File([email.csv], email.filename, { type: 'text/csv' });
  const canShare = nav && typeof nav.canShare === 'function' && typeof nav.share === 'function'
    && nav.canShare({ files: [file] });
  if (!canShare) return mail();
  // nav.share is called synchronously here, inside the tap's user activation.
  return nav.share({ files: [file], title: email.subject, text: email.body }).then(
    () => persist('share'),
    (e) => {
      if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled' };
      if (e && e.name === 'NotAllowedError') return mail();
      throw e;
    },
  );
}

export async function sendBatch(store, { today, now = new Date(), nav = globalThis.navigator, open, method = 'mailto' } = {}) {
  const prep = prepareSend(await loadSendInput(store), { today, now });
  if (!prep.ok) return prep;
  return deliver(store, prep, { method, nav, open });
}
