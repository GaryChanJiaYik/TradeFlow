import { z } from "zod";

/**
 * Zod mirrors of the literal-union types in @tradeflow/types/enums —
 * keep both in sync with the CHECK constraints in
 * supabase/migrations/0001_init.sql.
 */

export const alertDirectionSchema = z.enum(["CROSS_UP", "CROSS_DOWN", "CROSS_BOTH"]);

export const alertTriggerModeSchema = z.enum(["ONCE", "EVERY_TIME"]);

export const reminderTimeframeSchema = z.enum(["15m", "1H", "4H", "1D"]);
