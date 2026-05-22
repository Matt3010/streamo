// Public Firebase client config + VAPID key. These values are safe to ship
// to the browser (they're identifiers, not secrets) — the *server* holds
// the signing service-account JSON via FCM_SERVICE_ACCOUNT_JSON.
//
// To enable push for this deployment:
//   1. Create a Firebase project, enable Cloud Messaging.
//   2. Settings → General → "Your apps" → register a Web app, copy the
//      config into FIREBASE_CONFIG below.
//   3. Settings → Cloud Messaging → "Web configuration" → generate a
//      VAPID key, paste it into VAPID_KEY below.
//   4. Mirror FIREBASE_CONFIG inside src/firebase-messaging-sw.js
//      (the service worker can't import this .ts file).
//
// Until those values are populated the in-app inbox (WebSocket) still
// works — only OS-level push delivery is disabled.

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
}

export const FIREBASE_CONFIG: FirebaseClientConfig = {
  apiKey: 'AIzaSyCbDbwT_9aQqztsEnYmW2QlQAqRgLeL3NM',
  authDomain: 'air-app-99861.firebaseapp.com',
  projectId: 'air-app-99861',
  messagingSenderId: '494300586333',
  appId: '1:494300586333:web:66776a5f04b83f4b9148b4'
};

export const VAPID_KEY = 'BNGqvibi4yPUFzVtKU069Pyg8sD7HhBlFgfKmanGlpDSnwcYVEJ4K3W54C0MYxQXuA1SuKPfJsJ08TfGhEFZlbw';

export function isFirebaseConfigured(): boolean {
  return Boolean(
    FIREBASE_CONFIG.apiKey
    && FIREBASE_CONFIG.projectId
    && FIREBASE_CONFIG.messagingSenderId
    && FIREBASE_CONFIG.appId
    && VAPID_KEY
  );
}
