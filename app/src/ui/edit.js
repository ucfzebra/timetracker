import { h, fmtDur, busy } from './dom.js';
import { findBlocked } from '../core/guard.js';
import { buildPatch } from '../core/patch.js';
import { parseHHMM, durationMinutes, localDate, toTenths, formatTenths } from '../core/time.js';

// "45" or "90" = minutes, "1:30" = h:mm
function parseDuration(s) {
  const t = String(s).trim();
  let m = /^(\d+)$/.exec(t);
  if (m) return Number(m[1]);
  m = /^(\d+):(\d{1,2})$/.exec(t);
  if (m && Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
  return null;
}

function takePrefill() {
  try {
    const raw = sessionStorage.getItem('capture.prefill');
    sessionStorage.removeItem('capture.prefill');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function render(el, { store, navigate, params }) {
  const id = params?.id && params.id !== 'new' ? params.id : null;
  const existing = id ? await store.getEntry(id) : null;
  if (id && (!existing || existing.deleted)) {
    el.append(h('p', { class: 'muted' }, 'That entry no longer exists.'), h('button', { onclick: () => navigate('#/today') }, 'Back'));
    return;
  }
  const pre = id ? null : takePrefill();
  let noteText = null;
  try {
    noteText = sessionStorage.getItem('capture.editNote');
    sessionStorage.removeItem('capture.editNote');
  } catch { /* optional */ }
  const src = existing || pre || {};
  const wasRunning = !!(existing && existing.start && !existing.end);
  const nicks = await store.nicknames();
  if (src.nickname && !nicks.includes(src.nickname)) nicks.unshift(src.nickname);

  const initMode = src.start && (src.end || wasRunning || !src.duration_min) ? 'range' : src.duration_min ? 'dur' : 'range';
  let mode = initMode;

  const unmatched = !existing && !!pre && !src.nickname;
  const nick = h('select', { id: 'nick' }, unmatched ? h('option', { value: '' }, '(choose)') : null, nicks.map((n) => h('option', { value: n }, n)));
  nick.value = src.nickname || '';
  if (!nick.value && !unmatched && nicks.length) nick.value = nicks[0];
  const date = h('input', { id: 'date', type: 'date', value: src.date || localDate(new Date()) });
  const start = h('input', { id: 'start', type: 'time', value: src.start || '' });
  const end = h('input', { id: 'end', type: 'time', value: src.end || '' });
  const dur = h('input', { id: 'dur', type: 'text', inputmode: 'text', placeholder: 'minutes or h:mm', autocomplete: 'off', value: mode === 'dur' && src.duration_min ? String(src.duration_min) : '' });
  const task = h('input', { id: 'task', type: 'text', maxlength: 60, value: src.task || '', autocomplete: 'off' });
  const desc = h('input', { id: 'desc', type: 'text', maxlength: 200, value: src.description || '', autocomplete: 'off' });
  const live = h('p', { id: 'live', class: 'live' });
  const err = h('p', { class: 'error', role: 'alert' });
  const warn = h('div', { id: 'warn' });

  const rangeBox = h('div', { class: 'two' },
    h('div', {}, h('label', { for: 'start' }, 'Start'), start),
    h('div', {}, h('label', { for: 'end' }, 'End'), end));
  const durBox = h('div', {}, h('label', { for: 'dur' }, 'Duration'), dur);

  const radio = (value, label) => h('label', { class: 'radio' },
    h('input', { type: 'radio', name: 'mode', value, checked: mode === value, onchange: () => { mode = value; sync(); } }), ' ' + label);

  function minutes() {
    if (mode === 'dur') return parseDuration(dur.value);
    if (parseHHMM(start.value) === null || parseHHMM(end.value) === null) return null;
    return durationMinutes(start.value, end.value);
  }
  function sync() {
    rangeBox.hidden = mode !== 'range';
    durBox.hidden = mode !== 'dur';
    const m = minutes();
    live.textContent = m === null ? '' : `= ${fmtDur(m)} (${formatTenths(toTenths(m))} h)`;
  }
  for (const i of [start, end, dur]) i.addEventListener('input', sync);

  async function persist() {
    err.textContent = '';
    const base = { nickname: nick.value, date: date.value, task: task.value.trim(), description: desc.value.trim() };
    if (!base.nickname) throw new Error('Choose a nickname.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(base.date)) throw new Error('Pick a date.');
    let times;
    if (mode === 'dur') {
      const m = parseDuration(dur.value);
      if (m === null) throw new Error('Enter the duration as minutes (45) or h:mm (1:30).');
      times = { start: '', end: '', duration_min: m };
    } else {
      if (parseHHMM(start.value) === null) throw new Error('Enter a start time.');
      if (parseHHMM(end.value) === null && !(wasRunning && !end.value)) throw new Error('Enter an end time.');
      times = { start: start.value, end: end.value };
    }
    if (existing) await store.updateEntry(existing.entry_id, buildPatch(existing, { ...base, mode, start: '', end: '', duration_min: null, ...times }));
    else await store.addEntry({ ...base, ...times });
    await navigate('#/today');
  }

  async function save(force) {
    try {
      const words = await store.getSetting('blockedWords');
      const strict = await store.getSetting('strictGuard');
      const hits = force && !strict ? [] : findBlocked(`${task.value} ${desc.value}`, words);
      warn.replaceChildren();
      if (hits.length) {
        const quoted = hits.map((w) => `"${w}"`).join(', ');
        const inTask = findBlocked(task.value, words).length > 0;
        warn.append(h('div', { class: 'warn', role: 'alert' },
          h('p', {}, `⚠ ${quoted} ${hits.length > 1 ? 'are' : 'is'} on your blocked word list. ${strict ? 'Edit before saving.' : 'Edit before saving or tap Save anyway.'}`),
          h('div', { class: 'btn-row' },
            h('button', { id: 'warn-edit', onclick: () => (inTask || !desc.value ? task : desc).focus() }, 'Edit'),
            strict ? null : h('button', { id: 'save-anyway', class: 'danger', onclick: busy(() => save(true)) }, 'Save anyway'))));
        return;
      }
      await persist();
    } catch (e) {
      err.textContent = e.message || String(e);
    }
  }

  const del = busy(async () => {
    if (!confirm('Delete this entry?')) return;
    try { await store.deleteEntry(existing.entry_id); await navigate('#/today'); } catch (e) { err.textContent = e.message; }
  });

  el.append(
    h('div', { class: 'edit-top' },
      h('button', { id: 'back', onclick: () => navigate('#/today') }, '‹ Back'),
      h('h1', {}, existing ? 'Edit entry' : 'New entry'),
      existing ? h('button', { id: 'delete', class: 'danger', onclick: del }, 'Delete') : h('span')),
    noteText && existing ? h('p', { class: 'banner', id: 'edit-note', role: 'status' }, noteText) : null,
    h('label', { for: 'nick' }, 'Nickname'), nick,
    h('label', { for: 'date' }, 'Date'), date,
    h('div', { class: 'modes', role: 'radiogroup', 'aria-label': 'Mode' }, radio('range', 'Start/Stop'), radio('dur', 'Duration')),
    rangeBox, durBox, live,
    h('label', { for: 'task' }, 'Task'), task,
    h('label', { for: 'desc' }, 'Note'), desc,
    warn, err,
    h('p', {}, h('button', { id: 'save', class: 'primary', onclick: busy(() => save(false)) }, 'Save')),
  );
  if (unmatched) nick.classList.add('flag');
  sync();
}
