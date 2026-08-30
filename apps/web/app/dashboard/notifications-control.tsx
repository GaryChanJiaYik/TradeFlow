"use client";

import { useCallback, useEffect, useState } from "react";
import { upsertDeviceAction } from "./device-actions";

/**
 * Converts a base64url-encoded VAPID public key (the format
 * `web-push generate-vapid-keys` outputs, and what
 * `NEXT_PUBLIC_VAPID_PUBLIC_KEY` holds) into the Uint8Array
 * `PushManager.subscribe`'s `applicationServerKey` expects.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

type Status = "checking" | "unsupported" | "denied" | "subscribed" | "unsubscribed" | "error";

/**
 * Dashboard control for opting this browser into Web Push. A client
 * component island (needs `navigator`/`window`) rendered from the
 * otherwise-server `dashboard/page.tsx`, same pattern as the edit-alert
 * form. Never surfaces raw browser/network errors — only friendly status
 * text, per the project's error-handling standard.
 */
export function NotificationsControl() {
  const [status, setStatus] = useState<Status>("checking");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then(async (registration) => {
        const existing = await registration.pushManager.getSubscription();
        setStatus(existing ? "subscribed" : "unsubscribed");
      })
      .catch(() => setStatus("error"));
  }, []);

  const enable = useCallback(async () => {
    setMessage(null);
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) {
      setStatus("error");
      setMessage("Push notifications are not configured on this deployment.");
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast needed under the current lib.dom typings: `Uint8Array`'s
        // generic default is `ArrayBufferLike` (which includes
        // `SharedArrayBuffer`), while `BufferSource` requires a view over a
        // concrete `ArrayBuffer` — a real mismatch in the *type*, not the
        // runtime value (the buffer here is always a plain ArrayBuffer).
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      const result = await upsertDeviceAction(subscription.toJSON());
      if (result.error) {
        setStatus("error");
        setMessage(result.error);
        return;
      }
      setStatus("subscribed");
    } catch {
      setStatus("error");
      setMessage("Could not enable notifications. Please try again.");
    }
  }, []);

  if (status === "checking" || status === "unsupported") return null;

  return (
    <div className="notifications-control">
      {status === "subscribed" && <span className="muted">Notifications enabled on this device.</span>}
      {status === "denied" && (
        <span className="muted">Notifications are blocked — enable them in your browser&apos;s site settings.</span>
      )}
      {(status === "unsubscribed" || status === "error") && (
        <button className="btn btn-secondary" type="button" onClick={enable}>
          Enable notifications
        </button>
      )}
      {message && <div className="form-error">{message}</div>}
    </div>
  );
}
