/* global importScripts, firebase, self, clients */
// Firebase Cloud Messaging service worker. Must live at site root so its
// scope is "/" — Firebase looks for /firebase-messaging-sw.js by convention
// when you call getToken() without an explicit serviceWorkerRegistration.
//
// Mirror FIREBASE_CONFIG with src/app/firebase-config.ts. The SW cannot
// import the TS module, so the two must be kept in sync by hand.

importScripts('https://www.gstatic.com/firebasejs/10.14.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.0/firebase-messaging-compat.js');

const FIREBASE_CONFIG = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  messagingSenderId: '',
  appId: ''
};

if (FIREBASE_CONFIG.apiKey) {
  firebase.initializeApp(FIREBASE_CONFIG);
  // We don't subscribe to onBackgroundMessage explicitly: when the FCM
  // payload contains a `notification` field, Firebase auto-displays it via
  // the SW. Adding our own handler would render it twice.
  firebase.messaging();
}

// Defense in depth: even though `click_url` is built server-side from a
// fixed template (see server/src/services/fcm.ts buildClickUrl), validate
// that it's same-origin before opening it. Falls back to "/" on anything
// fishy — never opens a foreign URL.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const raw = typeof data.click_url === 'string' ? data.click_url : '/';

  let target;
  try {
    target = new URL(raw, self.location.origin);
  } catch {
    target = new URL('/', self.location.origin);
  }
  if (target.origin !== self.location.origin) {
    target = new URL('/', self.location.origin);
  }

  const url = target.pathname + target.search + target.hash;
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Reuse an existing window when possible so we don't pile up duplicate
    // tabs every time the user taps a notification.
    for (const client of all) {
      const clientUrl = new URL(client.url);
      if (clientUrl.origin === self.location.origin && 'focus' in client) {
        await client.focus();
        if ('navigate' in client) {
          try {
            await client.navigate(url);
          } catch {
            // Some browsers (notably Safari/iOS) restrict navigate() —
            // ignore so focus() alone still surfaces the existing tab.
          }
        }
        return;
      }
    }
    if (clients.openWindow) {
      await clients.openWindow(url);
    }
  })());
});
