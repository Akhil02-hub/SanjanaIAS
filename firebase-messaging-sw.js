/* =========================================================
   SanjanaIAS – Firebase Cloud Messaging Service Worker
   This file MUST be at the site root:
   https://YOUR-DOMAIN/firebase-messaging-sw.js
   ========================================================= */

importScripts(
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"
);
importScripts(
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js"
);

firebase.initializeApp({
    apiKey: "AIzaSyCjWqiyyykROm5gsldT4fMJdMGON_BwJ-g",
    authDomain: "sanjanaias-dc2ce.firebaseapp.com",
    projectId: "sanjanaias-dc2ce",
    storageBucket: "sanjanaias-dc2ce.firebasestorage.app",
    messagingSenderId: "552428288490",
    appId: "1:552428288490:web:7a2ecaec004b39b5e49a93",
});

const messaging = firebase.messaging();

/* ---------------------------------------------------------
   Background messages.
   Because we define this handler, Firebase will NOT
   auto-display the notification, so we display it ourselves.
   This gives us control over icon, badge and click link.
   --------------------------------------------------------- */
messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || "SanjanaIAS";
    const body = payload.notification?.body || "";
    const link =
        payload.fcmOptions?.link ||
        payload.data?.link ||
        "https://sanjanaias.vercel.app/";

    self.registration.showNotification(title, {
        body: body,
        icon: "/logo.png",
        badge: "/logo.png",
        data: { link: link },
    });
});

/* ---------------------------------------------------------
   Notification click → open / focus the right page.
   --------------------------------------------------------- */
self.addEventListener("notificationclick", (event) => {
    event.notification.close();

    const link = event.notification.data?.link || "/";

    event.waitUntil(
        clients
            .matchAll({ type: "window", includeUncontrolled: true })
            .then((clientList) => {
                for (const client of clientList) {
                    if (client.url.startsWith(self.location.origin) && "focus" in client) {
                        if ("navigate" in client) {
                            client.navigate(link);
                        }
                        return client.focus();
                    }
                }
                if (clients.openWindow) {
                    return clients.openWindow(link);
                }
            })
    );
});