# Loot Fleet — Admin Dashboard install

A password-protected admin dashboard built into the home page. Shows **real**
user, purchase, revenue, and traffic data. Open it at `lootfleet.com/#admin`
(or the **Admin** link in the footer). Password: **`20042004`**.

---

## What's in this package

**New files**
- `supabase/admin.sql` — the backend you must run (tables + admin RPCs). **Required.**
- `js/admin.js` — the dashboard UI logic.
- `js/analytics.js` — first-party page-view tracker (feeds the Traffic panel).

**Changed files**
- `index.html` — admin panel markup, styles, footer link, script includes.
- `supabase/functions/stripe-webhook/index.ts` — now logs each purchase's amount → real revenue.
- `game.html`, `features.html`, `guides.html`, `brand.html` — added the analytics beacon so traffic is counted site-wide.

Everything reads the **live Supabase project already in `js/config.live.js`**.
No new keys or services are needed.

---

## Step-by-step

### 1. Upload the files
Deploy the whole project folder the way you normally do (Vercel / Netlify /
Cloudflare Pages — drag-drop or push the repo). Make sure these ship:
`index.html`, `js/admin.js`, `js/analytics.js`, and the changed pages above.

### 2. Run the admin backend SQL  ← **the one required step**
1. Open your **Supabase** project → **SQL Editor** → **New query**.
2. Open `supabase/admin.sql`, copy the whole file, paste it in, press **Run**.
   - (Or: open the dashboard, enter the password — if the backend isn't there
     yet it shows a **"Copy setup SQL"** button with the exact same script.)

This creates:
- `purchases` — your real revenue log
- `page_views` — your real traffic log (insert-only for visitors; only the
  admin can read it)
- `admin_overview / admin_users / admin_purchases / admin_traffic` — the
  password-gated functions the dashboard calls.

### 3. (Optional) Turn on automatic revenue logging
If you use the Stripe webhook for auto-fulfilment, redeploy the updated
`stripe-webhook` Edge Function so each sale is written to `purchases`:
- Supabase → **Edge Functions** → `stripe-webhook` → replace `index.ts` with the
  version in this package → **Deploy**.
- No new secrets needed; it reuses the ones already set up in `PAYMENTS_SETUP.md`.

Past sales (before this) won't appear — only sales from the redeploy onward.
Player, signup, and traffic data appear immediately after step 2.

### 4. Open it
Go to `lootfleet.com/#admin` (or footer → **Admin**), enter **`20042004`**, done.

---

## Security notes
- The home page only ever ships the **public anon key**. The dashboard's data is
  protected because every `admin_*` function re-checks the password **inside the
  database** before returning anything. A wrong password returns nothing.
- **Change the password:** edit the one line in `admin_ok()` at the top of
  `supabase/admin.sql`, re-run that function, and change `ADMIN_PW` at the top of
  `js/admin.js` to match.
- Traffic numbers start accumulating the moment step 2 is done; revenue numbers
  start from the webhook redeploy (step 3) or from any manual `purchases` rows.
