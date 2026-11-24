// Sign-in helper for Ledgerly's Google Drive backup (Cloudflare Worker, free tier).
//
// It only deals with Google sign-in tokens; expenses never pass through it. Google gives a web page
// 1-hour tokens only, so this Worker keeps the long-lived "refresh token" (which needs the client
// secret) and hands the phone a fresh 1-hour token whenever it asks with its device key.
//
//   GET  /auth/start     -> Google's consent screen (drive.file: only files this app makes)
//   GET  /auth/callback  -> stores the refresh token under a new random device key, sends you back
//                           to the app with #drive=<device key>
//   POST /token          {key} -> { access_token, expires_in }
//   POST /disconnect     {key} -> revokes the token at Google and forgets it
//
// Settings (wrangler.toml / secrets): APP_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, KV binding TOKENS.
// KV holds sha256(device key) -> refresh token, so the stored data alone can't be used to ask for tokens.

const SCOPE = "https://www.googleapis.com/auth/drive.file";

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const appUrl = env.APP_URL;                       // e.g. https://you.github.io/ledgerly/
    const appOrigin = new URL(appUrl).origin;
    const cors = { "Access-Control-Allow-Origin": appOrigin, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors } });
    const back = (hash) => Response.redirect(`${appUrl}#${hash}`, 302);
    const redirectUri = `${url.origin}/auth/callback`;

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (url.pathname === "/auth/start" && req.method === "GET") {
      const state = randomHex(16);
      await env.TOKENS.put(`state:${state}`, "1", { expirationTtl: 600 });
      const q = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: "code", scope: SCOPE,
        access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
      });
      return new Response(null, { status: 302, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, "Cache-Control": "no-store" } });
    }

    if (url.pathname === "/auth/callback" && req.method === "GET") {
      const state = url.searchParams.get("state") || "";
      if (!/^[0-9a-f]{32}$/.test(state) || !(await env.TOKENS.get(`state:${state}`))) return back("drive-error=expired, try again");
      await env.TOKENS.delete(`state:${state}`);
      if (url.searchParams.get("error")) return back(`drive-error=${encodeURIComponent(url.searchParams.get("error"))}`);
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: url.searchParams.get("code") || "", client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: "authorization_code" }),
      });
      const tok = await res.json().catch(() => ({}));
      if (!res.ok || !tok.refresh_token) return back("drive-error=Google did not give access");
      if (!String(tok.scope || "").includes(SCOPE)) return back("drive-error=Drive access was not ticked");
      const key = randomHex(32);
      await env.TOKENS.put(`dev:${await sha(key)}`, tok.refresh_token);
      return back(`drive=${key}`);
    }

    if ((url.pathname === "/token" || url.pathname === "/disconnect") && req.method === "POST") {
      if (req.headers.get("Origin") !== appOrigin) return json({ error: "origin" }, 403);
      const { key } = await req.json().catch(() => ({}));
      if (!/^[0-9a-f]{64}$/.test(key || "")) return json({ error: "key" }, 401);
      const slot = `dev:${await sha(key)}`;
      const refresh = await env.TOKENS.get(slot);
      if (!refresh) return json({ error: "unknown" }, 401);

      if (url.pathname === "/disconnect") {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: "POST" }).catch(() => {});
        await env.TOKENS.delete(slot);
        return json({ ok: true });
      }
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }),
      });
      const tok = await res.json().catch(() => ({}));
      if (tok.error === "invalid_grant") { await env.TOKENS.delete(slot); return json({ error: "revoked" }, 401); }
      if (!res.ok || !tok.access_token) return json({ error: "google" }, 502);
      return json({ access_token: tok.access_token, expires_in: tok.expires_in });
    }

    return new Response("Not found", { status: 404 });
  },
};
