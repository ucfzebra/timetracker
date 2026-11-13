// Pure decision logic for the Today banners.
import { localDate, weekStart } from './time.js';

const AFTER = 16 * 60 + 30; // 16:30 local

export function todayBanners({ now, lastSentAt = null, weekAckFor = null, entries = [], stale = null }) {
  const out = [];
  const today = localDate(now);
  const dow = now.getDay(); // 0 = Sunday
  const late = now.getHours() * 60 + now.getMinutes() >= AFTER;

  if (stale) {
    out.push({
      kind: 'stale',
      text: `Timer running ${Math.floor(stale.hours)} h on ${stale.entry.nickname}. Set end time?`,
      entryId: stale.entry.entry_id,
    });
  }

  if (dow >= 1 && dow <= 4 && late) {
    const count = entries.filter((e) => (lastSentAt ? e.updated_at > lastSentAt : e.date === today)).length;
    if (count > 0) out.push({ kind: 'unsent', text: `${count} ${count === 1 ? 'entry' : 'entries'} not sent`, count });
  }

  const weekWindow = (dow === 4 && late) || dow === 5 || dow === 6 || dow === 0;
  if (weekWindow && weekAckFor !== weekStart(today)) out.push({ kind: 'week', text: 'Submit your week timecard' });

  return out;
}
