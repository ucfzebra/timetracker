# Capture (Phone App) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "Capture", an offline home-screen web app for iPhone (and any browser) that logs time against nicknames and sends one-tap email batches to the work inbox in the v1 email contract.

**Architecture:** Static files with no build step (ES modules). The logic lives in pure modules (`app/src/core/*`) that are unit-tested with Node's built-in test runner. Storage is IndexedDB behind a small store interface; an in-memory version of the same interface is used for tests. The UI is plain DOM modules per screen. A service worker caches the app shell so it works offline.

**Tech Stack:** HTML/CSS/vanilla JS (ES2022 modules), IndexedDB, Service Worker, Web Share API (`mailto:` fallback), `node --test` (Node 22) for unit tests, the pre-installed Playwright (library mode, Chromium) for one smoke test.

**Spec:** `docs/superpowers/specs/2026-11-13-timetracker-design.md` (§5.1, §5.3, §6, §6.6, §7, §9, §10a phone side). The quick-add test table is shared with `docs/work-side/IMPLEMENTATION_PROMPT.md`.

## Global Constraints

- The phone stores **no real program names, customer names or charge numbers**. Only nicknames, task, description and times.
- No network calls except loading the app's own static files. No analytics, no CDN, no fonts from the web.
- Email contract is fixed: subject `[TT] <YYYY-MM-DD> batch <NNNN> (<n> entries)`; body markers `-----BEGIN TT CSV v1-----` / `-----END TT CSV v1-----`; header `entry_id,nickname,date,start,end,duration_min,task,description,source,updated_at,deleted`; attachment `tt-<YYYY-MM-DD>-<NNNN>.csv`; UTF-8, RFC 4180.
- Send window default **14 days**, including tombstones (`deleted=1`).
- Field limits: nickname ≤ 24, task ≤ 60, description ≤ 200 characters.
- Tenths: `tenths = floor((minutes + 3) / 6)`, integer maths only. Phone totals are a preview, rounded per day per nickname.
- Week starts **Monday**. Workdays **Mon–Thu**, expected **10.0 h** per day.
- Midnight crossing: `end < start` → `(end + 24h) − start`, and the entry counts on `date`.
- Quick-add hours without am/pm: **7–11 → am, 12–6 → pm**.
- `source` = `phone` when running as an installed home-screen app (`display-mode: standalone`), otherwise `web`.
- Works offline after the first load. Target iOS Safari 17+.

## Review Focus

1. **Timer left running overnight or for days.** The user expects a prompt (>10 h) with a suggested end time, never a 30-hour entry sent silently. Test in Task 4.
2. **Safari clears the data** (evicted storage or a cleared website cache). The user expects a "last backup N days ago" warning and a working restore. Test in Task 9.
3. **An entry edited or deleted after it was sent.** The user expects the next send to carry the change (`updated_at` bumped, tombstone kept within the window). Test in Task 4.
4. **A nickname renamed.** The user expects old entries to keep the old nickname (which is already mapped at work), new entries to use the new one, and a hint to map the new nickname in Ledger. Test in Task 4.
5. **Description with commas, quotes, newlines or emoji.** The user expects an exact round-trip through the CSV. Test in Task 3.

---

## File Structure

```
app/
  index.html               app shell, <nav>, <main id="view">
  styles.css
  manifest.webmanifest     name "Capture", display standalone, icons
  sw.js                    cache-first app shell, versioned cache name
  icons/icon-192.png, icon-512.png, apple-touch-icon.png
  src/
    core/time.js           time + rounding maths (pure)
    core/csv.js            CSV encode/decode + email builder (pure)
    core/guard.js          blocked-word matching (pure)
    core/quickadd.js       sentence parser (pure)
    core/summary.js        day/week aggregation (pure)
    core/ids.js            uuid(), nowIso()
    store/store.js         store API over a backend (timer, entries, nicknames, settings)
    store/memory.js        in-memory backend (tests)
    store/idb.js           IndexedDB backend
    send.js                Web Share / mailto
    ui/today.js, ui/edit.js, ui/week.js, ui/settings.js, ui/help.js
    app.js                 boot, hash router, SW registration
tests/
  time.test.js, csv.test.js, guard.test.js, quickadd.test.js,
  summary.test.js, store.test.js, smoke.mjs
package.json               scripts: test, smoke, serve
```

---

### Task 1: Scaffold, time maths and rounding

**Files:**
- Create: `package.json`, `app/src/core/time.js`, `app/src/core/ids.js`, `tests/time.test.js`, `.gitignore`

**Interfaces:**
- Produces:
  - `parseHHMM(s: string) -> number|null` (minutes since midnight; `"09:00"`→540, invalid→null)
  - `formatHHMM(min: number) -> string`
  - `durationMinutes(start: string, end: string) -> number` (midnight wrap)
  - `toTenths(minutes: number) -> number` (integer tenths)
  - `formatTenths(tenths: number) -> string` (`27`→`"2.7"`, `0`→`"0.0"`)
  - `localDate(d: Date) -> "YYYY-MM-DD"`, `addDays(date: string, n: number) -> string`, `weekStart(date: string) -> string` (Monday)
  - `uuid() -> string` (`crypto.randomUUID`), `nowIso() -> string`

- [ ] **Step 1: Write `package.json`** with `"type":"module"` and scripts `"test": "node --test tests/"`, `"smoke": "node tests/smoke.mjs"`, `"serve": "python3 -m http.server 8080 -d app"`. No dependencies.
- [ ] **Step 2: Write failing tests** in `tests/time.test.js`:

```js
const table = [[0,0],[2,0],[3,1],[8,1],[9,2],[54,9],[72,12],[162,27],[165,28],[480,80],[600,100]];
for (const [m,t] of table) test(`tenths ${m}`, () => assert.equal(toTenths(m), t));
test('format', () => { assert.equal(formatTenths(27),'2.7'); assert.equal(formatTenths(100),'10.0'); });
test('duration', () => assert.equal(durationMinutes('09:00','11:45'), 165));
test('midnight', () => assert.equal(durationMinutes('22:30','01:15'), 165));
test('equal times', () => assert.equal(durationMinutes('09:00','09:00'), 0));
test('bad', () => assert.equal(parseHHMM('25:00'), null));
test('weekStart', () => { assert.equal(weekStart('2026-11-13'),'2026-11-09'); assert.equal(weekStart('2026-11-09'),'2026-11-09'); assert.equal(weekStart('2026-11-15'),'2026-11-09'); });
test('addDays across month', () => assert.equal(addDays('2026-10-31', 1), '2026-11-01'));
```
- [ ] **Step 3:** Run `npm test` and expect failures (module not found).
- [ ] **Step 4:** Implement `time.js` and `ids.js`. Date maths works on `YYYY-MM-DD` strings via `Date.UTC`, so DST never shifts a date.
- [ ] **Step 5:** Run `npm test` and expect all pass.
- [ ] **Step 6:** Commit `feat: time maths and rounding`.

### Task 2: Blocked-word guard

**Files:**
- Create: `app/src/core/guard.js`, `tests/guard.test.js`

**Interfaces:**
- Produces: `findBlocked(text: string, words: string[]) -> string[]` (the list entries that matched, de-duplicated). Matching is case-insensitive and whole-word. An entry ending in `*` is a prefix match (`Ori*` matches `Orion`, `orbital` does not). Entries are regex-escaped.

- [ ] **Step 1: Failing tests:**

```js
assert.deepEqual(findBlocked('Orion review', ['orion']), ['orion']);
assert.deepEqual(findBlocked('horizon', ['orion']), []);            // whole word only
assert.deepEqual(findBlocked('ORIONX build', ['Ori*']), ['Ori*']);
assert.deepEqual(findBlocked('a.b fix', ['a.b']), ['a.b']);          // escaped
assert.deepEqual(findBlocked('anything', []), []);
assert.deepEqual(findBlocked('Orion and orion', ['Orion']), ['Orion']);
```
- [ ] **Step 2:** Run, expect fail. **Step 3:** Implement. **Step 4:** Run, expect pass. **Step 5:** Commit `feat: blocked-word guard`.

### Task 3: CSV and email builder

**Files:**
- Create: `app/src/core/csv.js`, `tests/csv.test.js`

**Interfaces:**
- Consumes: `formatTenths`, `toTenths` (Task 1).
- Produces:
  - `CSV_HEADER: string[]` (the 11 contract columns in order)
  - `toCsv(entries: Entry[]) -> string` (CRLF line endings, quote a field when it contains `,` `"` CR or LF, double up `"`; `deleted` written as `0/1`)
  - `parseCsv(text: string) -> object[]` (RFC 4180, for tests and backup import)
  - `buildEmail(entries: Entry[], {today, batch, windowDays, generatedAt, to}) -> {to, subject, body, filename, csv}`
  - `Entry` = `{entry_id, nickname, date, start, end, duration_min, task, description, source, updated_at, deleted}`

- [ ] **Step 1: Failing tests:**

```js
const e = {entry_id:'id1',nickname:'Falcon',date:'2026-11-13',start:'12:30',end:'13:42',duration_min:72,
  task:'Design review',description:'rev "B", pkg\nline2 ✓',source:'phone',updated_at:'2026-11-13T18:43:10Z',deleted:false};
test('round trip', () => assert.deepEqual(parseCsv(toCsv([e]))[0].description, e.description));
test('header', () => assert.equal(toCsv([]).split('\r\n')[0], CSV_HEADER.join(',')));
test('email', () => {
  const m = buildEmail([e], {today:'2026-11-13', batch:42, windowDays:14, generatedAt:'2026-11-13 17:02', to:'me@work'});
  assert.equal(m.subject, '[TT] 2026-11-13 batch 0042 (1 entries)');
  assert.equal(m.filename, 'tt-2026-11-13-0042.csv');
  assert.match(m.body, /-----BEGIN TT CSV v1-----\r?\n[\s\S]*-----END TT CSV v1-----/);
  assert.match(m.body, /window 2026-10-31\.\.2026-11-13/);
  assert.ok(m.body.includes(m.csv.trim()));
});
test('tombstone', () => assert.match(toCsv([{...e, deleted:true}]), /,1\r?\n?$/));
```
- [ ] **Step 2:** Run, expect fail. **Step 3:** Implement. The body starts with a short human summary: one line per nickname with total hours for the window. **Step 4:** Run, expect pass. **Step 5:** Commit `feat: csv + email contract`.

### Task 4: Store, timer and entries

**Files:**
- Create: `app/src/store/store.js`, `app/src/store/memory.js`, `tests/store.test.js`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: `createStore(backend, {now: () => Date, source: 'phone'|'web'}) -> Store`, where a backend has `get(table,key)`, `put(table,obj)`, `all(table)` over tables `entries`, `nicknames`, `settings`. `createMemoryBackend()` returns one.
- `Store` methods (all async):
  - `addEntry({nickname,date,start,end,duration_min,task,description}) -> Entry` (computes `duration_min` from start/end when both are given; stamps `entry_id`, `source`, `updated_at`)
  - `updateEntry(id, patch) -> Entry` (recomputes duration, bumps `updated_at`)
  - `deleteEntry(id)` (tombstone: `deleted=true`, bumps `updated_at`)
  - `entriesBetween(from, to, {includeDeleted}) -> Entry[]` (sorted by date, then start)
  - `running() -> Entry|null` (an entry with `start` set and `end` empty, not deleted)
  - `startTimer(nickname, task, description) -> Entry` (stops any running one first)
  - `stopTimer() -> Entry|null` (sets `end`, computes duration)
  - `switchTimer(nickname, task, description) -> Entry`
  - `staleTimer() -> {entry, hours}|null` (running for more than 10 h)
  - `nicknames() / addNickname(name) / renameNickname(old,new) / archiveNickname(name)`
  - `getSetting(key, default) / setSetting(key, value)`, keys `workEmail`, `blockedWords`, `strictGuard`, `windowDays`(14), `batch`(0), `lastSentAt`, `lastBackupAt`, `weekAckFor`
  - `recentTasks(nickname, limit=8) -> string[]`

- [ ] **Step 1: Failing tests** (fake clock via `now`):
  - `startTimer` then `switchTimer` → the first entry has an `end` and the second is running. Only ever one running.
  - Timer started at 23:30 and stopped at 00:45 the next day → `duration_min` 75, `date` = the start date.
  - A timer started 11 h ago → `staleTimer().hours >= 10`.
  - `updateEntry` after a send → `updated_at` is later than before. `deleteEntry` → `entriesBetween(..., {includeDeleted:true})` contains it with `deleted:true`, and the default call excludes it.
  - `renameNickname('Falcon','Hawk')` → existing entries still say `Falcon`, `nicknames()` lists `Hawk`, and `Falcon` is not listed as active.
  - `addEntry` with a 61-character task → throws `RangeError`.
- [ ] **Step 2:** Run, expect fail. **Step 3:** Implement `store.js` and `memory.js`. **Step 4:** Run, expect pass. **Step 5:** Commit `feat: store and timer`.

### Task 5: Quick-add parser

**Files:**
- Create: `app/src/core/quickadd.js`, `tests/quickadd.test.js`

**Interfaces:**
- Consumes: `parseHHMM`, `durationMinutes`, `addDays` (Task 1).
- Produces: `parseQuickAdd(text: string, {nicknames: string[], today: 'YYYY-MM-DD'}) -> {action:'add'|'start'|'switch'|'stop', nickname: string|null, nicknameMatched: boolean, task: string, description: string, date: string, start: string, end: string, duration_min: number|null}`

- [ ] **Step 1: Failing tests:** the exact table from the work prompt, with `today:'2026-11-13'` and nicknames `['Falcon','Heron','Admin','Kestrel']`:

| Input | Expected |
|---|---|
| `Falcon design review 9 to 11:45` | Falcon, `design review`, 09:00–11:45, 165, 2026-11-13 |
| `Heron test procedure for 45 minutes` | Heron, `test procedure`, 45 |
| `Admin training an hour and a half yesterday` | Admin, `training`, 90, 2026-11-12 |
| `falcons design review 1 to 2:30 note rev B` | Falcon, 13:00–14:30, description `rev B` |
| `switch to Heron drawing check` | action switch, Heron, `drawing check` |
| `stop` | action stop |
| `Kestral sync for 30 min` | Kestrel, `sync`, 30 |
| `Zebra thing for 10 min` | nickname null, nicknameMatched false, task `Zebra thing`, 10 |

  Plus: `Falcon review 9:30 am to noon` → 09:30–12:00. `Heron fix for 2 hours 15` → 135. `Falcon x 930 to 1015` → 09:30–10:15. `Admin y monday for 1.5 hours` → date 2026-11-09. `Falcon z nine thirty to eleven` → 09:30–11:00.
- [ ] **Step 2:** Run, expect fail.
- [ ] **Step 3:** Implement as a token pipeline, in this order: pull `note …` off the end, then the action verb, then the day word, then the time range (`<t> to <t>`) or duration (`for <d>`), then the nickname (the first token, matched case-insensitively after stripping a trailing `'s`/`s`, or with edit distance ≤ 1 for names of 5+ characters), then the task (the remaining tokens). Number words are limited to one–twelve, fifteen, thirty, forty-five.
- [ ] **Step 4:** Run, expect pass. **Step 5:** Commit `feat: quick-add parser`.

### Task 6: Summary aggregation

**Files:**
- Create: `app/src/core/summary.js`, `tests/summary.test.js`

**Interfaces:**
- Consumes: `toTenths`, `weekStart`, `addDays`.
- Produces:
  - `dayTotals(entries, date) -> {rows:[{nickname, minutes, tenths}], totalTenths}` (rounded per nickname, total = sum of rounded values)
  - `weekGrid(entries, anyDate) -> {days: string[7], rows:[{nickname, perDay: number[7] (tenths), total}], dayTotals: number[7], total, expected: 400}`. Expected = 100 tenths × Mon–Thu.

- [ ] **Step 1: Failing tests:** two Falcon entries of 90 and 72 min on the same day → 27 tenths. Two entries of 4 min → 1 (not 2). Deleted entries are ignored. The week grid for 2026-11-13 has `days[0]==='2026-11-09'` and `expected===400`.
- [ ] **Step 2–4:** Fail, implement, pass. **Step 5:** Commit `feat: summaries`.

### Task 7: IndexedDB backend, app shell, service worker

**Files:**
- Create: `app/src/store/idb.js`, `app/index.html`, `app/styles.css`, `app/manifest.webmanifest`, `app/sw.js`, `app/icons/*`, `app/src/app.js`

**Interfaces:**
- Consumes: the backend contract from Task 4.
- Produces: `openIdbBackend(name='capture', version=1) -> Promise<Backend>`, with object stores `entries` (keyPath `entry_id`, index `date`), `nicknames` (keyPath `name`), `settings` (keyPath `key`). `app.js` exports nothing. It boots the store, registers `sw.js`, and routes `#/today` (default), `#/edit/:id`, `#/week`, `#/settings`, `#/help`.

- [ ] **Step 1:** Implement `idb.js` and call `navigator.storage.persist()` at boot.
- [ ] **Step 2:** Shell: a bottom nav with Today / Week / Settings, safe-area padding, light and dark colour schemes, and a mobile viewport. Manifest `display: standalone`, `start_url: "./#/today"`. Generate icons with Python (Pillow if available, otherwise a plain PNG writer): solid colour with a "T".
- [ ] **Step 3:** `sw.js` caches the shell under `capture-v1` and serves it cache-first. Bump the version on every release.
- [ ] **Step 4:** Verify: `npm run serve`, open `http://localhost:8080` with Playwright, and confirm no console errors and that the service worker is registered. Expected: the script prints `ok`.
- [ ] **Step 5:** Commit `feat: app shell, idb, offline`.

### Task 8: Today, Edit and Week screens

**Files:**
- Create: `app/src/ui/today.js`, `app/src/ui/edit.js`, `app/src/ui/week.js`

**Interfaces:**
- Consumes: `Store` (Task 4), `parseQuickAdd` (Task 5), `findBlocked` (Task 2), `dayTotals` / `weekGrid` (Task 6).
- Produces: each module exports `render(el: HTMLElement, ctx: {store, navigate}) -> void`.

- [ ] **Step 1: Today.** Lay it out as in spec §6.2:
  - running card with live seconds plus Stop and Switch
  - Quick add input with a hint that says "🎤 tap the keyboard mic"
  - nickname select, task input with a `<datalist>` of `recentTasks`, note input
  - Start timer and + Manual buttons
  - today's list with the day total
  - banners: stale timer (offers to set the end time), unsent entries after 16:30 on a workday, the Thu–Sun "Week submitted?" button, which sets `weekAckFor` to the current week and hides the week banner until Monday

  Quick add opens Edit, pre-filled, for confirmation. `start`/`switch`/`stop` actions show a one-line confirm, then act.
- [ ] **Step 2: Edit.** Fields as in spec §6.2, a Start/Stop vs Duration toggle, a live computed hours line, a blocked-word warning with **Edit** and **Save anyway** (or save refused when `strictGuard` is on), and Delete with a confirm.
- [ ] **Step 3: Week.** Spec §6.2 grid using `weekGrid`, previous/next week arrows, and "Last sent" from settings.
- [ ] **Step 4:** Verify with `tests/smoke.mjs` (Playwright library, Chromium, iPhone 13 viewport):
  1. add nickname Falcon
  2. start a timer
  3. switch to Falcon "b"
  4. stop
  5. quick-add `Falcon design review 9 to 11:45` and save
  6. open Week and expect the Falcon row to show 2.8 or more for today
  7. enter a blocked word and expect the warning

  Expected: prints `smoke ok` and exits with code 0.
- [ ] **Step 5:** Commit `feat: today/edit/week screens`.

### Task 9: Settings, send, backup, help

**Files:**
- Create: `app/src/ui/settings.js`, `app/src/ui/help.js`, `app/src/send.js`
- Modify: `tests/smoke.mjs` (add the send and backup steps)

**Interfaces:**
- Consumes: `buildEmail`, `toCsv` / `parseCsv`, `Store`, `findBlocked`.
- Produces: `sendBatch(store, {today}) -> Promise<{ok, method:'share'|'mailto', count, blocked?: Entry[]}>`.
  - Collects entries from `today − windowDays + 1` to `today`, including deleted ones.
  - If any entry matches a blocked word, returns `{ok:false, blocked}` and sends nothing.
  - Otherwise increments `batch` and builds the email.
  - When `navigator.canShare({files})` is true, shares `{files:[csv File], title: subject, text: body}`. Otherwise opens `mailto:${to}?subject=…&body=…` (body only).
  - Sets `lastSentAt` on success.

- [ ] **Step 1: Settings.** Nicknames (add / rename with hint "Map the new nickname in Ledger" / archive / reorder), blocked words (one per line, with the warning "use partial words like Ori*"), strict guard toggle, work email, window days, **Export backup** (JSON of all tables, sets `lastBackupAt`), **Import backup** (merge by `entry_id`, newer `updated_at` wins).
- [ ] **Step 2: Send button** in the Today header calls `sendBatch`. When `blocked` comes back, list the offending entries with links to edit them.
- [ ] **Step 3: Backup warning.** A Today banner when `lastBackupAt` is more than 7 days ago or missing and at least one entry exists.
- [ ] **Step 4: Help page.**
  - Add to Home Screen steps.
  - iOS Shortcuts automation steps: weekday 16:30 "Open URL" for Capture; Thu 19:00 and Fri–Sun 10:00/18:00 for the week reminder.
  - Dictation tip.
  - Privacy rule: no real names.
- [ ] **Step 5:** Extend the smoke test:
  - Stub `navigator.share`, run Send, and assert the captured file name matches `/^tt-\d{4}-\d{2}-\d{2}-0001\.csv$/` and the text contains `BEGIN TT CSV v1`.
  - Add an entry with a blocked word and assert the send is refused.
  - Export, clear the database, import, and assert the entry count is restored.

  Expected: `smoke ok`.
- [ ] **Step 6:** Commit `feat: send, settings, backup, help`.

### Task 10: Deploy

**Files:**
- Create: `.github/workflows/pages.yml` (only if GitHub Pages is chosen), `docs/DEPLOY.md`

- [ ] **Step 1:** Ask the user which host to use.
  - **GitHub Pages:** free for public repos. The code contains no personal data, because all data lives on the device.
  - **Cloudflare Pages:** free, and works with private repos.
- [ ] **Step 2:** Configure the chosen host to serve `app/`. Run `npm test && npm run smoke` before deploying.
- [ ] **Step 3:** Verify that the deployed URL loads over HTTPS, works offline after the first load (Playwright: load, go offline, reload, expect the Today view), and that the manifest is detected.
- [ ] **Step 4:** Commit `chore: deploy`. `DEPLOY.md` lists the URL and the iPhone install steps.
