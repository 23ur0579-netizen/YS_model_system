// Web Push (device notifications) — free, browser-native, no third-party
// SDK. See backend/app/push.py and backend/scripts/04_generate_vapid_keys.py
// for the server side. Not supported on iOS Safari unless the site has
// been "Added to Home Screen" first — see isPushSupported().

import * as api from "./api";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function pushPermission(): NotificationPermission | "unsupported" {
  return isPushSupported() ? Notification.permission : "unsupported";
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
}

/** Registers the service worker ahead of time (no permission prompt) so
 * it's ready the moment the person opts in — safe to call on every
 * app load. */
export function registerServiceWorker(): void {
  if (!isPushSupported()) return;
  navigator.serviceWorker.register("/sw.js").catch((err) => console.error("Service worker registration failed", err));
}

/** Call only from a user gesture (a button click) — browsers require
 * that for the permission prompt. Requests permission, subscribes,
 * and tells the backend about the new subscription. */
export async function enablePush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const { key } = await api.getVapidPublicKey();
  if (!key) {
    console.error("Device notifications aren't configured on this server (no VAPID key).");
    return false;
  }

  const reg = await getRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    });
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

  await api.subscribePush({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
  return true;
}

export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  try {
    await api.unsubscribePush(endpoint);
  } catch (err) {
    console.error("Failed to tell the server about the unsubscribe", err);
  }
}

/** Whether this browser currently has an active push subscription —
 * for showing the right toggle state on load. */
export async function isPushEnabled(): Promise<boolean> {
  if (!isPushSupported() || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return !!sub;
}
