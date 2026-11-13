// Blocked-word guard: warns when text contains user-listed sensitive words.
const WORD = '[\\p{L}\\p{N}]';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function findBlocked(text, words) {
  const hay = String(text ?? '');
  const hits = [];
  for (const entry of words || []) {
    if (typeof entry !== 'string' || hits.includes(entry)) continue;
    let w = entry.trim();
    const prefix = w.endsWith('*');
    if (prefix) w = w.slice(0, -1).trim();
    if (!w) continue;
    const re = new RegExp(`(?<!${WORD})${esc(w)}${prefix ? '' : `(?!${WORD})`}`, 'iu');
    if (re.test(hay)) hits.push(entry);
  }
  return hits;
}
