# Home Timecard Nag (Home Assistant) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push escalating timecard reminders to the user's iPhone from Home Assistant, triggered by the official timekeeping emails in their personal Gmail and backed by a fixed schedule. A "Submitted ✓" notification button silences them.

**Architecture:** HA's IMAP integration watches the personal Gmail inbox and fires `imap_content` events. Automations turn matching emails into "nag active" flags (helpers). Time-pattern automations send actionable notifications through the HA companion app while a flag is on. The notification action handler clears the flag. All of this is configured in the user's HA through the HA MCP tools. **Nothing goes in this repo except this plan.**

**Tech Stack:** Home Assistant (IMAP integration, `input_boolean`, `input_datetime`, automations, `notify.mobile_app_<iphone>`), the HA companion app on the iPhone.

**Spec:** `docs/superpowers/specs/2026-11-13-timetracker-design.md` §10a (Option H3 + H1).

## Global Constraints

- Sender addresses and subject patterns of the official emails live **only in HA config**. Get them at execution time from the user's Gmail. Never commit them.
- Workdays Mon–Thu. Start 09:00. Daily deadline is 10:30 on the next workday (Thursday's deadline is Monday 10:30).
- Daily nags: Mon–Thu 16:30, 17:15, 21:00 while today is not marked submitted. Next workday 09:00, 09:30, 10:00, 10:15 while the previous workday is not submitted.
- Weekly nags while the week is not submitted: Thu 16:30, 18:00, 19:30, 21:00, then Fri–Sun 09:00, 12:00, 16:00, 19:00, then Mon from 07:30 every 2 h ("OVERDUE").
- Notifications carry actions `TT_DAY_DONE` ("Day submitted ✓") and `TT_WEEK_DONE` ("Week submitted ✓"). Weekly ones use iOS `interruption-level: time-sensitive`.
- No work data in notifications beyond the reminder text.

## Review Focus

1. **The IMAP integration stops working** (app password revoked). The user expects the backup schedule to keep nagging anyway. Verify by disabling IMAP and running the Thu 16:30 trigger.
2. **Holiday or leave day.** The user expects no nags. Add an `input_boolean.tt_day_off_today` and a "Day off" action. Verify that the 16:30 nag does not fire when it is on.
3. **The user ticks "Week submitted" on Thursday afternoon, then a stale official reminder email arrives later.** The user expects no re-arming for the same week. Verify that the email handler compares ISO week numbers.
4. **Phone in Focus mode at night.** Daily nags are time-sensitive only in the morning window. Verify the notification payload.
5. **Monday reset.** The week flag re-arms Mon 00:00 only if last week was submitted. Otherwise OVERDUE continues. Verify with a trace on a simulated Monday.

---

### Task 1: Discover the inputs (read-only)

- [ ] **Step 1:** In the user's Gmail, find the official reminder senders and subjects ("weekly complete timesheet reminder", "daily incomplete time notice", "manager missing-input" messages). Note them in the session only.
- [ ] **Step 2:** With HA tools, list `notify.mobile_app_*` services and confirm which is the user's iPhone. Check whether the IMAP integration is already configured.
- [ ] **Step 3:** Ask the user to create a Gmail **app password** and add the IMAP integration in the HA UI (a credential the agent must not handle). Search: `UNSEEN`, folder `INBOX`, event message data enabled.
- Expected: IMAP sensor entity exists, and the notify service name is known.

### Task 2: Helpers

- [ ] **Step 1:** Create `input_boolean.tt_day_submitted`, `tt_prev_day_submitted`, `tt_week_submitted`, `tt_day_off_today`, `tt_nag_enabled` (default on, a condition on every nag), and `input_text.tt_week_ack` (ISO week like `2026-W46`).
- [ ] **Step 2:** Automation `tt_rollover`, at 00:01 Mon–Thu: copy `tt_day_submitted` into `tt_prev_day_submitted` (Monday copies Thursday's value, kept through the weekend), then turn `tt_day_submitted` off. Mon 00:01: if `tt_week_ack` equals last week, turn `tt_week_submitted` off.
- [ ] **Step 3:** Verify by triggering `tt_rollover` manually and reading the states. Expected: the flags move as described.

### Task 3: Email triggers

- [ ] **Step 1:** Automation `tt_mail_weekly`: on `imap_content` with sender = the official address and the weekly subject → if `tt_week_ack` ≠ the current ISO week, turn `tt_week_submitted` off and send an immediate weekly notification.
- [ ] **Step 2:** Automation `tt_mail_daily_incomplete`: on the daily-incomplete subject or the manager missing-input subject → turn `tt_prev_day_submitted` off and send an immediate time-sensitive notification ("Official notice: time missing. Deadline 10:30").
- [ ] **Step 3:** Verify by firing a synthetic `imap_content` event with matching data from HA developer tools (or `homeassistant.call_action` `event.fire` equivalent). Expected: the flags flip and a notification appears on the phone.

### Task 4: Scheduled nags and the action handler

- [ ] **Step 1:** Automation `tt_nag_daily`: time triggers at the evening and morning times from Global Constraints, with conditions for weekday, flag off and day-off off. Notification with action `TT_DAY_DONE`. Morning text: "Yesterday's time due by 10:30 (N min left)".
- [ ] **Step 2:** Automation `tt_nag_weekly`: time triggers at the weekly times from Global Constraints, with condition `tt_week_submitted` off. Notification with action `TT_WEEK_DONE`, time-sensitive. Monday text says OVERDUE.
- [ ] **Step 3:** Automation `tt_actions`: on `mobile_app_notification_action`.
  - `TT_DAY_DONE` turns on `tt_day_submitted` before 12:00 on the next workday, and `tt_prev_day_submitted` otherwise.
  - `TT_WEEK_DONE` turns on `tt_week_submitted` and sets `tt_week_ack` to the current ISO week.
  - Optional (if the user wants): complete the Todoist task "Do my time card".
- [ ] **Step 4:** Verify each Review Focus item via automation traces. Expected: every case behaves as described in that section.
- [ ] **Step 5:** Show the user the list of automations created and how to pause them all (one `input_boolean.tt_nag_enabled` checked by every automation).
