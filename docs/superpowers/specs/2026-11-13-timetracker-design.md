# Time Tracker — Design Document

**Status:** Draft for review · **Date:** 2026-11-13

---

## 1. Intent

A personal time tracker for charge-number-based work. Time is captured quickly
on an iPhone (or any browser) during the day, and reconciled on the work laptop
into **daily and weekly totals per charge number, in tenths of an hour**, ready
to transcribe into the official timekeeping system.

The phone and the work laptop are on different networks, and the work laptop is
locked down. The one channel known to be allowed into the work environment is
**email to the work inbox**.

### The core privacy rule

> **Nothing sensitive ever leaves the work environment.**
> The phone only knows *nicknames* ("Falcon", "Admin", "Training").
> The mapping **nickname → real project name → charge number** exists **only
> on the work laptop**.

If the phone, the email in transit, or any personal cloud service is
compromised, the attacker sees something like:
`Falcon · 2.3 h · "reviewed drawings w/ team"` — and nothing more.

### Who builds what

| Side | Built by | Runs on |
|------|----------|---------|
| **Phone app** ("Capture") | This repo (personal Claude) | iPhone home screen + any browser |
| **Work app** ("Ledger") | Work-side Claude, from the prompt in `docs/work-side/IMPLEMENTATION_PROMPT.md` | Work laptop only |

The work side is the **system of record**. The phone side is a capture device.

---

## 2. Goals, non-goals, anti-goals

**Goals**
- Log time fast: a nickname from a drop-down, a task name, an optional short
  description, and either a running timer, start/stop times or a plain duration.
- Get those entries to the work laptop without manual retyping.
- On the work laptop, map nicknames to project and charge number and produce
  daily and weekly totals per charge number in tenths.
- Allow entry directly on the work laptop too (when at the desk).
- **Phase 2:** have the work app gather activity from Jira, Outlook/calendar and
  Teams into a *suggested* daily work log.

**Non-goals**
- Replacing the official timekeeping system. This is a personal scratch log.
- Multi-user or team use.
- A native App Store iPhone app (needs a Mac, Xcode and a $99/yr developer
  account; a home-screen web app does the job).

**Anti-goals: these would make it a failure even if it "works"**
- Any real program name, customer name or charge number on the phone, in email
  bodies/attachments sent from personal accounts, or in personal cloud storage.
- The app **auto-charging time** from Jira/email/Teams activity. Integrations
  may only *suggest*; a human confirms every hour charged.
- Silently losing or double-counting entries (for example, an email is
  processed twice, or one email goes missing).
- Totals that don't match what the user would compute by hand.

---

## 3. Approaches considered

| | Approach | Verdict |
|---|---|---|
| A | Notion-only (databases + formulas), Notion app on phone | **Dropped.** Unclear whether Notion is an approved work tool, and the real charge numbers would sit in a personal SaaS. |
| B | Phone web app + Notion as shared storage, small cloud proxy | **Dropped** for the same Notion reason. |
| C | Phone app stores locally, emails reports; work side ingests | **Chosen, with changes:** nicknames only on the phone, the work side does all mapping and summaries, and the work side becomes a real app that can grow integrations. |
| D | Native iOS app | Dropped: cost and tooling for no user-visible gain. |

**Why C:** email is the only channel known to be allowed into the work
environment. Putting the mapping and summaries on the work side means sensitive
data never has to travel. A work-side app can also later reach Jira, Outlook and
Teams, which nothing on the personal side could do.

---

## 4. System overview

```
 ┌───────────────── PERSONAL SIDE ─────────────────┐        ┌──────────────────── WORK SIDE ─────────────────────┐
 │                                                 │        │                                                     │
 │  iPhone (home-screen web app)  "Capture"        │        │  Work laptop  "Ledger"                              │
 │  ─────────────────────────────                  │        │  ──────────────────────                             │
 │  • nickname list (no real names)                │  email │  • Mapping: nickname → project → charge number      │
 │  • timer / start-stop / duration                │ ─────► │  • Imports [TT] emails (idempotent upsert)           │
 │  • task + short description                     │  CSV   │  • Desk entry (same fields)                         │
 │  • blocked-word guard                           │        │  • Daily / weekly totals per charge # in tenths     │
 │  • local storage + backup export                │        │  • Unmapped-nickname warnings                       │
 │                                                 │        │  • Phase 2: Jira / Outlook / Teams → suggestions    │
 └─────────────────────────────────────────────────┘        └─────────────────────────────────────────────────────┘
```

**Data that crosses the boundary:** entry ID, nickname, date, start/end,
duration, task, description, timestamps. Nothing else.

**The task/description field is the one leak risk.** It is free text. The phone
app has a user-maintained **blocked-word list** (§6.4) and warns before saving
any entry that matches.

---

## 5. Data model

### 5.1 Entry (shared by both sides; this is the email contract)

| Field | Type | Notes |
|---|---|---|
| `entry_id` | UUID string | Created once, never changes. Key for de-duplication. |
| `nickname` | string ≤ 24 chars | e.g. `Falcon`. Matched case-insensitively on the work side. |
| `date` | `YYYY-MM-DD` | Local date the work was done. |
| `start` | `HH:MM` or empty | 24-hour, local time. |
| `end` | `HH:MM` or empty | If `end < start`, the entry crosses midnight (see §8). |
| `duration_min` | integer | **Always filled.** Computed from start/end, or typed in. Source of truth for totals. |
| `task` | string ≤ 60 | Short task name, e.g. `Design review`. |
| `description` | string ≤ 200, optional | Brief note. |
| `source` | `phone` \| `web` \| `work` | Where it was entered. |
| `updated_at` | ISO-8601 UTC | Last edit time. Newer wins on import. |
| `deleted` | `0` \| `1` | Deletion travels as a "tombstone" record, so the work side removes it too. |

### 5.2 Mapping (work side only)

| Field | Notes |
|---|---|
| `nickname` | Unique, case-insensitive. |
| `project_name` | Real project name. |
| `charge_number` | Real charge number. |
| `effective_from` / `effective_to` | Optional. Charge numbers often change at contract mods or fiscal-year rollover; a date range lets one nickname point to a new charge number from a given date without rewriting history. *(Designer's call.)* |
| `active` | Hidden from desk-entry drop-down when false. |

### 5.3 Nickname list (phone side)
Just `nickname`, `active`, `sort_order`, optional colour. Nicknames are added on
the phone. Any nickname the work side hasn't seen yet shows up there as
**Unmapped** until it is mapped.

---

## 6. Phone app ("Capture")

### 6.1 Platform
- A **progressive web app** (a website you can add to the home screen, works
  offline), served over HTTPS from free static hosting (e.g. GitHub Pages or
  Cloudflare Pages).
- **Add to Home Screen** on iPhone gives it an app icon and a full-screen
  window, and it works offline.
- Data is stored **on the device** (IndexedDB, the browser's built-in database).
  The same site works in any desktop browser, but each browser keeps its own
  separate data unless the optional sync in §7.3 is turned on.

### 6.2 Screens (mock-ups)

**Today: the main screen**
```
┌──────────────────────────────────┐
│  Thu Nov 13            ⚙  ⇪ Send │
├──────────────────────────────────┤
│  ● RUNNING  Falcon               │
│    Design review        01:12:44 │
│    [  ■ Stop  ]   [ ⇄ Switch ]   │
├──────────────────────────────────┤
│  Nickname  [ Falcon        ▾ ]   │
│  Task      [ Design review    ]  │
│  Note      [ drawings pkg rev B ]│
│  ( ▶ Start timer )  ( + Manual ) │
├──────────────────────────────────┤
│  TODAY                    6.4 h  │
│  07:30–09:00  Falcon   1.5  ›    │
│    Standup + email triage        │
│  09:00–11:45  Heron    2.8  ›    │
│    Test procedure draft          │
│  12:30–13:42  Falcon   1.2  ›    │
│    Design review                 │
│  0:54 (dur)   Admin    0.9  ›    │
│    Training module               │
└──────────────────────────────────┘
```
- **Switch** stops the running timer and starts a new one in a single tap (the
  most common action when you change what you're working on).
- The task field auto-completes from recent tasks for that nickname.
- Hours shown here are an **informal preview** (rounded per day per nickname).
  The official numbers come from the work side.

**Manual entry / edit**
```
┌──────────────────────────────────┐
│  ‹ Back      Edit entry   Delete │
├──────────────────────────────────┤
│  Nickname  [ Heron         ▾ ]   │
│  Date      [ 2026-11-13      ]   │
│  Mode      (•) Start/Stop ( ) Duration │
│  Start     [ 09:00 ]  End [ 11:45 ]    │
│            = 2 h 45 m  (2.8 h)   │
│  Task      [ Test procedure draft ]    │
│  Note      [                    ]│
│                                  │
│  ⚠ "Orion" is on your blocked    │
│    word list. Edit before saving │
│    or tap Save anyway.           │
│            [   Save   ]          │
└──────────────────────────────────┘
```

**Week view**
```
┌──────────────────────────────────┐
│  ‹  Week of Nov 10  ›            │
├──────────────────────────────────┤
│           Mon Tue Wed Thu Fri  Σ │
│  Falcon   4.0 3.5 5.0 2.7  –  15.2│
│  Heron    3.0 4.0 2.5 2.8  –  12.3│
│  Admin    1.0 0.5 0.5 0.9  –   2.9│
│  ───────────────────────────────  │
│  Total    8.0 8.0 8.0 6.4  –  30.4│
│                                  │
│  Last sent: today 17:02 (✓ 23)   │
└──────────────────────────────────┘
```

**Settings**
- Nicknames: add, rename, archive, reorder.
- Blocked words (§6.4).
- Work email address to send to.
- Send window: how many days each send covers (default **14**, see §7.2).
- Export / import a backup (JSON).
- Daily reminder: shows a "Send today's entries?" banner after a set time.

### 6.3 Timer behaviour
- The running timer is saved as an entry with a start time and no end, so it
  survives the app being closed or the phone restarting.
- Only one timer runs at a time. Starting a new one stops the current one.
- If a timer has been running more than 10 h, the app asks "Still working on
  Falcon?" next time it is opened and offers to set the end time.

### 6.4 Blocked-word guard
- A user-maintained list (e.g. the real program names, customer names, part
  number prefixes).
- Matching is case-insensitive and on whole words or prefixes.
- On save, if the task or note matches, the app shows a warning and offers
  **Edit** or **Save anyway**. Strict mode (refuse to save) is a setting.
- At send time, entries are checked again, and any match blocks the send until
  it is fixed.
- ⚠ The list itself is stored on the phone. Advise keeping it to partial words
  (e.g. `Ori*`) rather than full sensitive names.

### 6.5 Sending to work
- The **Send** button builds the email (§7) and opens the iPhone share sheet /
  Mail with the work address, subject, body and CSV attachment filled in.
  **One tap to send.**
- **Decision (user):** one-tap sending. No cloud service in v1.

### 6.6 Quick add: voice or typed sentence (both apps)

**Requested feature.** A single **Quick add** line at the top of the Today screen,
with a 🎤 button. You speak or type one sentence and the app fills in the form.

- **Voice comes from the operating system's dictation**: the iPhone keyboard
  mic, or Windows `Win + H` on the work laptop. That way the app has no speech
  engine of its own, no permissions to request and nothing extra to approve. The
  app only **parses text**. *(Designer's call: the browser's built-in speech
  API is unreliable in iPhone home-screen web apps, and it would be another
  route for audio to leave the device.)*
- The parser uses **simple fixed rules (no AI model, no network)** and is the
  **same specification on both sides**, so a sentence works identically on the
  phone and in Ledger.
- **Nothing is saved from a sentence without a preview.** The parsed fields
  appear in the normal form for a one-tap Save or a quick fix.
- The blocked-word guard (§6.4) runs on the parsed result as usual.

**Sentence patterns**

| You say | Result |
|---|---|
| `Falcon design review 9 to 11:45` | Falcon · "design review" · 09:00–11:45 |
| `Heron test procedure for 45 minutes` | Heron · "test procedure" · 45 min, today |
| `Admin training an hour and a half yesterday` | Admin · "training" · 90 min, yesterday |
| `start Falcon design review` | starts the timer |
| `switch to Heron drawing check` | stops the current timer, starts a new one |
| `stop` | stops the timer |
| `Falcon design review 1 to 2:30 note rev B drawings` | …with description "rev B drawings" |

**Parsing rules**
- **Nickname:** the first word or words that match a nickname, ignoring case.
  Allow one-letter typos and trailing "'s" or "s" (dictation often hears
  "Falcon's"). If nothing matches, leave the field empty and highlight it.
- **Times:** `9`, `9:30`, `930`, `nine thirty`, `9 am`, `2 pm`, `noon`. For
  hours without am/pm, assume **7–11 = am and 12–6 = pm** (adjustable in
  settings).
- **Durations:** `45 minutes`, `1.5 hours`, `an hour and a half`,
  `2 hours 15`, `90 min`.
- **Day words:** `today` (default), `yesterday`, weekday names (meaning the most
  recent one).
- **Description:** everything after the word `note`.
- **Task:** whatever is left, trimmed.
- The parser lives in one plain module with a **table of test sentences**
  (the ones above plus edge cases), and both apps must pass the same table.

---

## 7. Email contract (phone → work)

This is the interface between the two halves, so both sides must follow it
exactly.

### 7.1 Format
- **To:** the work address set in Settings.
- **Subject:** `[TT] 2026-11-13 batch 0042 (23 entries)`
  - The `[TT]` prefix lets an Outlook rule file these emails into a folder.
  - `batch` is a number that goes up by one with each send. It is only used to
    spot gaps; it is not needed for correctness.
- **Body:** a short human-readable summary, then the full data between markers.
  The markers make the data survive if the company's email filter strips
  attachments:

```
Time Tracker export · 2026-11-13 17:02 · window 2026-10-31..2026-11-13

-----BEGIN TT CSV v1-----
entry_id,nickname,date,start,end,duration_min,task,description,source,updated_at,deleted
3f1c…a9,Falcon,2026-11-13,12:30,13:42,72,Design review,drawings pkg rev B,phone,2026-11-13T18:43:10Z,0
8b20…11,Heron,2026-11-13,09:00,11:45,165,Test procedure draft,,phone,2026-11-13T16:46:02Z,0
c771…04,Admin,2026-11-13,,,54,Training module,,phone,2026-11-13T21:01:55Z,0
e0aa…3d,Falcon,2026-11-12,14:00,15:00,60,Standup,,phone,2026-11-13T09:15:00Z,1
-----END TT CSV v1-----
```
- **Attachment:** the same CSV as `tt-2026-11-13-0042.csv` (UTF-8, RFC 4180
  quoting).

### 7.2 Why a 14-day window and not "only what changed"
Each send includes **every entry (including deletions) dated within the last N
days**. Combined with de-duplication by `entry_id` on the work side (keep the
newer `updated_at`), this means:
- importing the same email twice has no effect,
- a lost or filtered email is covered automatically by the next one,
- edits to last week's entries still arrive.

The cost is a few dozen lines of CSV per email, which is negligible.

### 7.3 Optional later: browser ↔ phone sync
Not in v1. If you want the same entries on your phone and a personal desktop
browser, add a small Cloudflare Worker + D1 store holding nickname-only data.
It would also enable automatic sending (D1).

---

## 8. Work app ("Ledger")

The work-side implementation prompt (`docs/work-side/IMPLEMENTATION_PROMPT.md`)
is the authoritative specification for the builder. This section summarises it.

### 8.1 Runtime: left to the work-side builder, in order of preference
1. **Local Python app** (standard library + SQLite; UI as a local web page on
   `127.0.0.1` or a Tkinter window), if Python is allowed.
2. **Excel workbook** (Power Query + VBA or Office Scripts) if only Office is
   available.
3. **A single HTML file** opened from disk, with data saved as a JSON file
   through the file picker, as a last resort.

The builder first checks what the laptop allows, then picks.

### 8.2 Screens (mock-ups)

**Import**
```
┌──────────────────────────────────────────────────────────────┐
│ Ledger                     [Import] [Entries] [Summary] [Map]│
├──────────────────────────────────────────────────────────────┤
│ Import from:  (•) Outlook folder "TT"  ( ) CSV file  ( ) Paste│
│                                                [ Run import ]│
│ Last run 17:05 — 1 email, 23 rows: 3 new, 2 updated,         │
│                  1 deleted, 17 unchanged                     │
│ ⚠ Batch gap: 0040 → 0042 (0041 missing — covered by window)  │
│ ⚠ Unmapped nickname: "Kestrel" (2 entries, 1.5 h)  [Map it]  │
└──────────────────────────────────────────────────────────────┘
```

**Map**
```
┌──────────────────────────────────────────────────────────────┐
│ Nickname │ Project name              │ Charge #     │ From    │
│ Falcon   │ <real project name>       │ <charge #>   │         │
│ Heron    │ <real project name>       │ <charge #>   │         │
│ Admin    │ Overhead – Admin          │ <charge #>   │         │
│ Kestrel  │ ⚠ unmapped                │              │         │
└──────────────────────────────────────────────────────────────┘
```

**Weekly summary: what you transcribe**
```
Week of 2026-11-10 (Mon–Sun)                    rounding: per day, nearest 0.1
Charge #     Project              Mon  Tue  Wed  Thu  Fri  Sat  Sun   Total
<charge A>   <Falcon project>     4.0  3.5  5.0  2.7   –    –    –    15.2
<charge B>   <Heron project>      3.0  4.0  2.5  2.8   –    –    –    12.3
<charge C>   Overhead – Admin     1.0  0.5  0.5  0.9   –    –    –     2.9
─────────────────────────────────────────────────────────────────────────
Day total                         8.0  8.0  8.0  6.4   –    –    –    30.4
Exact minutes → hours             8.00 7.98 8.03 6.35                30.36
⚠ 0 unmapped · 0 open timers · [Copy as table] [Export CSV]
```
**Daily summary:** the same table for a single day, plus the entry list
underneath (time, nickname → project, task, description).

### 8.3 Ingestion
- **Preferred:** an Outlook rule moves `[TT]` emails into a folder named `TT`.
  The app reads that folder (Outlook COM on Windows, or Microsoft Graph if
  allowed), takes the data between the `BEGIN/END` markers (or the attachment
  if the markers are missing), imports it, then moves the email to `TT/Processed`.
- **Preferred if Power Automate is available:** a cloud flow triggered by a new
  `[TT]` email saves the CSV into a OneDrive folder (`TT/inbox`) that syncs to
  the laptop. Ledger just watches that local folder, so no Outlook automation
  code is needed. Power Automate is already an approved, company-managed tool,
  which avoids asking IT for access to Microsoft's APIs.
- **Fallback:** the user saves the attachment, or pastes the email body, into
  the app.
- Upsert rule: for each `entry_id`, keep the row with the newer `updated_at`.
  `deleted=1` hides the entry from totals but keeps it for audit.
- The app checks every row (date format, `duration_min` ≥ 0, a nickname is
  present) and reports any bad rows without stopping the whole import.

### 8.4 Desk entry: Ledger works on its own
**Decision (user):** Ledger must work fully without the phone. It has its own
Today screen with a running timer (Start / Stop / Switch, saved so it survives a
restart), manual entry, task auto-complete and project management. The phone is
an optional extra way to capture time. Ledger flags phone and work entries that
overlap in time on the same day as possible double entries, and never merges
them automatically.

The same fields as on the phone, but the drop-down shows **project name
(nickname)**. Entries made here get `source=work` and a new UUID. These never
travel back to the phone (one-way flow, by design).

---

## 9. Hours and rounding

- `duration_min` is the source of truth. Start/end are informational once
  duration has been computed.
- **Default (designer's call, open decision D2):** add up exact minutes **per
  charge number per day**, then convert to hours and round to the **nearest
  0.1** (half-up: 0.05 → 0.1). In minutes that means 0–2 → .0, 3–8 → .1,
  9–14 → .2, and so on (a 6-minute grid, rounding to the nearest step).
- **Weekly total = sum of the rounded daily values**, so the weekly sheet always
  equals what goes into the daily timesheet cells.
- The summary also shows exact (unrounded) totals so drift is visible.
- Alternative policies are a setting: round each entry; round up only; always
  use 6-minute blocks. Some employers specify the rule, so the user should
  confirm theirs.
- **Midnight crossing:** if `end < start`, the duration wraps past midnight and
  the whole entry counts on `date`. *(Designer's call; splitting across days is
  a possible later improvement.)*
- **Week** = Monday–Sunday by default (configurable, since some timekeeping
  weeks run Saturday–Friday).

---

## 10. Phase 2: daily work log from work systems (work side only)

Goal: at the end of the day, show what you actually did, so time entries are
easier to fill in and check.

| Source | Likely access route | What it adds | Watch-outs |
|---|---|---|---|
| Outlook calendar | Outlook COM or Graph `/me/events` | Meetings, with times | Easiest win; usually allowed. |
| Outlook mail | Outlook COM or Graph | Count/subjects of sent mail per hour | Keep subjects local, never send them out. |
| Jira | REST API + personal access token | Issues you transitioned, commented on or logged work against | Needs a PAT; check whether your instance allows them. |
| Teams | Graph (chats/meetings) | Meetings attended, chat activity bursts | Often blocked without admin approval; treat as optional. |

**Sent email (requested; first Phase 2 source together with the calendar).**
Sent mail is a strong sign of what you worked on. A flow (Power Automate "When
an email is sent", or a scheduled read of Sent Items) writes one suggestion per
**activity block**: sent emails less than 30 min apart are grouped together, and
each block runs from 10 min before the first send to the last send. A suggested
project comes from rules you write in Ledger, checked in order:
1. A Jira key in the subject (`ABC-123` → that Jira project's nickname).
2. Recipient address, domain or distribution list (e.g. `*@customer-x.com` → Falcon).
3. A keyword in the subject.
4. Otherwise: no suggestion, and you pick.

Subjects and recipients stay on the work side. Only the time block and the
suggested project become an entry, and only when you accept it.

**Behaviour:** the work app builds a **Suggested log** timeline for the day
(e.g. `09:00–09:30 Meeting "Sprint standup"`, `10:12–11:40 Jira ABC-123 →
In Review`). The user can **accept** a suggestion, which creates an entry on the
mapped project. Jira projects or calendar categories can be auto-mapped to
nicknames as a *suggestion* only. **Nothing is charged without a click**
(anti-goal).

**Suggestions inbox.** All sources feed Ledger in one way: CSV files in a
`suggestions/` folder (`suggestion_id,date,start,end,source,title,detail,suggested_nickname`).
A source can be a built-in integration, or an **external work-side agent**
(e.g. the company's on-prem agent platform driving Outlook, Jira or Teams in a
browser). The agent *gathers* information. Ledger's tested code does all the
*counting*, so an AI model never does timesheet arithmetic.

**Preferred collector: Power Automate.** A scheduled weekday flow using the
Outlook (calendar), Teams and Jira connectors writes suggestion CSVs into a
synced OneDrive folder. Caveats: the Jira connector may need a premium licence,
and company connector-restriction (DLP) policies may block some combinations.
Use a Genesis agent or Python code for whatever Power Automate can't reach.

All Phase 2 data stays on the work laptop. Nothing from Phase 2 is ever emailed
out.

---

## 11. Security & compliance notes

- The phone never stores real names or charge numbers. The work side never sends
  anything outbound.
- The phone app has no login. Data lives on the device, and the iPhone's lock
  protects it. Backups are user-initiated JSON files.
- Email goes **personal → work inbox only**, never the other way.
- **The user should confirm with security or the timekeeping lead** that a
  personal scratch log and personal-to-work emails are acceptable. The design
  keeps that conversation simple: "only nicknames and generic task notes leave
  my phone; mapping happens on my work laptop."
- If work-side tokens are used (Jira PAT, Graph), they are stored in the OS
  credential store (Windows Credential Manager), never in plain files.

---

## 12. Open decisions for the user

| # | Decision | Default in this doc |
|---|---|---|
| D1 | Sending | **Decided: one tap from the phone.** Ledger also works fully on its own (§8.4). |
| D2 | Rounding rule (per day per charge #, per entry, round-up only) | Per day per charge #, nearest 0.1, half-up |
| D3 | Timekeeping week start (Mon or Sat) | Monday |
| D4 | Work-side runtime (Python / Excel / HTML) | Builder checks the laptop and picks, in that order |

---

## 13. Left to the builders

- Visual styling, colours, icons.
- The exact IndexedDB schema and migration approach on the phone.
- The exact work-side storage schema (must follow §5).
- Test framework choice. Both sides must include tests for: duration
  calculation, midnight crossing, rounding table (§9), CSV round-trip with
  commas, quotes and newlines in descriptions, idempotent re-import, tombstones,
  and unmapped nicknames.

---

## 14. Delivery plan (high level)

1. **Phone app v1** (this repo): entry, timer, nicknames, blocked words, week
   view, Send, backup. Deployed as a home-screen web app.
2. **Work app v1** (work-side Claude, from the prompt): mapping, import, desk
   entry, daily/weekly summaries.
3. **End-to-end check:** send a test batch with tricky data (commas, quotes,
   midnight crossing, deletion, an unmapped nickname) and confirm the totals
   match a hand calculation.
4. **Phase 2** integrations on the work side, one source at a time, starting
   with the Outlook calendar.
