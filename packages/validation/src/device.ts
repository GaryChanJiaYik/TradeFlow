import { z } from "zod";

/**
 * Exact-match allowlist of known Web Push service hostnames.
 */
const ALLOWED_PUSH_ENDPOINT_HOSTS = [
  "fcm.googleapis.com", // Chrome / Android
  "updates.push.services.mozilla.com", // Firefox
  "web.push.apple.com", // Safari
] as const;

/**
 * Suffix-match allowlist (subdomain can vary per device/registration).
 */
const ALLOWED_PUSH_ENDPOINT_HOST_SUFFIXES = [
  ".notify.windows.com", // Edge / Windows (WNS), e.g. wns2-xyz.notify.windows.com
] as const;

function isAllowedPushEndpointHost(hostname: string): boolean {
  const lowerHost = hostname.toLowerCase();
  if ((ALLOWED_PUSH_ENDPOINT_HOSTS as readonly string[]).includes(lowerHost)) {
    return true;
  }
  return ALLOWED_PUSH_ENDPOINT_HOST_SUFFIXES.some((suffix) => lowerHost.endsWith(suffix));
}

/**
 * `endpoint` must be a real browser push-service URL: `https:` only, and
 * hostname restricted to the known Web Push services (Chrome/Android,
 * Firefox, Safari, Edge/Windows). A real `PushManager.subscribe()` call can
 * only ever produce an endpoint under one of these hosts — anything else
 * reaching this schema did not come from a real browser subscription.
 *
 * This is defense in depth against SSRF: `endpoint` is stored directly in
 * `devices.subscription` and later fed straight into `webpush.sendNotification`
 * by `supabase/functions/tick/index.ts`, which pg_cron invokes every 2 minutes
 * with server-side network access. Without this restriction, an authenticated
 * user could submit an arbitrary URL (internal host, cloud-metadata-style
 * address, or unbounded third party) via the server action directly — not
 * only via a real browser push subscription — and get a recurring,
 * server-triggered outbound HTTP request against it.
 */
const pushEndpointSchema = z
  .string()
  .url()
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid push subscription endpoint URL.",
      });
      return;
    }

    if (url.protocol !== "https:") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Push subscription endpoint must use https.",
      });
      return;
    }

    if (!isAllowedPushEndpointHost(url.hostname)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Push subscription endpoint host is not a recognized push service.",
      });
    }
  });

/**
 * Mirrors the Web Push `PushSubscription.toJSON()` shape (see
 * `@tradeflow/types`'s `WebPushSubscriptionJson`). Validated structurally
 * here rather than trusted as opaque JSON, since it comes straight from the
 * browser via a client component and is stored directly in `devices.subscription`.
 */
export const webPushSubscriptionSchema = z.object({
  endpoint: pushEndpointSchema,
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

/**
 * Input for the devices-upsert server action (`upsertDeviceAction`). Only
 * `web` is supported in V1 — no native iOS/Android push path exists yet,
 * even though `devices.platform` also allows those values for future use.
 */
export const upsertDeviceSchema = z.object({
  platform: z.literal("web"),
  subscription: webPushSubscriptionSchema,
});

export type UpsertDeviceInput = z.infer<typeof upsertDeviceSchema>;
