# Push Loot Fleet to GitHub & deploy

This folder is the **complete, clean launch set** — exactly the files the live
site serves. No build step. Static host (Vercel/Netlify/Cloudflare Pages).

## What's here
```
index.html ............ marketing landing page (entry; "Play Free" → game.html)
game.html ............. the actual game
brand.html · guides.html · features.html · fleet-rank-embed.html
css/ .................. style-v2.css · theme.css · web-v89.css
js/ ................... game engine + landing/showcase scripts
ships/ ................ all hull art (incl. ship-oblivionspear / -alpha / -final)
guides/ · brand/ ...... SEO guide pages + brand guidelines
supabase/ ............. optional backend: schema + payments SQL
sw.js ................. service worker (offline + PWA install)
manifest.json · icons · robots.txt · sitemap.xml · vercel.json
*.md .................. runbooks (LAUNCH, GO_LIVE, SUPABASE_SETUP, PAYMENTS_SETUP, TURF_WAR_SETUP)
```

## First push
```bash
cd launch
git init
git add .
git commit -m "Loot Fleet — launch build"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

## Deploy (Vercel example)
1. Import the GitHub repo in Vercel — framework preset **Other** (no build command, output = repo root).
2. `vercel.json` already sets security headers and a no-cache rule for `sw.js`.
3. Point your domain at the deployment; HTTPS is automatic.
4. (Optional cloud saves / accounts) follow `SUPABASE_SETUP.md`, then paste your
   Supabase URL + anon key into `js/config.live.js`.

## Releasing updates
Bump `CACHE` in `sw.js` (e.g. `lootfleet-v124`) whenever you ship new assets so
the service worker refreshes clients on their next visit.

> Secrets: only the Supabase **anon** key belongs in the client. Never commit a
> `service_role` key. A `.gitignore` is included to keep `.env*` out of the repo.
