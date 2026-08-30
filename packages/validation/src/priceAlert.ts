import { z } from "zod";
import { alertDirectionSchema, alertTriggerModeSchema } from "./enums";

/**
 * Refinement: if `expiration_at` is provided, it must be a valid date in the
 * future relative to when the schema is parsed.
 */
function expirationMustBeFuture(val: string | null | undefined): boolean {
  if (val === null || val === undefined || val === "") return true;
  const parsed = new Date(val);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() > Date.now();
}

const expirationAtSchema = z
  .union([z.string(), z.null()])
  .optional()
  .refine(expirationMustBeFuture, {
    message: "expiration_at must be a valid date in the future",
  });

/**
 * Fields a user supplies when creating a price alert. `instrument_id` is
 * required but the UI hardcodes it to the single seeded XAUUSD instrument
 * in Step 1 — no picker.
 */
export const createPriceAlertSchema = z.object({
  instrument_id: z.string().uuid(),
  target_price: z.number().positive({ message: "target_price must be > 0" }),
  direction: alertDirectionSchema,
  trigger_mode: alertTriggerModeSchema,
  expiration_at: expirationAtSchema,
  message: z.string().trim().max(500).optional().nullable(),
  enabled: z.boolean().default(true),
});

export type CreatePriceAlertInput = z.infer<typeof createPriceAlertSchema>;

/**
 * Fields a user may change when editing an existing alert. Same constraints
 * as create; `instrument_id` is intentionally omitted — Step 1 has exactly
 * one instrument and does not support re-targeting an alert to a different
 * one.
 */
export const updatePriceAlertSchema = z.object({
  target_price: z.number().positive({ message: "target_price must be > 0" }),
  direction: alertDirectionSchema,
  trigger_mode: alertTriggerModeSchema,
  expiration_at: expirationAtSchema,
  message: z.string().trim().max(500).optional().nullable(),
  enabled: z.boolean(),
});

export type UpdatePriceAlertInput = z.infer<typeof updatePriceAlertSchema>;
