import type { PriceAlert } from "@tradeflow/types";

/**
 * The subset of PriceAlert fields evaluatePriceAlert needs. Kept as a Pick
 * (not the full row) so callers can pass partial/in-memory alert state
 * without constructing a full DB row.
 */
export type EvaluableAlert = Pick<
  PriceAlert,
  "target_price" | "direction" | "trigger_mode" | "expiration_at" | "enabled" | "last_triggered_at"
>;

/**
 * Pure, I/O-free evaluation of whether a price alert should fire on this
 * tick. The engine holds no state of its own: ONCE-mode "don't fire again"
 * is expressed entirely through the `last_triggered_at` the caller passes
 * in (the caller is responsible for persisting it after a trigger).
 *
 * Rules (see handoff/ARCHITECT-BRIEF.md Step 1 Decisions):
 * - CROSS_UP:   previousPrice < target AND currentPrice >= target
 * - CROSS_DOWN: previousPrice > target AND currentPrice <= target
 * - CROSS_BOTH: either of the above
 * - A bare `currentPrice >= target` (no actual crossing) never triggers.
 * - ONCE: only triggers if `last_triggered_at` is null (never triggered before).
 * - EVERY_TIME: may trigger repeatedly, but only on a genuine new crossing —
 *   this falls out naturally from the crossing check above, since holding
 *   past the threshold without previousPrice re-crossing it does not count.
 * - Expired (`expiration_at` in the past relative to `now`) alerts never trigger.
 * - Disabled alerts never trigger.
 */
export function evaluatePriceAlert(
  alert: EvaluableAlert,
  previousPrice: number,
  currentPrice: number,
  now: Date,
): boolean {
  if (!alert.enabled) return false;

  if (alert.expiration_at !== null) {
    const expiresAt = new Date(alert.expiration_at);
    if (expiresAt.getTime() <= now.getTime()) return false;
  }

  const crossedUp = previousPrice < alert.target_price && currentPrice >= alert.target_price;
  const crossedDown = previousPrice > alert.target_price && currentPrice <= alert.target_price;

  let crossed: boolean;
  switch (alert.direction) {
    case "CROSS_UP":
      crossed = crossedUp;
      break;
    case "CROSS_DOWN":
      crossed = crossedDown;
      break;
    case "CROSS_BOTH":
      crossed = crossedUp || crossedDown;
      break;
  }

  if (!crossed) return false;

  if (alert.trigger_mode === "ONCE" && alert.last_triggered_at !== null) {
    return false;
  }

  return true;
}
