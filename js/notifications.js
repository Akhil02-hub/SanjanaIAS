/* =========================================================
   SanjanaIAS – Push Notification Frontend
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getMessaging,
    getToken,
    onMessage,
    isSupported,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

/* ---------------------------------------------------------
   1. Firebase config (public – safe in frontend)
   --------------------------------------------------------- */
const firebaseConfig = {
    apiKey: "AIzaSyCjWqiyyykROm5gsldT4fMJdMGON_BwJ-g",
    authDomain: "sanjanaias-dc2ce.firebaseapp.com",
    projectId: "sanjanaias-dc2ce",
    storageBucket: "sanjanaias-dc2ce.firebasestorage.app",
    messagingSenderId: "552428288490",
    appId: "1:552428288490:web:7a2ecaec004b39b5e49a93",
};

/* ---------------------------------------------------------
   2. VAPID public key  ← REPLACE THIS ONE LINE
   --------------------------------------------------------- */
const VAPID_KEY = "BAW2peCM0IqAGeGEuylxHcqUngPhl0pD84M-GADcTIS0OWEOOU-UCYFajkM2LAWSfuvTz-riCiW81cnIGdTFeXk";

/* ---------------------------------------------------------
   3. Init
   --------------------------------------------------------- */
const app = initializeApp(firebaseConfig);

let messaging = null;
let notificationsEnabled = false;

const button = document.getElementById("enableNotifications");
const statusEl = document.getElementById("notificationStatus");

function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
}

/* ---------------------------------------------------------
   4. Show foreground notification
   (uses the service worker so it works on Android too)
   --------------------------------------------------------- */
function showForegroundNotification(payload) {
    const title = payload.notification?.title || "SanjanaIAS";
    const body = payload.notification?.body || "";
    const link = payload.fcmOptions?.link || "/";

    navigator.serviceWorker.ready
        .then((registration) => {
            registration.showNotification(title, {
                body: body,
                icon: "/logo.png",
                badge: "/logo.png",
                data: { link: link },
            });
        })
        .catch((err) => console.error("Foreground notification error:", err));
}

/* ---------------------------------------------------------
   5. Enable notifications (runs only after the user clicks)
   --------------------------------------------------------- */
async function enableNotifications() {
    try {
        if (!("Notification" in window) || !("serviceWorker" in navigator)) {
            throw new Error("This browser does not support web push.");
        }

        if (!(await isSupported())) {
            throw new Error("Firebase Messaging is not supported in this browser.");
        }

        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
            setStatus("Notification permission was not granted.");
            return;
        }

        setStatus("Registering device…");

        const registration = await navigator.serviceWorker.register(
            "/firebase-messaging-sw.js",
            { scope: "/firebase-messaging-sw-scope/" }
        );

        // Wait for THIS registration's worker to become active.
        // navigator.serviceWorker.ready can resolve to the old sw.js,
        // which has no active worker for this scope.
        await new Promise((resolve, reject) => {
            const worker = registration.installing || registration.waiting || registration.active;
            if (!worker) {
                reject(new Error("Service worker registration has no worker."));
                return;
            }
            if (worker.state === "activated") {
                resolve();
                return;
            }
            worker.addEventListener("statechange", () => {
                if (worker.state === "activated") resolve();
            });
        });

        messaging = getMessaging(app);

        const token = await getToken(messaging, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: registration,
        });

        if (!token) {
            throw new Error("Could not generate an FCM token.");
        }

        console.log("FCM Token:", token);

        // Save token to Supabase so you can send notifications later
        try {
            const supabaseClient = window.supabaseClient || window.supabase;
            if (!supabaseClient) {
                console.warn("Supabase client not found on window.");
            } else {
                const { error: saveError } = await supabaseClient
                    .from("fcm_tokens")
                    .insert({ token: token, platform: "web" });

                if (saveError && saveError.code !== "23505") {
                    console.warn("Could not save token to Supabase:", saveError);
                }
            }
        } catch (saveError) {
            console.warn("Could not save token to Supabase:", saveError);
        }

        notificationsEnabled = true;
        setStatus("Notifications enabled successfully!");
        button.disabled = true;
        button.textContent = "Notifications Enabled ✓";

        // Listen for foreground messages
        onMessage(messaging, (payload) => {
            console.log("Foreground notification:", payload);
            showForegroundNotification(payload);
        });
    } catch (error) {
        console.error("Notification error:", error);
        setStatus(error.message || "Could not enable notifications.");
    }
}

/* ---------------------------------------------------------
   6. Wire up the button
   --------------------------------------------------------- */
if (button) {
    button.addEventListener("click", () => {
        if (notificationsEnabled) return;
        enableNotifications();
    });
} else {
    console.warn('Button with id="enableNotifications" was not found.');
}