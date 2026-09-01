# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 5 — Fix reminder timezone display bug + add configurable market-open/close window

Two related, owner-reported issues with graph reminders (both live in production):

**Bug (fix)**: "Next occurrence" on `/dashboard/reminders` displays the wrong time
relative to the user's expectation — e.g. a 15m reminder computed for 2:00pm Malaysia
time displayed as "6:00 AM". Root cause confirmed by manual trace: the *stored*
`next_trigger_at` value is correct (`06:00 UTC` == `14:00 Asia/Kuala_Lumpur`) —
`computeNextTriggerAt`'s math is not the problem. The bug is purely in
`apps/web/app/dashboard/reminders/page.tsx`'s `formatDate()`, which calls
`new Date(value).toLocaleString()` with no `timeZone` option, inside a **Server
Component** running on Cloudflare Workers (whose runtime defaults to UTC) — so it
renders the raw UTC wall-clock time instead of converting to the reminder's own
`timezone` column.

**Feature (new, owner-requested)**: let each reminder optionally define a
market-open/close window (`window_start_time` / `window_end_time`, both `time`-of-day,
no date component). When set, the periodic grid (15m/1H/4H) anchors to
`window_start_time` instead of local midnight, and only fires within the window;
1D anchors its single daily occurrence to `window_start_time` instead of midnight.
When unset (the default — nothing changes for existing reminders), behavior is
identical to today's midnight-anchored, unrestricted grid.

### Decisions

- **Bug fix**: change `formatDate` in `apps/web/app/dashboard/reminders/page.tsx` to
  `new Date(value).toLocaleString(undefined, { timeZone: reminder.timezone, dateStyle:
  "medium", timeStyle: "short" })` (pass the reminder's own `timezone` column through —
  it's already fetched on this page, just not used for display). This correctly shows
  the time in the frame of reference the reminder was actually scheduled in, regardless
  of what timezone the Cloudflare Worker's runtime defaults to.
- **Schema** (`supabase/migrations/0004_reminder_window.sql`, new): add
  `window_start_time TIME NULL` and `window_end_time TIME NULL` to `graph_reminders`.
  Both nullable, both default `NULL` — fully backward compatible, no backfill needed.
  Add a `CHECK` constraint: `(window_start_time IS NULL) = (window_end_time IS NULL)`
  — either both set or both null, never just one. **This migration cannot be applied
  via `supabase db push`** (this network blocks direct Postgres ports — see
  handoff/BUILD-LOG.md's KG-8) — write the migration file for the repo's record, but
  Arch will apply the DDL via the Supabase dashboard SQL Editor after review clears,
  same as Step 2's `0003_cron.sql`. Don't attempt `db push` yourself; it will hang.
- **`computeNextTriggerAt` algorithm change** (`packages/alert-engine/src/computeNextTriggerAt.ts`):
  add an optional 4th parameter, `window?: { startMinutes: number; endMinutes: number }`
  (minutes-since-midnight, 0-1439; converting `TIME` strings to/from minutes is the
  caller's job — keep this function's signature in plain numbers, no new string
  parsing inside the pure-logic function). When `window` is provided:
  - `windowLength = ((window.endMinutes - window.startMinutes) + 1440) % 1440`. (If a
    caller ever passes `startMinutes === endMinutes`, that's the "no restriction" case
    and should never reach this function as a `window` argument — see the validation
    note below; this function can assume `window`, if passed, always has a nonzero
    length.)
  - For 15m/1H/4H: let `m` = the reminder's wall-clock minutes-since-midnight for
    `from` (already computed today via `getWallClock`). `offset = ((m -
    window.startMinutes) % 1440 + 1440) % 1440` (minutes since the most recent window
    start, whether that instance started today or — for a wrapping window — yesterday).
    If `offset < windowLength` (currently inside an open window instance):
    `currentSlot = Math.floor(offset / stepMinutes)`, `nextSlotOffset = (currentSlot +
    1) * stepMinutes`. If `nextSlotOffset < windowLength`, the next occurrence is
    `nextSlotOffset - offset` minutes after `from` (still within this window instance).
    Otherwise (including the currently-outside-any-window case, `offset >=
    windowLength`), the next occurrence is the **next** window instance's start:
    `(windowLength - offset + 1440) % 1440` minutes after `from` if inside a window and
    rolling over, or the direct distance to the next `window.startMinutes` occurrence if
    currently outside a window. (Work this out precisely with a wall-clock-minutes
    number line, not just prose — write unit tests for both branches before trusting
    the arithmetic; see worked examples below.)
  - For 1D: the single daily occurrence's minute-of-day is `window.startMinutes`
    instead of `0` (midnight) — same "floor to today's occurrence time, then add one
    day" structure as the existing no-window 1D branch, just anchored differently.
  - Preserve the existing DST-safe wall-clock round-trip (`getWallClock` /
    `zonedWallClockToUtc`) exactly as-is — the window logic operates purely on
    minutes-of-day *within* that existing correct timezone-aware framework, it doesn't
    replace it.
  - **Worked examples to build tests against** (write these as literal test cases,
    don't just eyeball them):
    - Window `06:00–22:00` (`windowLength = 960`), timeframe `4H` (`step = 240`):
      slots at minute-of-day `360, 600, 840, 1080` (i.e. `06:00, 10:00, 14:00, 18:00`).
      `22:00` (minute `1320`) is correctly excluded — `nextSlotOffset` there would be
      `960`, which is not `< windowLength (960)`, so it rolls to next day's `06:00`.
      If `from` is `09:00` (minute `540`), `offset = 180`, `currentSlot = 0`
      (`floor(180/240)`), `nextSlotOffset = 240 < 960` → next occurrence is `10:00`
      **today** (not `13:00`, i.e. not "9am + 4h") — this is the exact case the owner
      described.
    - Window `22:00–06:00` (overnight, `windowLength = 480`), timeframe `1H`
      (`step = 60`): slots at `22,23,00,01,02,03,04,05`. If `from` is `23:30`,
      `offset = 90`, `currentSlot = 1`, `nextSlotOffset = 120 < 480` → next is `00:00`.
      If `from` is `05:30` (still inside the window, wrapped), `offset = 450` (`(330 -
      1320 + 1440) % 1440`... work the actual numbers, don't copy this blindly),
      `currentSlot = 7`, `nextSlotOffset = 480`, not `< 480` → rolls to next `22:00`.
    - No window (existing reminder, both columns `NULL`): identical output to before
      this change — add a regression test asserting this against the *existing*
      `computeNextTriggerAt.test.ts` cases, don't just trust that omitting the
      parameter is a no-op without checking.
- **Validation** (`packages/validation/src/graphReminder.ts`): add optional
  `window_start_time` / `window_end_time` (HTML `time` input strings, `"HH:MM"`).
  Zod refine: either both present or both absent (matching the DB CHECK constraint —
  defense in depth, don't rely on the DB to catch this). If both present and equal,
  **normalize to `null`/`null`** before it reaches the database (per the owner's own
  framing: "6am to 6am the next day is equivalent to no set") — do this in the schema
  via a `.transform()`, not by leaving two different representations of "no
  restriction" (`null,null` vs `"06:00","06:00"`) both valid in the database.
- **UI**: add two optional `time`-type inputs ("Market open" / "Market close") to both
  `reminders/new/new-reminder-form.tsx` and `reminders/[id]/edit/edit-form.tsx`. Wire
  through `reminder-actions.ts`'s create/update actions: convert the `"HH:MM"` strings
  to minutes-of-day when calling `computeNextTriggerAt`, and recompute
  `next_trigger_at` on update whenever `timeframe`, `timezone`, *or* the window changes
  (the existing update action already recomputes on timeframe/timezone change — extend
  that condition, don't duplicate the recompute call).
- **Display fix rollout**: also fix `formatDate` (see Bug fix above) while you're in
  this file for the window UI changes.

### Build Order
1. `computeNextTriggerAt` window support + tests (the worked examples above, plus the
   no-window regression check). This is the highest-risk part — it's already running
   live in production for every existing reminder; get it right and tested before
   touching anything else.
2. Migration file `0004_reminder_window.sql` (written, not applied by you).
3. Validation schema changes + tests (both-or-neither, equal-times-normalize-to-null).
4. UI: new/edit reminder forms, `reminder-actions.ts` wiring.
5. Display bug fix in `reminders/page.tsx`.
6. Live verification (once Arch has applied the migration — check with Arch/BUILD-LOG
   before assuming the columns exist on the real project) — create a windowed reminder,
   confirm `next_trigger_at` matches a hand-computed expectation, confirm the list page
   now displays it correctly.

### Flags
- Flag: Do NOT apply the migration yourself (`supabase db push` will hang on this
  network) — write it, note in BUILD-LOG that it's pending Arch's manual application,
  and coordinate before doing step 6's live verification.
- Flag: The `computeNextTriggerAt` window-offset arithmetic is genuinely easy to get
  subtly wrong at the boundaries (exactly-at-window-start, exactly-at-window-end,
  wrap-around). Do not skip writing tests for the exact worked examples in the brief —
  if your computed values don't match them, that's a sign to re-derive the formula, not
  to adjust the test to match your code.
- Flag: Keep `computeNextTriggerAt` a pure function taking minutes-as-numbers for the
  window — don't have it parse `"HH:MM"` strings itself; that conversion belongs in the
  caller (web app server actions), keeping the shared engine function's contract simple
  and identical in both the Deno and Node/Workers environments that import it.

### Definition of Done
- [ ] `pnpm build`, `pnpm test`, `pnpm typecheck` pass, including new window tests and
      the no-window regression test.
- [ ] All three worked examples in the brief pass as literal test cases with matching
      expected values.
- [ ] Validation rejects one-of-two window fields set; normalizes equal start/end to
      null/null.
- [ ] UI has the two optional time inputs on both new and edit reminder forms.
- [ ] `reminders/page.tsx` displays times in the reminder's own timezone.
- [ ] Migration file exists but is explicitly flagged as not-yet-applied in BUILD-LOG.

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

**Re-derivation of the window-arithmetic formula** (per the brief's own instruction to
re-derive rather than blindly copy — confirmed by working every worked example by hand
before writing any code):

- `offset = ((m - window.startMinutes) % 1440 + 1440) % 1440` — minutes since the most
  recent window-start occurrence (today's or yesterday's, whichever is closer in the
  past). This part of the brief's prose checks out exactly against both worked examples.
- 15m/1H/4H: if `offset < windowLength` (inside an open window instance): `currentSlot =
  floor(offset/step)`, `nextSlotOffset = (currentSlot+1)*step`. If `nextSlotOffset <
  windowLength`: next occurrence is `nextSlotOffset - offset` minutes after `from`
  (unchanged from the brief). Otherwise — rolling off the last slot of this window
  instance — **or** the `offset >= windowLength` (currently-outside) case: next
  occurrence is **`1440 - offset`** minutes after `from`. I verified the brief's own
  suggested rollover formula (`(windowLength - offset + 1440) % 1440`) does NOT reproduce
  the brief's own overnight-window worked example (`from = 05:30`, `offset = 450`, window
  `22:00–06:00`): that formula gives `30` (landing on `06:00`, the window's own end —
  wrong), while `1440 - offset = 990` correctly lands on `22:00`, matching the brief's
  stated expected answer. `1440 - offset` also reproduces the `06:00–22:00`/`from=09:00`
  case (`60` → `10:00`) and the exact-`22:00`-boundary exclusion case (`480` → next-day
  `06:00`). Using `1440 - offset` uniformly for both the "rolling off the last in-window
  slot" and "currently outside the window" cases (they turn out to be the same formula).
- 1D with window: rather than literally "floor to today's date at `startMinutes`, then
  always +1 day" (which would incorrectly skip *today's* still-upcoming occurrence
  whenever `startMinutes` is later in the day than `from`'s current time), I generalize
  using the same `offset`/`1440 - offset` mechanism: `offset = ((m -
  window.startMinutes) % 1440 + 1440) % 1440`, next occurrence is `1440 - offset` minutes
  after `from`. This lands on *today's* anchor time when it's still ahead of `from`, and
  *tomorrow's* when it's already passed — and when `startMinutes = 0` it reduces
  algebraically to exactly the existing (untouched) midnight-anchored 1D behavior, so the
  existing 1D regression tests are an implicit proof this generalization is safe. Flagging
  this as a Builder refinement of the brief's 1D wording for Arch's awareness — no worked
  example was given for this branch, so I verified it by hand against several cases
  (anchor still ahead today, anchor already passed today, from exactly at anchor) rather
  than against a literal brief example.
- Implementation approach: leave the existing (non-window) code path in
  `computeNextTriggerAt` byte-for-byte untouched, gated behind `if (!window)`, so the
  existing 9 tests need zero changes and serve as the regression proof. Add a new `else`
  branch for the window-provided case using the formula above, converging on the same
  final `dayStartUtcMs + minutes*60000` → `zonedWallClockToUtc` conversion the existing
  code already uses.

**Scope addition beyond the brief's literal Build Order** — flagging per BUILDER.md
"escalate when something outside the current step is broken and cannot be deferred":
`supabase/functions/tick/index.ts`'s `processGraphReminders` also calls
`computeNextTriggerAt` (to recompute `next_trigger_at` after each fire) but the brief's
Build Order/Definition of Done never mentions updating it. Not updating it would mean a
windowed reminder's *first* occurrence respects the window (computed by the web app's
server action) but every occurrence *after* that reverts to unrestricted/midnight-anchored
behavior (computed by `tick` without the window arg) — silently breaking the feature after
one cycle, in the same live-production function the brief calls out as high-risk. Treating
this as in-scope and fixing it (pass `window_start_time`/`window_end_time`, converted to
minutes, through to `computeNextTriggerAt` there too) rather than deferring, since deferring
would ship a feature that visibly regresses itself within one tick cycle. Calling this out
explicitly for Arch review rather than silently expanding scope.

**Build order** (same as brief's, plus the tick fix folded into step 1's spirit):
1. `computeNextTriggerAt` window support + full test suite (worked examples verbatim,
   boundary cases, no-window regression, 1D-window cases).
2. `supabase/functions/tick/index.ts` — pass window through on recompute (see scope note
   above).
3. Migration `0004_reminder_window.sql` (written only, not applied — see Flags).
4. Validation schema: optional `window_start_time`/`window_end_time` (`"HH:MM"`), zod
   refine both-or-neither, `.transform()` normalizing equal-values to `null`/`null`.
5. `packages/types` `GraphReminder` interface: add the two new nullable fields.
6. UI: time inputs on new/edit forms; `reminder-actions.ts` wiring (HH:MM → minutes
   conversion, extending the existing `scheduleChanged` recompute guard to also cover the
   window fields — comparing against the DB's `HH:MM:SS` representation normalized to
   `HH:MM` first, so an unrelated edit doesn't spuriously look like a window change).
7. Display bug fix: `reminders/page.tsx`'s `formatDate` gets the reminder's `timezone`.
8. `pnpm build` / `pnpm test` / `pnpm typecheck`; local-only verification (no live DB
   columns to test against yet — flagged clearly in BUILD-LOG, migration not applied by
   this session per the network constraint already on record as KG-8).

**Uncertain / flagging for Arch:**
- The 1D-window generalization above (see re-derivation section).
- The tick/index.ts scope addition above.
- Everything else in the brief is unambiguous and being built as specified.

Proceeding to build now (background run per instruction) rather than blocking on a
synchronous approval round-trip; both flagged items are called out again in
handoff/BUILD-LOG.md and handoff/REVIEW-REQUEST.md for Arch/Richard to weigh in on.

Architect approval: [ ] Approved / [ ] Redirect — see notes below
