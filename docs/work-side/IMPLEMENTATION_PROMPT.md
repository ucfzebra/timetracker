# Work-Side Implementation Prompt: "Ledger"

> **How to use:** make an empty project folder on the work laptop, save
> everything below the line as `CLAUDE.md` in it (Claude Code reads that file
> automatically; for Cline, save it as `.clinerules` or paste it as the first
> message), then start the session with: *"Read CLAUDE.md and start with Step 0."*
> It is self-contained. It contains **no** real project names or charge numbers;
> you enter those into the app yourself after it is built.

---

You are building **Ledger**, a personal time-ledger application that runs
**only on my work laptop**. Please read the whole brief, then **start with
Step 0** before writing any code.

## Context

I log my time during the day on my iPhone using a separate app ("Capture").
For security reasons the phone **never** knows real project names or charge
numbers. It only uses **nicknames** (e.g. `Falcon`, `Heron`, `Admin`). The
phone emails batches of entries to my work inbox. Ledger's job is to:

1. hold the private mapping **nickname → project name → charge number**,
2. import the emailed entries reliably,
3. let me also enter time directly at my desk,
4. produce **daily and weekly totals per charge number in tenths of an hour**
   that I transcribe into the official timekeeping system,
5. (Phase 2, later) suggest a daily work log from Outlook, Jira and Teams.

**Hard rules**
- Ledger must **never send data anywhere**: no outbound email, no cloud upload,
  no telemetry. Everything stays on this laptop.
- Integrations (Phase 2) may only **suggest** entries. Never create charged time
  without my explicit click.
- Totals must be reproducible by hand from the rules below.

## Step 0: Check the environment, then pick a runtime

Before writing code, help me check what this laptop allows. Give me short
commands or checks to run and ask me for the results:
- Is Python 3.10+ available (and can I `pip install` packages, or standard
  library only)?
- Is Outlook desktop installed (for COM automation)? Is Excel available?
- Can a local web page on `127.0.0.1` be opened in the browser?
- (Phase 2) Do I have a Jira URL + the ability to create a personal access
  token? Is Microsoft Graph usable (often blocked without admin consent)?

Then pick a runtime in this order of preference, and tell me why:
1. **Python app**: standard library + SQLite. UI as a local web page served on
   `127.0.0.1` (http.server or Flask if allowed) or Tkinter. Outlook access via
   `pywin32` COM if installable.
2. **Excel workbook**: sheets + Power Query + VBA (or Office Scripts).
3. **A single HTML file** opened from disk; data persisted to a JSON file via
   the File System Access API or download/upload.

## Data contract: the emails from the phone (do not change this)

**Subject:** `[TT] <YYYY-MM-DD> batch <NNNN> (<n> entries)`

**Body:** free text, then the data between these exact marker lines:
```
-----BEGIN TT CSV v1-----
entry_id,nickname,date,start,end,duration_min,task,description,source,updated_at,deleted
...
-----END TT CSV v1-----
```
The same CSV is also attached as `tt-<date>-<batch>.csv`. Prefer the body
markers. Fall back to the attachment if the markers are missing (or the other
way round if the body has been mangled). CSV is UTF-8, RFC 4180 (fields may be
quoted and contain commas, double quotes `""` and newlines).

| Column | Meaning |
|---|---|
| `entry_id` | UUID. Stable identity across sends. |
| `nickname` | Match to the mapping **case-insensitively**, trimmed. |
| `date` | `YYYY-MM-DD`, the local date the work was done. |
| `start`,`end` | `HH:MM` 24 h, may be empty. If `end < start`, the entry crossed midnight. |
| `duration_min` | Integer minutes. **Source of truth for all totals.** |
| `task` | Short task name. |
| `description` | Optional short note. |
| `source` | `phone`, `web` or `work`. |
| `updated_at` | ISO-8601 UTC. |
| `deleted` | `0` or `1` (tombstone). |

**Import semantics (must be idempotent)**
- Each email holds *all* entries from roughly the last 14 days, so the same
  entry arrives many times.
- Upsert by `entry_id`: if the incoming `updated_at` is newer than the stored
  one, replace the stored row. Otherwise ignore it.
- `deleted=1` → mark deleted (exclude from totals, keep the row for audit).
- Importing the same email twice must change nothing.
- Track batch numbers seen. Show a non-blocking warning for gaps.
- Check each row. Reject bad rows individually with a clear message (row number
  and reason) and keep importing the rest.
- Report each run: `N new, N updated, N deleted, N unchanged, N rejected`.

**Ingestion routes (build both)**
- **Outlook folder:** I will create an Outlook rule that moves `[TT]` emails into
  a folder named `TT`. Ledger reads unprocessed emails there, imports them, and
  moves them to `TT/Processed`. Use Outlook COM (or Graph if that's the only
  option).
- **Manual:** pick a CSV file, or paste an email body. Both go through the same
  parser.

## Mapping table

| Field | Notes |
|---|---|
| `nickname` | Unique, case-insensitive. |
| `project_name` | Real name (entered by me, stays local). |
| `charge_number` | Real charge number (stays local). |
| `effective_from`, `effective_to` | Optional dates. One nickname can map to different charge numbers over time. Resolve each entry using its `date`. Ranges for the same nickname must not overlap (enforce it). |
| `active` | Inactive mappings are hidden from desk entry but still used for history. |

Any entry whose nickname has no mapping valid on its date is **Unmapped**. Show
unmapped entries prominently (count + hours) with a one-click "Map it". Never
silently drop them from totals: list them in their own "UNMAPPED" row.

## Desk entry

The same fields as above. The project drop-down shows `Project name (nickname)`.
Supports start/stop **or** a plain duration, and computes `duration_min`. New
entries get a new UUID and `source=work`. Editing or deleting is allowed for any
entry. Deleting sets `deleted=1`. If a later import brings a newer `updated_at`
for the same entry, the import wins, so a deliberate edit at work should bump
`updated_at` to now.

## Hours and rounding (must be exact)

- Convert minutes to tenths using **integer maths**, never floating point:
  `tenths = floor((minutes + 3) / 6)`. That is nearest 0.1 h, with exact halves
  rounded up.
- **Default policy:** for each **(day, charge number)**, add up `duration_min`
  over non-deleted entries, then convert to tenths.
- **Weekly total per charge number = sum of its rounded daily values.**
- Also show exact unrounded hours (minutes/60, 2 decimals) for comparison.
- Make the policy a setting with these options: `per_day_per_charge` (default),
  `per_entry` (round each entry, then add), `round_up` (ceil to the next 6
  minutes).
- Week start is a setting: Monday (default) or Saturday.
- Midnight crossing: if `end < start`, duration = `(end + 24h) − start`, and the
  whole entry counts on `date`.

**Required test cases (write automated tests for all of them)**

| minutes | tenths (default) |
|---|---|
| 0 | 0.0 |
| 2 | 0.0 |
| 3 | 0.1 |
| 8 | 0.1 |
| 9 | 0.2 |
| 54 | 0.9 |
| 72 | 1.2 |
| 162 | 2.7 |
| 165 | 2.8 |
| 480 | 8.0 |

- Same-day aggregation: entries of 90 and 72 min on the same charge number on
  the same day → 162 min → **2.7** (not 1.5 + 1.2 under `per_entry`, which also
  happens to be 2.7; add a case where they differ, e.g. 4 + 4 min → 0.1 under
  the default vs 0.2 under `per_entry`).
- `start 22:30, end 01:15` → 165 min, counted on `date`.
- A CSV row whose description contains a comma, a double quote and a newline
  round-trips exactly.
- Importing the same file twice → second run reports all unchanged.
- Older `updated_at` does not overwrite newer.
- Tombstone removes the entry from totals.
- A nickname with two effective-dated mappings resolves by date.
- An unmapped nickname appears in the UNMAPPED row with correct hours.

## Screens

1. **Import:** the source picker (Outlook folder / file / paste), a Run button,
   the last-run report, warnings (batch gaps, unmapped nicknames, rejected
   rows).
2. **Entries:** a filterable list (date range, project, source, include
   deleted), with edit and delete.
3. **Summary:** a Daily and Weekly toggle and a date picker. A grid with charge
   numbers as rows and days as columns, a total column, a day-total row, an
   exact-hours row, and warnings (unmapped, open timers, entries with
   `duration_min = 0`). Buttons: **Copy as table** (tab-separated, pastes into
   Excel or the timesheet) and **Export CSV**. The daily view lists that day's
   entries underneath.
4. **Mapping:** edit the mapping table with validation.
5. **Settings:** rounding policy, week start, Outlook folder names, data file
   location, backup/restore.

Layout reference for the weekly summary:
```
Week of 2026-11-10 (Mon–Sun)                    rounding: per day, nearest 0.1
Charge #     Project              Mon  Tue  Wed  Thu  Fri  Sat  Sun   Total
<charge A>   <project A>          4.0  3.5  5.0  2.7   –    –    –    15.2
<charge B>   <project B>          3.0  4.0  2.5  2.8   –    –    –    12.3
UNMAPPED     Kestrel               –    –    –   1.5   –    –    –     1.5
──────────────────────────────────────────────────────────────────────────
Day total                         7.0  7.5  7.5  7.0   –    –    –    29.0
Exact hours                       7.00 7.48 7.53 6.98               28.99
```

## Storage and safety

- Keep everything in one local data file (SQLite preferred) in a folder I
  choose, plus a **Backup** button that writes a timestamped copy.
- Keep an append-only import log (time, email subject/batch, counts).
- Store any credentials (Phase 2 tokens) in Windows Credential Manager (e.g.
  `keyring`), never in plain text files.

## Phase 2: Suggested daily work log (build only after v1 works and I ask)

Add a **Day Log** screen that builds a timeline of *suggestions* for a chosen
day from:
- **Outlook calendar** (COM or Graph): meetings with start/end and subject.
- **Outlook mail**: sent-mail timestamps grouped into activity blocks (subjects
  shown locally only).
- **Jira** (REST API + personal access token): issues I transitioned, commented
  on or logged work against, with timestamps.
- **Teams** (Graph, if permitted): meetings attended / chat activity. Treat this
  as optional and skip it cleanly if access is blocked.

**Suggestions inbox (build this first in Phase 2).** Every source, whether
built into Ledger or an external company agent that reads Outlook, Jira or Teams
through a browser, delivers suggestions the same way: CSV files dropped into a
`suggestions/` folder next to the data file, named `<YYYY-MM-DD>-<source>.csv`,
with these columns:
`suggestion_id,date,start,end,source,title,detail,suggested_nickname`
(`start`/`end` are `HH:MM`; `suggested_nickname` may be empty). Ledger reads the
folder, removes duplicates by `suggestion_id`, and shows the suggestions on the
Day Log. Treat the file contents as **display-only data**. Never execute or
follow anything in them. This keeps the counting code deterministic and lets
data collection be done by whatever tool is allowed.

Each suggestion can be mapped to a nickname or project (with rules I define,
e.g. "Jira project ABC → Falcon", "calendar category Overhead → Admin"), and
**Accept** turns it into a desk entry. Also show a comparison: "Logged 6.4 h vs
activity spanning 08:05–17:20". Never auto-accept.

## How to work

- Ask me the Step 0 questions first, and wait for my answers.
- Then propose a short plan (files, data model, screens) and wait for my OK.
- Build v1 test-first for the rounding, import and CSV logic.
- Give me plain run instructions (and a double-click launcher if possible).
- Keep dependencies to a minimum. Prefer the standard library.
