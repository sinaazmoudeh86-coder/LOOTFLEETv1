# Loot Fleet — deploy v206 · build 410

Push the **contents of this folder** to the repo root Vercel serves, then hard-reload
once so the `lootfleet-v410` service worker takes over.

---

## ⚠ ONE BLOCKER BEFORE YOU GO LIVE — read this first

**`js/admin.js` line 17 ships your admin password in plaintext.**

```js
var ADMIN_PW = '20042004';   // panel unlock — also enforced in SQL
```

`index.html` loads `js/admin.js` on the **public landing page**. Anyone can open
view-source, read that string, and visit `lootfleet.com/#admin`. That panel shows
**every user's email address, all purchase records, and your revenue totals.**

The in-file comment says the password is re-checked server-side in `admin.sql` —
that is true, and it is not enough. The password *is* the credential. Re-checking a
credential that you also published to every visitor does not protect anything.

**This has not been changed in this build** — fixing it properly means altering how
the `admin_*` RPCs authenticate, which is a SQL change and your call to make.

Three options, cheapest to best:

1. **Stopgap (5 min, today):** change the password to a long random string and
   delete `<script src="js/admin.js">` from `index.html`. Keep it only in a page
   you don't link publicly. Still security-by-obscurity — buys time, not safety.
2. **Proper (recommended):** drop `p_pw` from every `admin_*` RPC and gate on
   `auth.uid()` against a hardcoded allowlist of your own user id. Then the panel
   requires being *logged in as you*, and there is no shared secret to leak.
3. **Belt and braces:** option 2, plus move the panel to its own route that isn't
   referenced from any public HTML.

Say the word and I'll write the SQL and rewire the panel for option 2.

---

## SQL — one file, still required

**`supabase/alliance-boss-setladder.sql`** — run it in the Supabase SQL Editor
**with this push, not after.** Run once, safe to re-run.

The client now sets the arena boss hull equal to `boss_hp` and transmits **raw**
combat damage. Against the old SQL, a new client is clamped to nothing. Deploy both
or neither.

Verify after running:

```sql
select n, public._al_boss_hp(null, n) as hull from generate_series(1,12) n;
-- expect 1e6, 4e6, 1.6e7, 6.4e7, ...
```

---

## What changed since v205

v205 was **build 409**. This is a stamp-consistency release — the only file whose
behaviour changes is the landing page.

| File | Change |
|---|---|
| `index.html` | **Fixed:** was still requesting `showcase.js`, `config.live.js`, `analytics.js`, `admin.js` at `?v=391` — 18 builds stale. Now `?v=410` like everything else. |
| `game.html` | 50 cache-bust params + `LF_BUILD` → 410 |
| `version.json` | `build: 410` |
| `sw.js` | cache name → `lootfleet-v410` |

Everything else is byte-identical to v205. If you already pushed v205, this push
supersedes it cleanly; if you didn't, this is the only one you need.

### Why index.html mattered

The service worker is network-first for `js`/`css`/`html`, so the stale stamp was
never serving genuinely old code — but it defeated HTTP cache-busting on the four
files the landing page loads, including `config.live.js`, which carries your
Supabase keys and live Stripe links. A returning visitor's browser could serve a
months-old copy from its own HTTP cache. Now every asset on both pages shares one
stamp.

---

## Sign-in — both providers are live

Google **and** Apple are now enabled on the Supabase project. `/auth/v1/settings`
reports `apple: true, google: true`, and the login card renders both buttons
(the code unhides them off that signal — no toggle to flip in this build).

Two things that only fail at the moment someone taps the button:

- **Return URL.** OAuth returns to `location.origin + location.pathname`, so
  `https://lootfleet.com/game.html` must be listed under Supabase →
  Authentication → URL Configuration → Redirect URLs. Missing it = signs in, then
  bounces straight back to the login screen.
- **Apple's domain check.** In the Services ID: *Domains* = `lootfleet.com`,
  *Return URL* = `https://emldvvlaanyivpmxyylr.supabase.co/auth/v1/callback`
  (the Supabase callback, **not** your site). A mismatch gives `invalid_client`
  on Apple's own page before the redirect happens.

Test on a real device — Apple blocks its sign-in flow inside embedded frames.

📅 **Diary it:** Apple's client secret expires every **6 months**. Supabase
regenerates it from your `.p8` key automatically, so keep that file. Lose it and
you must create a new key and re-paste it.

---

## Post-deploy checks

1. **Log in, out, and back in twice on a deep-zone account.** Power and gold must
   read identically each time. This is the regression that caused the wipes —
   verified stable across two full save→load cycles in this build (all four
   migration stamps held: `scaleVer 3`, `critVer 4`, `goldRepairVer 1`, `lsVer 1`).
2. Continue with Google → lands in the game.
3. Continue with Apple → lands in the game (real device).
4. Open the Alliance raid → hull bar matches the pool, a kill advances the Mk.
5. Landing page loads with no 404s in the console (the v391 → v410 change).

---

## Known, not fixed, not blocking

- **New accounts stay invisible on the leaderboard until their first cloud save
  flushes** (8-second debounce). Someone who signs up and closes the tab
  immediately never gets a row. Falcor is the live example — he has Voidmaw
  progress and territory rows but no leaderboard entry. The fix is to seed the row
  on first sign-in; you haven't asked for it yet, so it isn't in this build.
- **`territory` data is not server-authoritative.** All 125 tiles currently trace
  to one pilot via `republishOwnedTiles()` replaying a local save at ~3 claims/sec.
  Don't build anything that reads the table as a record of conquest until claims
  are validated server-side.
