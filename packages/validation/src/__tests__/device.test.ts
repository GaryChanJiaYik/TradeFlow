import { describe, expect, it } from "vitest";
import { webPushSubscriptionSchema } from "../device";

function subscriptionWithEndpoint(endpoint: string) {
  return {
    endpoint,
    expirationTime: null,
    keys: {
      p256dh: "test-p256dh-key",
      auth: "test-auth-secret",
    },
  };
}

describe("webPushSubscriptionSchema", () => {
  it.each([
    ["Chrome/Android (FCM)", "https://fcm.googleapis.com/fcm/send/abc123"],
    ["Firefox", "https://updates.push.services.mozilla.com/wpush/v2/abc123"],
    ["Safari", "https://web.push.apple.com/abc123"],
    ["Edge/Windows (WNS)", "https://wns2-abc.notify.windows.com/w/abc123"],
  ])("accepts a valid https endpoint for %s", (_label, endpoint) => {
    const result = webPushSubscriptionSchema.safeParse(subscriptionWithEndpoint(endpoint));
    expect(result.success).toBe(true);
  });

  it("rejects a plain http endpoint on an otherwise-allowlisted host", () => {
    const result = webPushSubscriptionSchema.safeParse(
      subscriptionWithEndpoint("http://fcm.googleapis.com/fcm/send/abc123"),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a non-allowlisted https host (the SSRF case)", () => {
    const result = webPushSubscriptionSchema.safeParse(
      subscriptionWithEndpoint("https://internal.example.com/"),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a malformed URL", () => {
    const result = webPushSubscriptionSchema.safeParse(subscriptionWithEndpoint("not-a-url"));
    expect(result.success).toBe(false);
  });

  it("rejects a non-https scheme entirely, e.g. file:", () => {
    const result = webPushSubscriptionSchema.safeParse(
      subscriptionWithEndpoint("file:///etc/passwd"),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a host that merely contains an allowlisted host as a substring", () => {
    const result = webPushSubscriptionSchema.safeParse(
      subscriptionWithEndpoint("https://fcm.googleapis.com.evil.example.com/fcm/send/abc123"),
    );
    expect(result.success).toBe(false);
  });
});
