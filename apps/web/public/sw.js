// TradeFlow service worker — Web Push delivery only (no offline caching or
// asset precaching in V1). Registered by app/dashboard/notifications-control.tsx.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Non-JSON push payload — fall back to a generic notification rather
    // than letting the handler throw and drop the notification silently.
    data = {};
  }

  const title = data.title || "TradeFlow";
  const options = {
    body: data.body || "",
    data,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/dashboard");
      return undefined;
    }),
  );
});
