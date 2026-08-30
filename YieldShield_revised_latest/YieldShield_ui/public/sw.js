// YieldShield service worker — handles incoming Web Push messages.
// Free, browser-native (no third-party push SDK). Served at /sw.js by
// Vite from this public/ folder as-is (no build step needed).
//
// Payload shape sent by backend/app/push.py:
//   { "title": string, "body": string, "url": string }

self.addEventListener("push", (event) => {
  let data = { title: "YieldShield", body: "You have a new update.", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Not JSON — fall back to the defaults above.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url },
    })
  );
});

// Clicking the notification focuses an existing tab if one's open,
// otherwise opens a new one at the relevant URL.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
