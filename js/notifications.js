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
            const supabaseClient = window.sanjanaSupabase;
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

/* ---------------------------------------------------------
   7. Auto-Prompt Popup (Shows if notifications are OFF)
   --------------------------------------------------------- */
function checkNotificationPrompt() {
    // 1. If browser doesn't support it, stop.
    if (!("Notification" in window)) return;

    // 2. If they ALREADY enabled it, NEVER show the popup.
    if (Notification.permission === "granted") return;

    // 3. If they blocked it in browser settings, we can't ask again.
    if (Notification.permission === "denied") return;

    // 4. Check if they clicked "X" recently (hide for 7 days).
    const dismissedAt = localStorage.getItem('sanjana.push_prompt_dismissed');
    if (dismissedAt && Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) return;

    // 5. Inject the popup UI
    const promptHTML = `
        <div id="pushPrompt" style="position: fixed; bottom: 20px; right: 20px; background: var(--surface, #fff); border: 1px solid var(--border, #ddd); padding: 16px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.15); z-index: 9999; max-width: 320px; display: flex; flex-direction: column; gap: 12px; font-family: inherit;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <strong style="color: var(--text, #000); font-size: 1rem;">🔔 Stay Updated</strong>
                <button id="closePushPrompt" style="background: none; border: none; cursor: pointer; font-size: 1.2rem; color: var(--muted, #666); padding: 0; line-height: 1;">&times;</button>
            </div>
            <p style="font-size: 0.85rem; color: var(--muted, #666); margin: 0; line-height: 1.4;">Get daily current affairs, quizzes, and UPSC updates directly on your device.</p>
            <button id="enablePushPrompt" class="btn btn-primary" style="padding: 8px 16px; font-size: 0.9rem; width: 100%; cursor: pointer; border-radius: 8px;">Enable Notifications</button>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', promptHTML);

    // 6. Handle "X" button click (hide for 7 days)
    document.getElementById('closePushPrompt').addEventListener('click', () => {
        document.getElementById('pushPrompt').remove();
        localStorage.setItem('sanjana.push_prompt_dismissed', Date.now());
    });

    // 7. Handle "Enable" button click (triggers your existing function)
    document.getElementById('enablePushPrompt').addEventListener('click', () => {
        document.getElementById('pushPrompt').remove();
        enableNotifications(); // This calls the function you already have
    });
}

// Run the check 3 seconds after the page loads (so it doesn't interrupt immediately)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(checkNotificationPrompt, 3000));
} else {
    setTimeout(checkNotificationPrompt, 3000);
}