const { JWT } = require("google-auth-library");

let saStr = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!saStr) {
    console.error("❌ CRASH ERROR: The GitHub Secret FIREBASE_SERVICE_ACCOUNT is completely empty.");
    process.exit(1);
}

saStr = saStr.trim();
if (saStr.startsWith("ewogIC")) {
    saStr = Buffer.from(saStr, 'base64').toString('utf8');
}

let sa;
try {
    sa = JSON.parse(saStr);
} catch (e) {
    console.error("❌ CRASH ERROR: The secret is not valid JSON. It starts with:", saStr.slice(0, 30));
    process.exit(1);
}

if (!sa.private_key) {
    console.error("❌ CRASH ERROR: The JSON is missing 'private_key'. Keys found:", Object.keys(sa));
    process.exit(1);
}

sa.private_key = sa.private_key.replace(/\\n/g, '\n');

const SUPA_URL = "https://lbcxwmyppnmnezyxyvon.supabase.co";
const SUPA_KEY = "sb_publishable_8acY7UihRJ2tSpW3zmFDUA_n24G5Ayq";

(async () => {
    try {
        const res = await fetch(`${SUPA_URL}/rest/v1/fcm_tokens?select=token&enabled=eq.true`, {
            headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
        });

        const data = await res.json();
        if (!Array.isArray(data)) {
            console.error("❌ CRASH ERROR: Supabase returned an error:", data);
            process.exit(1);
        }

        const tokens = data.map(r => r.token);

        if (!tokens.length) {
            console.log("No tokens found in database.");
            return;
        }

        // ✅ THE FIX IS HERE: Passing an object instead of positional arguments
        const jwt = new JWT({
            email: sa.client_email,
            key: sa.private_key,
            scopes: ["https://www.googleapis.com/auth/cloud-platform"]
        });

        const { access_token } = await jwt.getAccessToken();

        for (const token of tokens) {
            const response = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
                method: "POST",
                headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: {
                        token: token,
                        notification: { title: process.argv[2] || "SanjanaIAS", body: process.argv[3] || "Update" },
                        webpush: { fcmOptions: { link: process.argv[4] || "https://sanjanaias.vercel.app/" } }
                    }
                })
            });
            console.log(`Sent to ${token.slice(0, 10)}... Status: ${response.status}`);
        }
    } catch (err) {
        console.error("❌ CRASH ERROR:", err.message);
        process.exit(1);
    }
})();