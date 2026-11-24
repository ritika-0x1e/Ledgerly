# Ledgerly

Ledgerly is a paper-style monthly expense notebook for your phone. You write lines like `- 4.00 bus` and the app adds them up:
each tag's total, the month's expense total, and the Totals result at the top. **Your data stays on your
phone** (in the browser's IndexedDB). The only thing that leaves the phone is the optional Google Drive backup,
which goes straight from the phone to your own Drive.

## Put it online (free, GitHub Pages)
1. Push this repository to GitHub (public is fine: only the app's code is in it, never your expenses).
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The *Deploy to GitHub Pages* action runs on every push. Your app is then at
   `https://<your-username>.github.io/<repo-name>/`.

## Install on your phone
- **Android (Chrome):** open the link, then ⋮ → **Install app**.
- **iPhone (Safari):** Share → **Add to Home Screen**. Install first, then enter data: on iPhone the
  home-screen app keeps its data separately from Safari.

On first start the app asks which currency you use (change it later in the menu). The menu also has
**Theme**: Light (the paper look) or Dark. Until you pick one, it starts in your phone's setting.

## Using the notebook
Each month is one page; switch months with ‹ › or the month list at the top.

The notebook is one long page: months scroll by newest first, and older months load as you reach them.
Each month's name and total stay pinned at the top while you're in that month.

**Totals** (top of each month, as long as its lines) holds your monthly sums, for example:
```
   2388.00 Available to spend in October
    286.03 Regular expenses
  +1800.00 Salary October
    500.00 Standard savings
─────────────
   1567.18 Available to spend in November      ← result: worked out, you only write its label
```
- Figures sit on the left. A figure you start with `+` is money in; every other figure is taken off.
  Only `+` is shown, so spending reads as a plain amount.
- The result is the sum of every Totals line with a figure, money in minus the rest. Its label is yours.
- Lines whose label names a tag ("Regular expenses") get that tag's total filled in, and the first line
  gets last month's result. Filled-in figures are shown in a lighter ink; type your own figure to override.
  The settings button (top right) lets you choose what each one follows (last month, a tag, or nothing).
- Salary, savings, rent and other lines are never guessed: they start blank each month.
- A new month copies last month's Totals labels with the month names moved on ("Salary October" →
  "Salary November").

**Expenses** (below Totals): lines with no tag first, then a section per tag with its total, then the
month's expense total.
- Write `4 bus`, `bus 4` or `-4 bus`: it becomes `4.00 bus` when you finish the line, and counts as spent.
  Start with `+` for money coming in (`+8.50 refund`).
- Add `#major` to a line to move it to that tag's section (in Totals, it links the line to that tag).
- Lines without a figure are notes. Blank lines are fine anywhere and never count.
- `____`, `----`, `====` or `———` on a line draws a rule; rules never affect the sums.

**Tags** (settings button, top right): Regular and Major to start with; add, rename, recolour, reorder or delete.
Tag names match by their words only, so `EXPENSES: Regular`, `(regular)` and `REGULAR -` are all Regular.

## Import and export
- **Import** (menu) takes `.txt` notes in the notebook format, or a `.csv` from this app:
  ```
  =====
  Sept 2026
  =====
  + 2000.00 Available to spend in September
  - 505.65 Regular expenses
  ...
  EXPENSES: Regular
  - 4.00 bus
  ```
  Month banners and `EXPENSES: X` headers place the lines; a header for a tag you don't have creates it.
  Rules, `total` lines and hand-written subtotals are dropped because the app works them out again.
  If a month already has entries, you're asked before it's replaced.
- **Pasting** several lines does the same clean-up and places them in the same way.
- **Download as text** writes all months in that format (it imports back). **Download as CSV** has columns
  `month,section,sign,amount,label`.

## Google Drive backup (optional, about 15 minutes, free)
The app saves one text file per month (`Oct 2026.txt`) in a Drive folder called **Ledgerly**.
It backs up when you open the app (if the last backup is over a day old), when you leave it, and from
**menu → Back up to Drive now**. Only months changed since their last upload are sent. The app can only see the
files it made itself.

A web page on its own only gets 1-hour Google sign-ins. So that you sign in **once**, a tiny Cloudflare
Worker (in `worker/`) keeps Google's long-lived token and hands the phone a fresh 1-hour one when it
backs up. Your expenses never pass through the Worker.

### 1. Google Cloud
1. Go to <https://console.cloud.google.com>, create a project.
2. **APIs & Services → Library →** enable **Google Drive API**.
3. **OAuth consent screen:** External; app name, your email. Add the scope
   `https://www.googleapis.com/auth/drive.file`. Then **Publish app** so its status is **In production**
   (in "Testing", Google ends the sign-in every 7 days). `drive.file` needs no Google review; Google
   shows an "unverified app" notice at sign-in. Choose *Advanced → Go to …* to carry on.
4. **Credentials → Create credentials → OAuth client ID → Web application.** Under **Authorised redirect
   URIs** add `https://ledgerly-drive.<your-subdomain>.workers.dev/auth/callback` (you'll know the exact
   address after step 2.4 below; you can come back and add it). Keep the **client ID** and **client secret**.

### 2. Cloudflare Worker
Needs Node.js and a free Cloudflare account.
1. `cd worker`
2. `npx wrangler login`
3. `npx wrangler kv namespace create TOKENS` and paste the `id` it prints into `wrangler.toml`.
4. In `wrangler.toml` set `APP_URL` to your app's address, ending in `/`
   (e.g. `https://you.github.io/ledgerly/`).
5. `npx wrangler secret put GOOGLE_CLIENT_ID` and `npx wrangler secret put GOOGLE_CLIENT_SECRET`
   (paste the values from Google Cloud).
6. `npx wrangler deploy`. It prints the Worker's address, e.g. `https://ledgerly-drive.you.workers.dev`.
   Make sure `<that address>/auth/callback` is in the Google redirect URIs (step 1.4).

### 3. The app
1. In `js/config.js` set `workerUrl: "https://ledgerly-drive.you.workers.dev"` and push.
2. If the Worker is on your own domain instead of `workers.dev`, add that domain to `connect-src` in the
   Content-Security-Policy line of `index.html`.
3. On the phone: **menu → Connect Google Drive**, sign in, allow access. Done; it backs up from then on.

You only sign in again if you press **Disconnect**, remove the app's access in your Google account,
change your Google password, or don't use the app for 6 months.

## Automatic deploys
- **App:** every push to `main` runs `.github/workflows/pages.yml`. It checks the code (syntax check
  and the parser test) and, if that passes, publishes the app to GitHub Pages.
- **Worker:** pushes that change `worker/` run `.github/workflows/worker.yml`, which redeploys the
  Worker. Once, add two secrets under **Settings → Secrets and variables → Actions**:
  - `CLOUDFLARE_ACCOUNT_ID`: on the Cloudflare dashboard, **Workers & Pages** shows it on the right.
  - `CLOUDFLARE_API_TOKEN`: **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"** template.
  The Google client ID and secret stay in Cloudflare (`wrangler secret put`); GitHub never needs them.

## Your data
- Stored only on that phone, in that browser or installed app; it is not shared between devices.
- Clearing site data, uninstalling, or losing the phone loses whatever isn't backed up. Use the Drive
  backup, or download a text/CSV copy now and then.
- Anyone who unlocks your phone can open the app, so rely on your phone's lock.

## Development
- `node test/format.test.js` checks the parser and sums against a made-up sample notebook (`test/sample.txt`).
- Serve locally with `python3 -m http.server` and open `http://localhost:8000`.
- App icon options: `icons/options/index.html`; `python3 icons/options/make.py a|b|c` remakes the icons.
- After changing files the app caches, bump `CACHE` in `sw.js`.
