# Loot Fleet — hosting & accounts setup

Loot Fleet is a static site (HTML/CSS/JS) plus an optional **Supabase** backend for
real accounts and cloud saves. Without Supabase it still runs fully — accounts are
just per-browser. With Supabase you get email/password + social logins and saves
that follow each player across devices.

---

## 1. Host the static site
Upload the project folder to any static host and point **lootfleet.com** at it:

- **Netlify / Vercel / Cloudflare Pages** — drag-and-drop the folder, or connect the repo.
- **GitHub Pages**, **S3 + CloudFront**, or any web server also work.

Files that must ship together: `game.html` (your entry point — set it as the
index, or rename to `index.html`), `css/`, `js/`, `manifest.json`,
`icon-192.png`, `icon-512.png`.

> Tip: rename `game.html` → `index.html` so `lootfleet.com` loads it directly.

That's it for local/per-browser accounts. For real logins, continue below.

---

## 2. Create a Supabase project (free)
1. Go to **supabase.com** → New project. Pick a name + region, save the DB password.
2. In **SQL Editor**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and **Run**.
   This creates the `saves` table with row-level security (each player can only
   read/write their own save).

## 3. Connect the client
1. In Supabase → **Project Settings → API**, copy:
   - **Project URL** (e.g. `https://abcd1234.supabase.co`)
   - **anon public** key
2. Paste them into [`js/config.public.js`](js/config.public.js):
   ```js
   window.LOOTFLEET = {
     supabaseUrl:     'https://abcd1234.supabase.co',
     supabaseAnonKey: 'eyJhbGciOi...'
   };
   ```
   (The anon key is meant to be public — RLS keeps data private.)

That alone turns on **email/password accounts + cloud saves**.

## 4. Auth settings
In Supabase → **Authentication**:
- **URL Configuration** → set **Site URL** to `https://lootfleet.com` and add it
  (plus any preview URLs) to **Redirect URLs**.
- **Providers** → **Email** is on by default. Toggle **"Confirm email"** off for
  instant signups, or leave it on (the login screen tells users to check their inbox).
- To enable the social buttons, turn on **Google / Apple / Facebook** and paste
  each provider's OAuth client ID/secret (from their developer consoles). Until a
  provider is enabled, its button shows a friendly "enable this provider" message.

## 5. Done
Reload the site. New players sign up with email (or a social button); their fleet
saves to Supabase and loads on any device they log in from. **Guest** play stays
local to the browser.

---

## How saves work
- `js/cloud.js` talks to Supabase; `js/account.js` writes every save to
  `localStorage` immediately and (when signed in) debounced-pushes it to the
  `saves` table. On login it pulls the cloud save first, so progress follows the
  account.
- Each account is namespaced (`infinite-operator-save-v2::u_<id>`), so multiple
  accounts on one browser stay separate.

## Security notes
- The local-only fallback stores username/password in plaintext in the browser —
  fine for guest/offline play, **not** for real credentials. Real auth uses
  Supabase (hashed, managed, with email verification + OAuth).
- Never commit your Supabase **service_role** key to the client. Only the **anon**
  key belongs in `config.public.js`.
