# Loot Fleet — Launch Runbook

CTO-level operating doc for shipping **lootfleet.com**. Covers architecture, the
go-live checklist, security posture, the risk register, and the prioritized
roadmap.

---

## 1. What this is
A **static web game** (no build step, no framework) plus an **optional Supabase
backend** for real accounts and cloud saves. It runs anywhere that serves files
over HTTPS. Mobile-first, installable as a PWA, works offline after first load.

### Architecture
```
Browser (lootfleet.com)
├─ index.html ............ entry; loads styles + module scripts, boots the game
├─ css/  style.css ....... base UI kit (light tokens — overridden below)
│        theme.css ....... "command deck" dark redesign
│        web.css ......... responsive web shell (no phone frame) + top bar
├─ js/   config.js ....... game constants/balance        (window.CONFIG)
│        items.js ........ loot generation               (window.ITEMS)
│        entities.js ..... arena entities                (window.ENTITIES)
│        render.js ....... canvas art engine             (window.RENDER)
│        galaxy.js ....... hex-galaxy data               (window.GALAXYMAP)
│        leaderboard.js .. ladder data                   (window.LEADERBOARD)
│        config.public.js  YOUR Supabase keys (edit me)
│        cloud.js ........ Supabase adapter              (window.CLOUD)
│        account.js ...... per-account saves + sync      (window.ACCOUNT)
│        game.js ......... engine / sim / save-load      (window.GAME)
│        ui.js ........... screens, HUD, panels          (window.UI)
│        auth.js ......... login gate (cloud-aware)      (window.AUTH)
├─ sw.js ................. service worker (offline + install)
├─ manifest.json, icon-192/512.png, robots.txt, sitemap.xml
└─ Supabase (optional) ... Auth (email/OAuth) + Postgres `saves` table (RLS)
```
Load order matters: `config → items → entities → render → galaxy → leaderboard
→ (supabase cdn) → config.public → cloud → account → game → ui → auth`.

---

## 2. Go-live checklist

**Backend (one-time, ~10 min)** — see `SUPABASE_SETUP.md`
- [ ] Create Supabase project; run `supabase/schema.sql` (creates `saves` + RLS).
- [ ] Paste Project URL + anon key into `js/config.public.js`.
- [ ] Auth → URL config: Site URL `https://lootfleet.com`, add redirect URLs.
- [ ] Decide email confirmation on/off. Enable Google/Apple/Facebook if wanted.

**Frontend deploy**
- [ ] Host the folder on Netlify / Vercel / Cloudflare Pages (entry = `index.html`).
- [ ] Point `lootfleet.com` DNS at the host; enable HTTPS (automatic on all three).
- [ ] Confirm `manifest.json`, icons, and `sw.js` are served from the site root.
- [ ] Bump `CACHE` in `sw.js` whenever you ship new assets (cache-busting).

**Smoke test (prod)**
- [ ] Sign up with email → land in game → reload → still logged in (cloud session).
- [ ] Log in on a 2nd device → same fleet appears (cloud save sync).
- [ ] Guest play works and stays local.
- [ ] "Add to Home Screen" installs; relaunch works offline.
- [ ] Sign out returns to the gate.

---

## 3. Security posture
| Area | Status | Notes |
|---|---|---|
| Supabase anon key in client | ✅ Safe | It's designed to be public; **RLS** is the real guard. |
| `saves` table | ✅ Locked | RLS: a row is readable/writable only by its owner (`auth.uid()`). |
| Passwords (cloud) | ✅ Managed | Hashed by Supabase Auth; supports email verification + OAuth. |
| Passwords (guest/local fallback) | ⚠️ Plaintext in `localStorage` | Only used when Supabase isn't configured. Fine for guest/offline; **don't** rely on it for real users. |
| Save integrity | ⚠️ Client-authoritative | The client writes its own save → a determined user can edit their own numbers. Acceptable for a single-player idle game; **must** be fixed before any real-money or competitive stakes (see roadmap). |
| `service_role` key | 🚫 Never ship it | Server-side only. Only the **anon** key belongs in `config.public.js`. |
| Headers | ➕ Recommended | Add `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` at the host (Netlify `_headers` / Vercel `headers`). |

---

## 4. Risk register
| # | Risk | Sev | Likelihood | Mitigation |
|---|---|---|---|---|
| R1 | Save tampering (client-authoritative) | Med | High | Move score/economy validation server-side (Edge Function) before adding leaderboards-with-stakes or IAP. |
| R2 | "Purchases" (speed tiers, AFK) are **simulated** — no payment | Med | — | They grant entitlements for free today. Wire a real processor (Stripe/RevenueCat) + server-verified entitlements before charging. |
| R3 | Leaderboard is simulated, not real players | Low | — | Enable the `leaderboard` view in `schema.sql` and point UI at it (roadmap N1). |
| R4 | Stale assets after deploy (SW cache) | Low | Med | Bump `CACHE` in `sw.js` each release; SW self-updates on next load. |
| R5 | OAuth misconfig (redirect mismatch) | Low | Med | Keep Supabase redirect URLs in sync with every deployed domain/preview. |
| R6 | No backups / observability | Med | Low | Enable Supabase PITR backups; add error logging + basic analytics (roadmap). |
| R7 | Abuse / signup spam | Low | Med | Supabase rate limits + email confirmation + (optional) captcha. |

---

## 5. Roadmap (prioritized)

**Now → launch**
- N1. **Real leaderboard** — uncomment the `leaderboard` view in `schema.sql`,
  read it in `ui.js` (replace the simulated board). Low effort, high payoff.
- N2. **Security headers + `_headers`/`vercel.json`** at the host.
- N3. **Analytics** (privacy-friendly, e.g. Plausible) + **error logging** (Sentry).

**Next (post-launch hardening)**
- X1. **Server-authoritative saves / anti-cheat** — a Supabase Edge Function that
  validates deltas (XP/gold/zone progression rates) and owns the canonical save.
  Prereq for any competitive or paid features.
- X2. **Real payments** — Stripe Checkout or RevenueCat for the speed/AFK tiers,
  with server-verified entitlements (kills R2).
- X3. **Conflict resolution** for multi-device saves (last-write-wins today →
  add `updated_at` compare + "newer cloud save found" prompt).

**Later (growth)**
- L1. Seasons/heats backed by real data; weekly resets + rewards.
- L2. Push re-engagement (web push) for boss timers / offline gains.
- L3. Cosmetic shop (the "Cosmetics" hangar tab is already stubbed).
- L4. Account management: change email/password, delete account (GDPR), data export.

---

## 6. Release process
1. Edit code → test locally (open `index.html`).
2. Bump `sw.js` `CACHE` (e.g. `lootfleet-v2`).
3. Deploy. The SW activates the new cache on the next visit.
4. If `game.js` state shape changes, add a migration in `init()` guarded by a
   `state.scaleVer`-style version flag (there's already one to model on).

---

## 7. Known intentional simplifications
- `game.html` and `index.html` are identical; deploy `index.html`. (Keep them in
  sync, or delete `game.html` once you've cut over.)
- Social sign-in buttons need their providers enabled in Supabase to function;
  until then they show a friendly hint.
