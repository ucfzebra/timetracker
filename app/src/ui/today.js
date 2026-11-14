import { h, hmm, busy } from './dom.js';
import { parseQuickAdd } from '../core/quickadd.js';
import { dayTotals, homeStats } from '../core/summary.js';
import { todayBanners } from '../core/banners.js';
import { loadSendInput, prepareSend, deliver } from '../send.js';
import { guardDecision } from '../core/guard.js';
import { localDate, weekStart, addDays, toTenths, formatTenths } from '../core/time.js';

let tick = null;
const dismissed = new Set(); // banner kinds dismissed for this session
let flash = null; // one-shot message shown by the next Today render (e.g. after a send)

function stopTick() {
  if (tick) clearInterval(tick);
  tick = null;
}

function elapsed(entry) {
  const [y, mo, d] = entry.date.split('-').map(Number);
  const [hh, mm] = entry.start.split(':').map(Number);
  const secs = Math.max(0, Math.floor((Date.now() - new Date(y, mo - 1, d, hh, mm).getTime()) / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(secs / 3600))}:${p(Math.floor(secs / 60) % 60)}:${p(secs % 60)}`;
}

function firstRun(el, { store, navigate }) {
  const err = h('p', { class: 'error', role: 'alert' });
  const input = h('input', { id: 'first-nick', type: 'text', maxlength: 24, placeholder: 'e.g. Falcon', autocomplete: 'off' });
  const add = busy(async () => {
    try {
      await store.addNickname(input.value);
      await navigate('#/today');
    } catch (e) {
      err.textContent = e.message;
    }
  });
  el.append(h('section', { class: 'card first-run' },
    h('h1', {}, 'Add your first project nickname'),
    h('p', { class: 'muted' }, 'A nickname is a short code name for a project. No real project names or charge numbers on this phone.'),
    h('label', { for: 'first-nick' }, 'Project nickname'),
    input,
    err,
    h('button', { class: 'primary big wide', id: 'first-add', onclick: add }, 'Add'),
  ));
}

export async function render(el, ctx) {
  stopTick();
  const { store, navigate } = ctx;
  const nicks = await store.nicknames();
  if (nicks.length === 0) return firstRun(el, ctx);

  const now = new Date();
  const today = localDate(now);
  const monday = weekStart(today);
  const [todays, weekEntries, run, stale, lastSentAt, weekAckFor, lastBackupAt, recent, sendInput] = await Promise.all([
    store.entriesBetween(today, today),
    store.entriesBetween(monday, addDays(monday, 6)),
    store.running(),
    store.staleTimer(),
    store.getSetting('lastSentAt'),
    store.getSetting('weekAckFor'),
    store.getSetting('lastBackupAt'),
    store.entriesBetween('2000-01-01', '2999-12-31', { includeDeleted: true }),
    loadSendInput(store),
  ]);

  const msg = h('p', { class: 'error', role: 'alert' });
  const fail = (e) => { msg.textContent = e.message || String(e); };
  const refresh = () => navigate('#/today');

  // A timer left running > 10 h is never stopped silently: open Edit to set the real end.
  const staleGuard = async () => {
    const s = await store.staleTimer();
    if (!s) return false;
    try {
      sessionStorage.setItem('capture.editNote', `This timer has been running ${Math.floor(s.hours)} h — set the real end time.`);
    } catch { /* note is optional */ }
    await navigate('#/edit/' + encodeURIComponent(s.entry.entry_id));
    return true;
  };
  // Blocked words in a new timer's task/note: ask first, or refuse in strict mode.
  const wordsOk = async (taskText, noteText) => {
    const [words, strict] = await Promise.all([store.getSetting('blockedWords'), store.getSetting('strictGuard')]);
    const d = guardDecision(`${taskText} ${noteText}`, words, strict);
    if (d.action === 'ok') return true;
    const quoted = d.hits.map((w) => `"${w}"`).join(', ');
    const what = `${quoted} ${d.hits.length > 1 ? 'are' : 'is'} on your blocked word list.`;
    if (d.action === 'refuse') throw new Error(`${what} Edit before starting.`);
    return confirm(`${what} Start anyway?`);
  };

  // ---- banners
  const LABEL = { stale: 'HEADS UP', unsent: 'NOT SENT', week: 'TIMECARD', backup: 'BACKUP' };
  const banners = h('div', { id: 'banners' });
  for (const b of todayBanners({ now, lastSentAt, weekAckFor, entries: recent, stale, lastBackupAt })) {
    if (dismissed.has(b.kind)) continue;
    const box = h('div', { class: 'banner banner-' + b.kind, role: 'status' },
      h('span', { class: 'banner-label' }, LABEL[b.kind] || 'HEADS UP'),
      h('span', { class: 'banner-text' }, b.text));
    if (b.kind === 'stale') {
      box.append(h('button', { onclick: () => navigate('#/edit/' + encodeURIComponent(b.entryId)) }, 'Set end time'));
    }
    if (b.kind === 'week') {
      box.append(h('button', {
        class: 'primary',
        onclick: busy(async () => { await store.setSetting('weekAckFor', weekStart(today)); await refresh(); }),
      }, 'Week submitted ✓'));
    }
    if (b.kind === 'backup') box.append(h('a', { href: '#/settings' }, 'Settings'));
    box.append(h('button', {
      class: 'banner-x', 'aria-label': 'Dismiss',
      onclick: () => { dismissed.add(b.kind); box.remove(); },
    }, '×'));
    banners.append(box);
  }

  // ---- stats card
  const st = homeStats(weekEntries, today);
  const bar = (done, value, max, label) => h('progress', { class: done ? 'bar done' : 'bar', max, value: Math.min(value, max), 'aria-label': label });
  const doneWord = h('span', { class: 'done-word' }, '✓ Done');
  const dayStat = h('div', { class: 'stat', id: 'stat-today' },
    h('div', { class: 'stat-label' }, 'TODAY'),
    h('div', { class: 'stat-big mono' }, h('span', { id: 'stat-today-h' }, formatTenths(st.day.tenths)), h('span', { class: 'unit' }, ' h')),
    st.day.dayOff
      ? h('div', { class: 'stat-sub', id: 'stat-today-sub' }, 'Day off')
      : h('div', { class: 'stat-sub', id: 'stat-today-sub' }, h('span', { class: 'mono' }, `of ${formatTenths(st.day.expected)}`), ' · ',
        st.day.done ? doneWord : h('span', { class: 'mono' }, `${st.day.pct}%`)),
    st.day.dayOff ? null : bar(st.day.done, st.day.tenths, st.day.expected, 'Today progress'));
  const weekStat = h('div', { class: 'stat', id: 'stat-week' },
    h('div', { class: 'stat-label' }, 'THIS WEEK'),
    h('div', { class: 'stat-big mono' }, h('span', { id: 'stat-week-h' }, formatTenths(st.week.tenths))),
    h('div', { class: 'stat-sub' }, h('span', { class: 'mono' }, `/ ${formatTenths(st.week.expected)} h`), ' · ',
      st.week.done ? doneWord.cloneNode(true) : h('span', { class: 'mono' }, `${st.week.pct}%`)),
    bar(st.week.done, st.week.tenths, st.week.expected, 'Week progress'));
  const stats = h('section', { class: 'stats', id: 'stats', 'aria-label': 'Hours' }, dayStat, weekStat);

  // ---- timer fields
  const sel = h('select', { id: 'nick' }, nicks.map((n) => h('option', { value: n }, n)));
  if (run && nicks.includes(run.nickname)) sel.value = run.nickname;
  const task = h('input', { id: 'task', type: 'text', maxlength: 60, list: 'tasks', placeholder: 'What are you working on?', autocomplete: 'off' });
  const note = h('input', { id: 'note', type: 'text', maxlength: 200, placeholder: 'Optional note', autocomplete: 'off' });
  const tasks = h('datalist', { id: 'tasks' });
  const loadTasks = async () => {
    const list = await store.recentTasks(sel.value);
    tasks.replaceChildren(...list.map((t) => h('option', { value: t })));
  };
  sel.addEventListener('change', loadTasks);
  loadTasks();
  const fields = h('div', { class: 'start-fields', id: 'start-fields' },
    h('label', { for: 'nick' }, 'Project'), sel,
    h('label', { for: 'task' }, 'Task'), task, tasks,
    h('label', { for: 'note' }, 'Note'), note);

  // fn returns false when it navigated elsewhere or was cancelled (no refresh then).
  const act = (fn) => busy(async () => {
    msg.textContent = '';
    try {
      if ((await fn()) !== false) await refresh();
    } catch (e) { fail(e); }
  });
  const startFromForm = async () => {
    if (await staleGuard()) return false;
    const t = task.value.trim(), d = note.value.trim();
    if (!(await wordsOk(t, d))) return false;
    await store.startTimer(sel.value, t, d);
    return true;
  };

  // ---- timer card
  let timerCard;
  if (run) {
    const clock = h('div', { class: 'clock mono', id: 'clock', role: 'timer' }, elapsed(run));
    fields.hidden = true;
    // SWITCH TASK = stop this timer and start the one in the fields. With no task typed
    // yet it only reveals the fields, so a stray tap never switches to an empty task.
    const switchTask = async () => {
      if (fields.hidden || !task.value.trim()) {
        fields.hidden = false;
        task.focus();
        return false;
      }
      return startFromForm();
    };
    timerCard = h('section', { class: 'card timer is-running', id: 'running' },
      h('div', { class: 'run-label' }, h('span', { class: 'dot', 'aria-hidden': 'true' }, '●'), ' RUNNING'),
      h('div', { class: 'run-what' }, h('span', { class: 'run-nick' }, run.nickname), ' · ', h('span', { id: 'run-task' }, run.task || '(no task)')),
      clock,
      fields,
      h('div', { class: 'timer-btns' },
        h('button', {
          id: 'stop', class: 'primary big',
          onclick: act(async () => {
            if (await staleGuard()) return false;
            await store.stopTimer();
            return true;
          }),
        }, 'STOP'),
        h('button', { id: 'switch', class: 'steel big', onclick: act(switchTask) }, 'SWITCH TASK')),
      msg,
    );
    // Each interval clears only itself, so a superseded render can never stop the
    // clock of the screen that replaced it.
    const stale = () => (ctx.isCurrent ? !ctx.isCurrent() : !clock.isConnected);
    if (!stale()) {
      const id = setInterval(() => {
        if (stale()) {
          clearInterval(id);
          if (tick === id) tick = null;
          return;
        }
        clock.textContent = elapsed(run);
      }, 1000);
      tick = id;
    }
  } else {
    timerCard = h('section', { class: 'card timer', id: 'timer' },
      fields,
      h('button', { class: 'primary big wide', id: 'start', onclick: act(startFromForm) }, 'START'),
      msg,
    );
  }

  // ---- quick add
  const quick = h('input', { id: 'quick', class: 'quick', type: 'text', placeholder: 'Quick add: Falcon review 9 to 11:45', autocomplete: 'off', enterkeyhint: 'go', 'aria-label': 'Quick add', 'aria-describedby': 'quick-hint' });
  let quickBusy = false;
  const quickGo = async () => {
    if (quickBusy) return;
    msg.textContent = '';
    const text = quick.value.trim();
    if (!text) return;
    quickBusy = true;
    quick.disabled = true;
    const p = parseQuickAdd(text, { nicknames: nicks, today });
    try {
      if (p.action === 'stop') {
        if (!run) throw new Error('No timer is running.');
        if (!confirm(`Stop the timer on ${run.nickname}?`)) return;
        if (await staleGuard()) return;
        await store.stopTimer();
        await refresh();
      } else if (p.action === 'start' || p.action === 'switch') {
        if (!p.nickname) throw new Error('Nickname not recognised. Say it first, e.g. "start Falcon design review".');
        if (!confirm(`${p.action === 'start' ? 'Start' : 'Switch to'} ${p.nickname}: ${p.task || '(no task)'}?`)) return;
        if (await staleGuard()) return;
        if (!(await wordsOk(p.task || '', p.description || ''))) return;
        await store.startTimer(p.nickname, p.task, p.description);
        await refresh();
      } else {
        sessionStorage.setItem('capture.prefill', JSON.stringify(p));
        await navigate('#/edit/new');
      }
    } catch (e) {
      fail(e);
    } finally {
      quickBusy = false;
      quick.disabled = false;
    }
  };
  quick.addEventListener('keydown', (e) => { if (e.key === 'Enter') quickGo(); });

  const manualBtn = h('button', {
    id: 'manual', class: 'tall',
    onclick: () => {
      sessionStorage.setItem('capture.prefill', JSON.stringify({
        nickname: sel.value, task: task.value.trim(), description: note.value.trim(), date: today,
      }));
      navigate('#/edit/new');
    },
  }, '+ Add task');

  // ---- add project (a nickname) inline
  const projErr = h('p', { class: 'error', role: 'alert', id: 'project-err' });
  const projInput = h('input', { id: 'new-project', type: 'text', maxlength: 24, placeholder: 'e.g. Heron', autocomplete: 'off', enterkeyhint: 'done' });
  const addProject = busy(async () => {
    projErr.textContent = '';
    try {
      const row = await store.addNickname(projInput.value);
      // No re-render: keep whatever is typed in Task/Note and any revealed fields.
      if (!nicks.includes(row.name)) {
        nicks.push(row.name);
        sel.append(h('option', { value: row.name }, row.name));
      }
      sel.value = row.name;
      loadTasks();
      projInput.value = '';
      projForm.hidden = true;
      projectBtn.setAttribute('aria-expanded', 'false');
    } catch (e) {
      projErr.textContent = e.message || String(e);
    }
  });
  projInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addProject({ currentTarget: null }); });
  const projForm = h('div', { class: 'card project-form', id: 'project-form', hidden: true },
    h('label', { for: 'new-project' }, 'Project nickname'),
    h('div', { class: 'inline' }, projInput, h('button', { id: 'add-project-go', class: 'steel', onclick: addProject }, 'Add')),
    projErr);
  const projectBtn = h('button', {
    id: 'add-project', class: 'tall', 'aria-controls': 'project-form', 'aria-expanded': 'false',
    onclick: (ev) => {
      projForm.hidden = !projForm.hidden;
      ev.currentTarget.setAttribute('aria-expanded', String(!projForm.hidden));
      if (!projForm.hidden) projInput.focus();
    },
  }, '+ Add project');

  // ---- list
  const totals = dayTotals(todays, today);
  const sorted = [...todays].sort((a, b) => {
    if (!!a.start !== !!b.start) return a.start ? -1 : 1;
    return a.start === b.start ? (a.updated_at < b.updated_at ? 1 : -1) : a.start < b.start ? 1 : -1;
  });
  const list = h('div', { id: 'entries' });
  for (const e of sorted) {
    const isRun = e.start && !e.end;
    const when = isRun ? `${e.start}– now` : e.start ? `${e.start}–${e.end}` : `${hmm(e.duration_min)} (dur)`;
    list.append(h('a', { class: 'entry', href: '#/edit/' + encodeURIComponent(e.entry_id) },
      h('span', { class: 'when mono' }, when),
      h('span', { class: 'nick tag' }, e.nickname),
      h('span', { class: 'tenths mono' }, isRun ? '' : formatTenths(toTenths(e.duration_min))),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
      h('span', { class: 'etask' }, e.task || '(no task)'),
    ));
  }
  if (!sorted.length) list.append(h('p', { class: 'muted' }, 'Nothing logged today yet.'));

  const sendOut = h('div', { id: 'send-out', role: 'status' });
  if (flash) {
    sendOut.append(h('p', { class: 'banner', id: flash.id }, flash.text));
    flash = null;
  }
  // The email is built synchronously from data loaded during render, so navigator.share
  // (or the mailto link) runs inside the tap's user activation.
  const doSend = (method) => busy(async () => {
    sendOut.replaceChildren();
    try {
      const prep = prepareSend(sendInput, { today, now: new Date() });
      if (prep.reason === 'no-email') {
        sendOut.append(h('p', { class: 'error', id: 'send-err' }, 'Set your work email in Settings'));
        return;
      }
      if (prep.blocked) {
        sendOut.append(h('div', { class: 'warn', id: 'send-blocked' },
          h('p', {}, 'Blocked words found. Fix these entries, then send again:'),
          prep.blocked.map((e) => h('p', {}, h('a', { href: '#/edit/' + encodeURIComponent(e.entry_id) }, `${e.date} ${e.nickname}: ${e.task || e.description}`)))));
        return;
      }
      const r = await deliver(store, prep, { method });
      if (r.ok) {
        flash = { id: 'send-ok', text: `Sent ${r.count} entries (${r.method === 'share' ? 'shared with attachment' : 'email'}).` };
        await refresh(); // banners (last sent) refresh
      } else if (r.reason === 'cancelled') {
        sendOut.append(h('p', { class: 'muted', id: 'send-cancel' }, 'Send cancelled'));
      }
    } catch (e) {
      sendOut.append(h('p', { class: 'error', role: 'alert' }, e.message || String(e)));
    }
  });
  const sendBtn = h('button', { id: 'send', onclick: doSend('mailto') }, 'Send');
  const shareBtn = h('button', { id: 'share', onclick: doSend('share') }, 'Share with attachment');

  el.append(
    banners,
    stats,
    timerCard,
    h('section', { class: 'quick-box' },
      quick,
      h('p', { class: 'muted small', id: 'quick-hint' }, 'Tap the keyboard mic to dictate'),
      h('div', { class: 'btn-row' }, manualBtn, projectBtn),
      projForm),
    h('div', { class: 'btn-row send-row' }, sendBtn, shareBtn),
    sendOut,
    h('div', { class: 'section-head' }, h('h2', {}, 'Today'), h('span', { id: 'day-total', class: 'day-total mono' }, formatTenths(totals.totalTenths) + ' h')),
    list,
  );
}
