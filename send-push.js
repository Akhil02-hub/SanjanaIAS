const { JWT } = require("google-auth-library");
const { createClient } = require("@supabase/supabase-js");
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// Fix newline formatting for GitHub Actions
if (sa.private_key) {
    sa.private_key = sa.private_key.replace(/\\n/g, '\n');
}

const SUPA_URL = "https://lbcxwmyppnmnezyxyvon.supabase.co";
const SUPA_KEY = "sb_publishable_8acY7UihRJ2tSpW3zmFDUA_n24G5Ayq";

(async () => {
    try {
        const supa = createClient(SUPA_URL, SUPA_KEY);
        const { data, error } = await supa.from("fcm_tokens").select("token").eq("enabled", true);

        if (error) throw new Error("Supabase Read Error: " + error.message);
        const tokens = (data || []).map(r => r.token);

        if (!tokens.length) {
            console.log("No tokens found.");
            return;
        }

        const jwt = new JWT(sa.client_email, null, sa.private_key, ["https://www.googleapis.com/auth/cloud-platform"]);
        const { access_token } = await jwt.getAccessToken();

        for (const token of tokens) {
            const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
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
            console.log(`Token ${token.slice(0, 10)}... Status: ${res.status}`);
        }
    } catch (err) {
        console.error("❌ CRASH ERROR:", err.message);
        process.exit(1);
    }
})();