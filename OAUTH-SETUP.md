# Google & Apple Sign-In — setup, start to finish

The code is already done and shipped. Everything below is **account setup on
Google's, Apple's and Supabase's websites**. No coding.

Do Google first — it's ~15 minutes. Apple takes longer and **costs $99/year**
(the Apple Developer Program), so do it second.

Before you start, write these two things on a sticky note. You'll paste them a lot.

* **Your site:** `https://YOURSITE.com` ← replace with your real Vercel domain
* **Your Supabase callback:** `https://YOURPROJECT.supabase.co/auth/v1/callback`

To find the Supabase one: open your Supabase project → **Authentication** →
**Sign In / Providers** → click **Google**. The callback URL is printed right
there. Copy it.

---

# PART 0 — Do this once (5 min)

This tells Supabase where players are allowed to come back to after signing in.
**If you skip this, both buttons will fail.**

1. Go to **supabase.com** and open your project.
2. Left sidebar → **Authentication**.
3. Click **URL Configuration**.
4. **Site URL** → type `https://YOURSITE.com` → **Save**.
5. **Redirect URLs** → click **Add URL** and add each of these, one at a time:
   * `https://YOURSITE.com`
   * `https://YOURSITE.com/game.html`
   * `http://localhost:3000` *(only if you test locally — otherwise skip)*
6. Click **Save**.

✅ Done. Now the providers.

---

# PART 1 — GOOGLE (~15 min, free)

## Step 1 — Make a Google Cloud project

1. Go to **console.cloud.google.com** and sign in with your Google account.
2. At the very top, click the **project dropdown** (says "Select a project").
3. Click **New Project** (top right of the popup).
4. Name it `Loot Fleet` → **Create**.
5. Wait ~10 seconds, then make sure the dropdown at the top now says **Loot Fleet**.
   *If it doesn't, click the dropdown and pick it.* Everything after this
   must happen inside that project.

## Step 2 — Fill in the consent screen

This is the "Loot Fleet wants to access your account" page players will see.

1. Left sidebar → **APIs & Services** → **OAuth consent screen**.
2. Choose **External** → **Create**.
3. Fill in only the required fields:
   * **App name:** `Loot Fleet`
   * **User support email:** your email
   * **Developer contact email:** your email (bottom of the page)
4. **Save and Continue.**
5. **Scopes** page → don't add anything → **Save and Continue.**
6. **Test users** page → **Save and Continue.**
7. **Summary** page → **Back to Dashboard.**

## Step 3 — PUBLISH it (people miss this and only they can log in)

1. Still on **OAuth consent screen**, find **Publishing status: Testing**.
2. Click **PUBLISH APP** → **Confirm**.
3. It should now say **In production**.

> Google may ask to "verify" your app. You do **not** need verification for
> basic email/profile sign-in. Ignore the prompt; the button works.

## Step 4 — Create the credentials

1. Left sidebar → **APIs & Services** → **Credentials**.
2. Top of page → **+ CREATE CREDENTIALS** → **OAuth client ID**.
3. **Application type:** `Web application`.
4. **Name:** `Loot Fleet Web`.
5. Under **Authorised JavaScript origins** → **+ ADD URI** → paste
   `https://YOURSITE.com`
6. Under **Authorised redirect URIs** → **+ ADD URI** → paste your
   **Supabase callback**: `https://YOURPROJECT.supabase.co/auth/v1/callback`

   ⚠ This is the Supabase URL, **not** your site. Getting these two backwards is
   the #1 reason Google sign-in fails.
7. **Create.**
8. A popup shows **Client ID** and **Client Secret**. Copy both somewhere safe.
   (You can reopen it later from the Credentials list.)

## Step 5 — Paste them into Supabase

1. Supabase → **Authentication** → **Sign In / Providers** → **Google**.
2. Toggle **Enable Sign in with Google** → ON.
3. **Client ID** → paste.
4. **Client Secret** → paste.
5. **Save.**

## Step 6 — Test it

Open your live site → **Continue with Google** → pick your account → you should
land in the game with your fleet.

🎉 Google is live.

---

# PART 2 — APPLE (~45 min, $99/year)

You need a paid **Apple Developer Program** membership. If you don't have one,
join at **developer.apple.com/programs** first and wait for approval (can take a
day or two). Everything below happens at **developer.apple.com/account**.

## Step 1 — App ID

1. **Certificates, Identifiers & Profiles** → **Identifiers** → **+**.
2. Pick **App IDs** → **Continue** → pick **App** → **Continue**.
3. **Description:** `Loot Fleet`
4. **Bundle ID:** select **Explicit** and type `com.yourname.lootfleet`
   (any unique reverse-domain string — write it down).
5. Scroll the **Capabilities** list to **Sign In with Apple** → tick it.
6. **Continue** → **Register**.

## Step 2 — Services ID (this is your "Client ID")

1. **Identifiers** → **+** → pick **Services IDs** → **Continue**.
2. **Description:** `Loot Fleet Web`
3. **Identifier:** `com.yourname.lootfleet.web`
   ← **write this down. This is the Client ID you'll paste into Supabase.**
4. **Continue** → **Register**.
5. Now click that Services ID you just made, in the list.
6. Tick **Sign In with Apple** → click **Configure**.
7. **Primary App ID:** choose the App ID from Step 1.
8. **Domains and Subdomains:** `YOURSITE.com`
   (just the domain — **no** `https://`, **no** trailing slash)
9. **Return URLs:** paste your **Supabase callback**
   `https://YOURPROJECT.supabase.co/auth/v1/callback`
10. **Next** → **Done** → **Continue** → **Save**.

## Step 3 — The key file

1. **Keys** → **+**.
2. **Key Name:** `Loot Fleet Sign In`
3. Tick **Sign In with Apple** → **Configure** → choose your **Primary App ID**
   → **Save**.
4. **Continue** → **Register**.
5. Click **Download**. You get a file called `AuthKey_XXXXXXXXXX.p8`.

   ⚠ **You can only download this once. Ever.** Put it somewhere safe.
6. Note the **Key ID** (the `XXXXXXXXXX` part of the filename).
7. Note your **Team ID** — top-right of the developer site, or **Membership**.

## Step 4 — Collect your four values

You now need:

| What | Where you got it | Looks like |
|---|---|---|
| **Team ID** | Membership page | `A1B2C3D4E5` |
| **Key ID** | Step 3 | `9F8E7D6C5B` |
| **Services ID** | Step 2 | `com.yourname.lootfleet.web` |
| **Private key** | the `.p8` file | a text block |

Open the `.p8` file in **Notepad** (Windows) or **TextEdit** (Mac). Copy
**everything**, including the `-----BEGIN PRIVATE KEY-----` and
`-----END PRIVATE KEY-----` lines.

## Step 5 — Paste into Supabase

1. Supabase → **Authentication** → **Sign In / Providers** → **Apple**.
2. Toggle **Enable Sign in with Apple** → ON.
3. **Client IDs:** your **Services ID** (`com.yourname.lootfleet.web`).
4. **Secret Key:** paste the whole `.p8` contents.
5. Fill in **Team ID** and **Key ID** if the fields are shown.
6. **Save.**

## Step 6 — Test it

Open your live site → **Continue with Apple** → sign in → you land in the game.

🎉 Apple is live.

> **Note:** Apple's secret expires every **6 months**. Supabase regenerates it
> from your key automatically, but keep the `.p8` file — if you lose it you must
> create a new key and redo Step 5.

---

# If a button doesn't work

The screen prints the reason underneath the buttons. Match it here:

| What you see | What's wrong | Fix |
|---|---|---|
| "Google sign-in isn't switched on yet" | Provider toggle is off in Supabase | Part 1 Step 5 / Part 2 Step 5 |
| "rejected the return address" | Redirect URL mismatch | The redirect URI at Google/Apple must be the **Supabase callback**, and your site must be in Supabase → URL Configuration → Redirect URLs |
| `redirect_uri_mismatch` on Google's page | Same as above | Part 1 Step 4.6 — it must be `https://YOURPROJECT.supabase.co/auth/v1/callback` |
| `invalid_client` on Apple's page | Wrong Services ID, or the domain in Step 2.8 doesn't match your site | Redo Part 2 Step 2 |
| Signs in, then bounces back to login | Your site isn't in Supabase's Redirect URLs | Part 0 Step 5 |
| Buttons don't appear at all | Supabase isn't configured on the page | Check `js/config.live.js` has your `supabaseUrl` + `supabaseAnonKey` |

Google changes take a few minutes to propagate. If a fix doesn't work
immediately, wait 5 minutes and retry in a private window.

---

# What already works, no setup needed

* Both buttons only appear when Supabase is configured — offline/local builds
  hide them automatically, so nothing breaks if you deploy before finishing.
* Labels swap with the tab: "Sign up with…" on Create account,
  "Continue with…" on Log in.
* A social sign-in is treated as a **fresh login**, so it claims the account
  session and kicks stale devices — same as an email login.
* If a player signs in with Google using the same email as an existing email
  account, Supabase links them to the **same** user, so their fleet is intact.
