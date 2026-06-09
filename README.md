# Loot Fleet

An idle space-ARPG that runs in the browser. Static site (no build step) + an
optional Supabase backend for real accounts and cloud saves.

**Live:** https://lootfleet.com

## Structure
- `index.html` — marketing homepage (served at `/`)
- `game.html` — the game
- `css/` — `style.css` (base), `theme.css` (dark redesign), `web.css` (web shell)
- `js/` — game modules + `config.public.js` (your Supabase keys), `cloud.js`, `account.js`
- `sw.js`, `manifest.json`, `icon-*.png` — PWA / offline
- `supabase/schema.sql` — DB schema (run once in Supabase)
- `LAUNCH.md` — full launch runbook · `SUPABASE_SETUP.md` — accounts setup

## Deploy (Vercel + GitHub auto-push)
1. Push this repo to GitHub.
2. Vercel → New Project → import the repo. Framework preset **Other**, no build
   command, output dir = root. Deploy.
3. Every push to `main` now auto-deploys.
4. Add `lootfleet.com` under Vercel → Settings → Domains and point DNS.

No backend required to run — it falls back to local per-browser accounts. To turn
on real cross-device accounts, follow `SUPABASE_SETUP.md` and paste your keys into
`js/config.public.js` (the anon key is safe to commit).

## Local dev
Open `index.html` in a browser (or serve the folder with any static server).
