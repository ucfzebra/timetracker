import { h, hmm, prettyDate, busy } from './dom.js';
import { parseQuickAdd } from '../core/quickadd.js';
import { dayTotals } from '../core/summary.js';
import { todayBanners } from '../core/banners.js';
import { loadSendInput, prepareSend, deliver } from '../send.js';
import { guardDecision } from '../core/guard.js';
import { localDate, weekStart, toTenths, formatTenths } from '../core/time.js';

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
  el.append(
    h('h1', {}, 'Add your first nickname'),
    h('p', { class: 'muted' }, 'A nickname is a short code name for a project. No real project names or charge numbers on this phone.'),
    h('label', { for: 'first-nick' }, 'Nickname'),
    input,
    err,
    h('p', {}, h('button', { class: 'primary', id: 'first-add', onclick: add }, 'Add')),
  );
}

export async function render(el, ctx) {
  stopTick();
  const { store, navigate } = ctx;
  const nicks = await store.nicknames();
  if (nicks.length === 0) return firstRun(el, ctx);

  const now = new Date();
  const today = localDate(now);
  const [todays, run, stale, lastSentAt, weekAckFor, lastBackupAt, recent, sendInput] = await Promise.all([
    store.entriesBetween(today, today),
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
  const banners = h('div', { id: 'banners' });
  for (const b of todayBanners({ now, lastSentAt, weekAckFor, entries: recent, stale, lastBackupAt })) {
    if (dismissed.has(b.kind)) continue;
    const box = h('div', { class: 'banner banner-' + b.kind, role: 'status' }, h('span', { class: 'banner-text' }, b.text));
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

  // ---- form
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
  const startBtn = h('button', { class: 'primary', id: 'start', onclick: act(startFromForm) }, '▶ Start timer');
  const manualBtn = h('button', {
    id: 'manual',
    onclick: () => {
      sessionStorage.setItem('capture.prefill', JSON.stringify({
        nickname: sel.value, task: task.value.trim(), description: note.value.trim(), date: today,
      }));
      navigate('#/edit/new');
    },
  }, '+ Manual');

  // ---- running card
  let runCard = null;
  if (run) {
    const clock = h('span', { class: 'clock', id: 'clock' }, elapsed(run));
    runCard = h('div', { class: 'card running', id: 'running' },
      h('div', {}, h('strong', {}, '● RUNNING '), run.nickname),
      h('div', { class: 'run-line' }, h('span', { id: 'run-task' }, run.task || '(no task)'), clock),
      h('div', { class: 'btn-row' },
        h('button', {
          id: 'stop', class: 'primary',
          onclick: act(async () => {
            if (await staleGuard()) return false;
            await store.stopTimer();
            return true;
          }),
        }, '■ Stop'),
        h('button', { id: 'switch', onclick: act(startFromForm) }, '⇄ Switch')),
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
  }

  // ---- quick add
  const quick = h('input', { id: 'quick', type: 'text', placeholder: 'e.g. Falcon design review 9 to 11:45', autocomplete: 'off', enterkeyhint: 'go' });
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
      h('span', { class: 'when' }, when),
      h('span', { class: 'nick' }, e.nickname),
      h('span', { class: 'tenths' }, isRun ? '' : formatTenths(toTenths(e.duration_min))),
      h('span', { class: 'chev' }, '›'),
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
  const sendBtn = h('button', { id: 'send', class: 'primary', onclick: doSend('mailto') }, '⇪ Send');
  const shareBtn = h('button', { id: 'share', onclick: doSend('share') }, 'Share with attachment');

  el.append(
    h('header', { class: 'top' }, h('h1', {}, prettyDate(today)), sendBtn),
    h('div', { class: 'share-row' }, shareBtn),
    sendOut,
    banners,
    runCard,
    h('div', { class: 'card' },
      h('label', { for: 'quick' }, 'Quick add'),
      quick,
      h('p', { class: 'muted small' }, '🎤 tap the keyboard mic to dictate, then press go.'),
    ),
    h('label', { for: 'nick' }, 'Nickname'), sel,
    h('label', { for: 'task' }, 'Task'), task, tasks,
    h('label', { for: 'note' }, 'Note'), note,
    msg,
    h('div', { class: 'btn-row' }, startBtn, manualBtn),
    h('div', { class: 'section-head' }, h('h2', {}, 'TODAY'), h('span', { id: 'day-total', class: 'day-total' }, formatTenths(totals.totalTenths) + ' h')),
    list,
  );
}
