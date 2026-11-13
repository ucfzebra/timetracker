// Build an update patch containing only the fields that changed. Sending start/end makes the
// store recompute duration_min, which would collapse a stopped entry longer than 24 h.
export function buildPatch(existing, form) {
  const patch = {};
  for (const k of ['nickname', 'date', 'task', 'description']) {
    if (form[k] !== existing[k]) patch[k] = form[k];
  }
  if (form.mode === 'dur') {
    if (existing.start !== '') patch.start = '';
    if (existing.end !== '') patch.end = '';
    if (existing.start !== '' || existing.end !== '' || form.duration_min !== existing.duration_min) {
      patch.duration_min = form.duration_min;
    }
  } else {
    if (form.start !== existing.start) patch.start = form.start;
    if (form.end !== existing.end) patch.end = form.end;
  }
  return patch;
}
