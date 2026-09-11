# Review Feedback — Step 8
Date: 2026-09-11
Ready for Builder: NO

## Must Fix

- `supabase/functions/tick/index.ts:185` — `checkChartGoldPriceAccuracy`'s
  catch block (covers `ChartGoldPriceProviderError` cases like `STALE_DATA`,
  plus any other thrown error) logs via `console.log`:
  ```
  console.log(`chartgoldprice.com accuracy check skipped: ${reason}`);
  ```
  I independently checked this against the file's own established convention
  before agreeing with Arch, rather than taking the framing on faith. Every
  other genuine-failure branch in both `tick` and `tick-fast` — including the
  pre-Step-8 `tick/index.ts`'s old Binance-fetch-failure branch and its
  `FallbackProviderError` branch (both providers failing, i.e. the *exact
  same* "expected, non-critical, chartgoldprice-is-stale" scenario this code
  used to handle before Step 8), plus `tick-fast`'s current
  `console.error("XAUUSD price fetch (Binance) failed:", ...)` — is logged at
  `console.error` unconditionally, with no carve-out for "this is an
  anticipated condition." The pattern in this codebase has never been
  "expected failures get console.log"; it's "provider/write failures get
  console.error, successful routine observability gets console.log." This
  branch is the one place in the new code that breaks that pattern.
  Practical effect: Supabase's dashboard log filter for error-level entries —
  the tool the owner would actually use to notice a chartgoldprice problem —
  will not surface it. Fix: change this one line to `console.error`. The two
  earlier skip returns in the same function (`instrumentError`/no instrument,
  and `last_price === null`) correctly log nothing at all, matching the
  pre-Step-8 file's identical pattern for "instrument not found" — leave
  those as-is, this is only about the catch block's `console.log`.

## Should Fix

- `supabase/functions/tick/index.ts:78-133` (`processGraphReminders`) — Build
  report claims this was kept "verbatim." Diffed byte-for-byte against its
  state in `136a76e` (the last commit to touch this file, Step 7) and it is
  **not** identical: the in-loop comment changed from `// Same ordering
  requirement as processPriceAlerts: advance` to `// Same ordering
  requirement as processPriceAlerts (tick-fast): advance`. Zero behavioral
  difference — `processPriceAlerts` really did move to `tick-fast`, so the
  parenthetical is accurate — but "verbatim"/"byte-for-byte" was the explicit
  claim, and this is exactly the kind of drift that claim is supposed to rule
  out. `timeStringToMinutes`/`buildReminderWindowArg` (lines 63-76) and the
  function body of `processGraphReminders` itself (the actual logic, lines
  79-132) diffed clean. Recommend either reverting the parenthetical or
  correcting the build report's wording from "verbatim" to "logic verbatim,
  one comment updated for accuracy."
- `supabase/functions/_shared/notifications.ts:19` (`describeProviderError`)
  — same category of issue. Build report claims this file is "byte-for-byte
  extraction... only export keywords added, no logic changed." Diffed clean
  on `getRequiredEnv`, `configureWebPush`, `PushResult`, `pushToUserDevices`,
  and `logNotification` (all identical modulo the added `export`), but
  `describeProviderError`'s doc comment was reworded: "Formats one
  provider-level error for **the tick response summary**" →  "Formats one
  provider-level error for **a function's response summary**." Sensible edit
  (the function now serves two callers, not one), zero logic change, but not
  literally "only export keywords added" as claimed. Recommend correcting the
  build report's wording the same way as above.

## Escalate to Architect
None.

## Cleared

**1. `processPriceAlerts` in `tick-fast/index.ts` (lines 44-124).** Diffed
byte-for-byte against its exact location in the pre-Step-8 `tick/index.ts`
(commit `136a76e`, lines 215-293): identical, including Step 6's
confirm-write-before-push ordering. Read the block in full independent of the
diff: the `price_alerts` update (`.update(update).eq("id", alert.id)`) is
awaited, `updateError` is checked, and on error the loop `continue`s before
reaching the `pushToUserDevices`/`logNotification` calls — there is no
fall-through path from a failed update to a push. Step 6's hardening is
genuinely intact in the new hot path, not just copy-pasted with the ordering
subtly reshuffled.

**2. Structural guarantee: `tick-fast` never touches `graph_reminders`.**
Grepped the full file — the only occurrence of the string is in a top-of-file
comment describing the guarantee itself; no `.from("graph_reminders")`
anywhere.

**3. Structural guarantee: narrowed `tick` never writes `instruments`.**
Grepped the full file — the only `.from("instruments")` call (line 150) is a
`.select(...)`; the only `.update(...)` call in the whole file (line 110) is
on `graph_reminders`, inside `processGraphReminders`. `tick-fast` is
confirmed the sole writer of `instruments.last_price`/`last_price_at` going
forward.

**4. `tick-fast` uses `BinanceProvider` directly, no chartgoldprice in the
hot path.** Line 25 imports `BinanceProvider` from
`packages/market-data/src/binanceProvider.ts`; line 152 instantiates it
directly (`new BinanceProvider()`). No `FallbackMarketDataProvider` or
`ChartGoldPriceProvider` import or reference anywhere in `tick-fast/index.ts`.

**5. `_shared/notifications.ts` extraction.** Diffed `PushResult`,
`pushToUserDevices`, and `logNotification` against their pre-Step-8 location
in `tick/index.ts` (commit `136a76e`) — byte-for-byte identical apart from
the added `export` keywords. `getRequiredEnv` and `configureWebPush` likewise
identical. `buildFallbackProvider` (present in the old file, not in the
shared-helpers list Bob's report names) was correctly dropped rather than
extracted — it isn't shared logic, it's a Step 7 provider-wiring helper that's
now unused. Confirmed both `tick/index.ts` and `tick-fast/index.ts` import
`configureWebPush`/`describeProviderError`/`getRequiredEnv`/
`logNotification`/`pushToUserDevices` from `../_shared/notifications.ts` — no
duplicate definitions in either file. (One doc-comment wording exception
noted under Should Fix above.)

**6. `0005_tick_fast_cron.sql`.** The cron job body's bearer token reads
`vault.decrypted_secrets where name = 'tick_function_service_role_key'` — the
same secret name `0003_cron.sql` created, not a new/duplicate one. Only a new
`tick_fast_function_url` secret is introduced, and only via a documented
one-time `vault.create_secret(...)` comment (not executed by the migration
itself, consistent with `0003_cron.sql`'s own pattern for its two secrets).
The file contains exactly one `cron.schedule(...)` call
(`tick-fast-every-10-seconds`); nothing in the file references job id 1
(`tick-every-2-minutes`) or calls `cron.unschedule`/`cron.alter_job` against
it — that job is genuinely left untouched. Rollback line is documented in a
comment only, not executed.

**7. Build/typecheck/test, re-run independently, not trusted from the
report.**
- `deno check --node-modules-dir=auto` clean on all three Deno files:
  `supabase/functions/tick/index.ts`, `supabase/functions/tick-fast/index.ts`,
  `supabase/functions/_shared/notifications.ts`. (Plain `deno check` fails in
  this environment with an npm-resolution error unrelated to Bob's code —
  `--node-modules-dir=auto` against the existing root `node_modules` resolves
  it; same result either way once resolvable.)
- `pnpm typecheck` at repo root: 8/8 tasks pass (cached, no package internals
  changed by this step — expected, since only `supabase/functions/**` and
  `supabase/migrations/**` changed).
- `pnpm build`: 5/5 tasks pass, `web` build compiles and generates all 11
  pages successfully.
- `pnpm test`: 6/6 tasks pass, **94/94 tests** (`validation` 37,
  `market-data` 25, `alert-engine` 32) — matches the build report's claimed
  count exactly.

**8. No drift.** Read both new/modified function files in full: nothing
beyond what the brief and build report describe — no extra endpoints, no
extra tables touched, no new env vars beyond the two Vault secrets already
accounted for in the migration.

Signal to Arch: Step 8 has one required fix (`console.log` → `console.error`
at `tick/index.ts:185`, one line, no design decision needed — Arch's call on
this is correct, verified independently against the codebase's own
convention) plus two build-report wording corrections (Should Fix). Once the
one-line fix lands, re-verification is trivial: the same catch block, same
line — no full re-review needed.

## Round 2 (2026-09-11)

Targeted re-verification of the fix round only, per Bob's claims in
`handoff/REVIEW-REQUEST.md`'s "Fix Round" section. Not a full re-review —
round 1 already cleared everything else in this step.

1. **Must Fix — confirmed fixed, correctly scoped.** Read
   `checkChartGoldPriceAccuracy` (`supabase/functions/tick/index.ts:146-188`)
   in full. Line 170 (success-path delta-comparison log, inside the `try`
   block) is still `console.log`, unchanged — correct, that's routine
   observability. Line 185, the catch block's skip/failure branch, is now
   `console.error(\`chartgoldprice.com accuracy check skipped: ${reason}\`)`.
   The fix touches only that one branch — the two earlier skip returns
   (`instrumentError`/no instrument at line 157, `last_price === null` at
   line 160) still log nothing at all, matching the pre-Step-8 pattern, as
   intended. No collateral changes to the surrounding function.

2. **Re-verification, run independently, not trusted from the report.**
   - `pnpm test` at repo root: 6/6 tasks pass, 94/94 tests
     (`validation` 37, `market-data` 25, `alert-engine` 32) — same count as
     round 1, confirming no test-relevant code changed beyond the one line.
   - `deno check --node-modules-dir=auto` on `supabase/functions/tick/index.ts`
     and `supabase/functions/tick-fast/index.ts`: both clean, no errors.

3. **Should Fix wording corrections — skimmed, accurate.** Checked
   `handoff/BUILD-LOG.md` (lines 70, 72, 93) and
   `handoff/REVIEW-REQUEST.md` (lines 8-9, 37-43, 72-76): both now
   characterize the `describeProviderError` doc comment and the
   `processGraphReminders` in-loop comment as "logic verbatim, comment
   reworded" with explicit "zero logic change" / "zero behavioral
   difference" language, rather than the original "byte-for-byte"/"verbatim"
   claims. This matches round 1's actual finding — comment-only drift, no
   underlying logic touched — and I'm not re-diffing the logic itself here
   since round 1 already confirmed it clean against `136a76e`.

**Verdict: Step 8 is clear.** The one Must Fix is genuinely fixed and
correctly scoped, both Should Fix items are resolved via accurate wording
corrections (no code change needed, none made), and independent
test/typecheck re-runs are green. Ready for Arch to proceed to deploy per
the Open Questions in `handoff/REVIEW-REQUEST.md`.
