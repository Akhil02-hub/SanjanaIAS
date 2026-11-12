const { JWT } = require("google-auth-library");
const { createClient } = require("@supabase/supabase-js");
const sa = require("./service-account.json");

const SUPA_URL = "https://lbcxwmyppnmnezyxyvon.supabase.co";
const SUPA_KEY = "sb_publishable_8acY7UihRJ2tSpW3zmFDUA_n24G5Ayq";

(async () => {
    // Get title and body from terminal, or use defaults
    const title = process.argv[2] || "SanjanaIAS Update";
    const body = process.argv[3] || "New study material is available!";

    const supa = createClient(SUPA_URL, SUPA_KEY);
    const { data } = await supa.from("fcm_tokens").select("token").eq("enabled", true);
    const tokens = (data || []).map(r => r.token);

    if (!tokens.length) {
        console.log("No tokens found in Supabase.");
        return;
    }

    const jwt = new JWT(sa.client_email, null, sa.private_key, ["https://www.googleapis.com/auth/cloud-platform"]);
    const { access_token } = await jwt.getAccessToken();

    console.log(`Sending to ${tokens.length} devices...`);

    for (const token of tokens) {
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
            method: "POST",
            headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                message: {
                    token,
                    notification: { title: title, body: body },
                    webpush: { fcmOptions: { link: "https://sanjanaias.vercel.app/" } }
                }
            })
        });

        if (res.status === 200) {
            console.log(`✅ Sent to ${token.slice(0, 15)}...`);
        } else {
            console.log(`❌ Failed for ${token.slice(0, 15)}:`, await res.text());
        }
    }
})();