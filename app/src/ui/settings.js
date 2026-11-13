import { h } from './dom.js';
import { makeBackup, mergeBackup } from '../core/backup.js';
import { localDate } from '../core/time.js';

export async function render(el, { store, navigate }) {
  const note = h('p', { id: 'settings-msg', class: 'muted', role: 'status' });
  const say = (t) => { note.textContent = t; };
  const redraw = () => navigate('#/settings');

  // ---- nicknames
  const rows = (await store.exportAll()).nicknames.filter((n) => n.active).sort((a, b) => a.sort_order - b.sort_order);
  const err = h('p', { class: 'error', role: 'alert' });
  const guard = (fn) => async () => { err.textContent = ''; try { await fn(); } catch (e) { err.textContent = e.message || String(e); } };

  const move = (i, d) => guard(async () => {
    const a = rows[i], b = rows[i + d];
    await store.importRows({ nicknames: [{ ...a, sort_order: b.sort_order }, { ...b, sort_order: a.sort_order }] });
    redraw();
  });
  const list = h('div', { id: 'nick-list' }, rows.map((n, i) => h('div', { class: 'nick-row', 'data-nick': n.name },
    h('span', { class: 'nick-name' }, n.name),
    h('button', { 'aria-label': 'Move up ' + n.name, disabled: i === 0, onclick: move(i, -1) }, '↑'),
    h('button', { 'aria-label': 'Move down ' + n.name, disabled: i === rows.length - 1, onclick: move(i, 1) }, '↓'),
    h('button', {
      class: 'rename', 'aria-label': 'Rename ' + n.name,
      onclick: guard(async () => {
        const to = prompt('Rename nickname', n.name);
        if (to === null || to.trim() === '' || to.trim() === n.name) return;
        await store.renameNickname(n.name, to);
        try { sessionStorage.setItem('capture.renamed', to.trim()); } catch { /* hint is optional */ }
        redraw();
      }),
    }, 'Rename'),
    h('button', {
      class: 'archive danger', 'aria-label': 'Archive ' + n.name,
      onclick: guard(async () => {
        if (!confirm(`Archive ${n.name}? Past entries keep the name.`)) return;
        await store.archiveNickname(n.name);
        redraw();
      }),
    }, 'Archive'),
  )));
  const addInput = h('input', { id: 'new-nick', type: 'text', maxlength: 24, placeholder: 'New nickname', autocomplete: 'off' });
  const addBtn = h('button', {
    id: 'add-nick',
    onclick: guard(async () => { await store.addNickname(addInput.value); redraw(); }),
  }, 'Add');

  let hint = null;
  try { hint = sessionStorage.getItem('capture.renamed'); sessionStorage.removeItem('capture.renamed'); } catch { /* optional */ }
  const hintEl = hint ? h('p', { class: 'banner', id: 'rename-hint' }, `Renamed to ${hint}. Map the new nickname in Ledger.`) : null;

  // ---- guard + send settings (save on change)
  const words = await store.getSetting('blockedWords');
  const wordsBox = h('textarea', { id: 'blocked', rows: 4, autocapitalize: 'off', spellcheck: 'false' });
  wordsBox.value = (words || []).join('\n');
  wordsBox.addEventListener('change', async () => {
    await store.setSetting('blockedWords', wordsBox.value.split('\n').map((s) => s.trim()).filter(Boolean));
    say('Saved.');
  });
  const strict = h('input', { id: 'strict', type: 'checkbox' });
  strict.checked = !!(await store.getSetting('strictGuard'));
  strict.addEventListener('change', async () => { await store.setSetting('strictGuard', strict.checked); say('Saved.'); });

  const email = h('input', { id: 'work-email', type: 'email', autocomplete: 'off', autocapitalize: 'off', placeholder: 'you@work.example' });
  email.value = (await store.getSetting('workEmail')) || '';
  email.addEventListener('change', async () => { await store.setSetting('workEmail', email.value.trim()); say('Saved.'); });

  const days = h('input', { id: 'window-days', type: 'number', min: 7, max: 31, inputmode: 'numeric' });
  days.value = await store.getSetting('windowDays');
  days.addEventListener('change', async () => {
    const n = Math.min(31, Math.max(7, Math.round(Number(days.value)) || 14));
    days.value = n;
    await store.setSetting('windowDays', n);
    say('Saved.');
  });

  // ---- backup
  const exportBtn = h('button', {
    id: 'export',
    onclick: guard(async () => {
      const now = new Date();
      const all = await store.exportAll();
      const json = JSON.stringify(makeBackup(all, now.toISOString()), null, 2);
      const a = h('a', {
        href: URL.createObjectURL(new Blob([json], { type: 'application/json' })),
        download: `capture-backup-${localDate(now)}.json`,
      });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      await store.setSetting('lastBackupAt', now.toISOString());
      say(`Backup exported (${all.entries.length} entries).`);
    }),
  }, 'Export backup');
  const file = h('input', { id: 'import-file', type: 'file', accept: 'application/json,.json', hidden: true });
  file.addEventListener('change', guard(async () => {
    const f = file.files[0];
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch { throw new Error('This is not a Capture backup file.'); }
    const local = await store.exportAll();
    const merged = mergeBackup(local, data);
    await store.importRows(merged);
    file.value = '';
    say(`Imported ${merged.entries.length} entries, ${merged.nicknames.length} nicknames.`);
  }));
  const importBtn = h('button', { id: 'import', onclick: () => file.click() }, 'Import backup');

  el.append(
    h('h1', {}, 'Settings'),
    note,
    h('h2', {}, 'Nicknames'),
    hintEl, list, err,
    h('div', { class: 'btn-row' }, addInput, addBtn),
    h('h2', {}, 'Blocked words'),
    h('label', { for: 'blocked' }, 'One per line'),
    wordsBox,
    h('p', { class: 'muted small' }, 'Use partial words like Ori* rather than full sensitive names.'),
    h('label', { class: 'radio', for: 'strict' }, strict, 'Strict: refuse to save entries with blocked words'),
    h('h2', {}, 'Sending'),
    h('label', { for: 'work-email' }, 'Work email'), email,
    h('label', { for: 'window-days' }, 'Send window (days, 7 to 31)'), days,
    h('h2', {}, 'Backup'),
    h('div', { class: 'btn-row' }, exportBtn, importBtn), file,
    h('p', {}, h('a', { href: '#/help', id: 'help-link' }, 'Help and setup')),
  );
}
