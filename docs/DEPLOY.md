# Deploying Capture (Cloudflare Pages)

Capture is static files in `app/` — no build step. All user data stays on the device; the hosted files contain none.

## One-time setup (Cloudflare dashboard)
1. Sign in at dash.cloudflare.com (a free account is fine).
2. **Workers & Pages → Create → Pages → Connect to Git.** Authorize the Cloudflare GitHub app for **only** the `timetracker` repo (it can stay private).
3. Project settings:
   - **Production branch:** `claude/pensive-volta-9h1pep` (change to `main` later if you create one)
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `app`
4. **Save and Deploy.** Your URL will look like `https://<project>.pages.dev`.

Every push to the production branch redeploys automatically. `app/_headers` sets security headers and makes `sw.js`/`index.html` revalidate so updates reach the phone.

## Before each release
```bash
npm test && npm run smoke
```
When app files change, bump `CACHE` in `app/sw.js` (e.g. `capture-v4` → `capture-v5`).

## Install on iPhone
1. Open the URL in **Safari**.
2. Share → **Add to Home Screen** → Add.
3. Always open Capture from the home-screen icon (Safari tabs keep separate data).
4. In Capture → Settings: add your work email and blocked words; then add your first nickname.

## Optional: restrict who can load the app
The URL is public but serves no data. To limit it to you anyway, add **Cloudflare Access** (Zero Trust → Access → Applications → self-hosted, your email as the only allowed identity). Note: Access needs a sign-in every so often, which can be awkward offline-first; the app still works offline once cached.
