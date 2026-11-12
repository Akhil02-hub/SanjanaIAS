const { JWT } = require("google-auth-library");
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

const SUPA_URL = "https://lbcxwmyppnmnezyxyvon.supabase.co";
const SUPA_KEY = "sb_publishable_8acY7UihRJ2tSpW3zmFDUA_n24G5Ayq";

(async () => {
    try {
        // Get tokens directly from Supabase REST API
        const res = await fetch(`${SUPA_URL}/rest/v1/fcm_tokens?select=token&enabled=eq.true`, {
            headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
        });

        const data = await res.json();
        const tokens = data.map(r => r.token);

        if (!tokens.length) {
            console.log("No tokens found in database.");
            return;
        }

        const jwt = new JWT(sa.client_email, null, sa.private_key, ["https://www.googleapis.com/auth/cloud-platform"]);
        const { access_token } = await jwt.getAccessToken();

        for (const token of tokens) {
            const response = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
                method: "POST",
                headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: {
                        token: token,
                        notification: { title: process.argv[2] || "SanjanaIAS", body: process.argv[3] || "Update" },
                        webpush: { fcmOptions: { link: "https://sanjanaias.vercel.app/" } }
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