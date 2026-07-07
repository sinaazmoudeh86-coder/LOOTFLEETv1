# Apple App Review — response notes (v158)

## Guideline 2.1(b) — In-App Purchases not locatable
Fixed + reply text:

> Steps to locate the In-App Purchases:
> 1. Launch Loot Fleet and sign in (or continue as Guest).
> 2. Tap the **Hangar** tab in the bottom navigation.
> 3. A gold **"Get LootCoins"** banner is pinned at the top of every Hangar
>    category. Tap it to open the LootCoins shop sheet listing all four packs:
>    Loot Coins 25000, 50000, 75000 and 100000.
> The shop is also reachable any time the player attempts a LootCoins purchase
> with an insufficient balance. IAPs are not restricted by storefront or device
> configuration.

Code changes:
- `js/payments-v91.js` — pack amounts now match the IAP product names exactly
  (25,000 / 50,000 / 75,000 / 100,000).
- `js/ui-v94.js` — permanent "Get LootCoins" banner at the top of the store
  (all categories) opens the pack sheet.
- Also confirm in App Store Connect: Paid Apps Agreement accepted (Business
  section) and all four IAPs attached to the build + "Cleared for Sale".

## Guideline 1.5 — Support URL
- New page: **https://lootfleet.com/support.html** — contact email, purchase
  help, FAQ, account recovery, and account-deletion instructions.
- Linked from the site footer and from the in-game Account sheet.
- ACTION: change the Support URL in App Store Connect to
  `https://lootfleet.com/support.html`, and make sure the
  `support@lootfleet.com` mailbox exists/forwards.

## Guideline 5.1.1(v) — Account deletion
Full in-app flow (no email/phone required):
  ⚙ gear (top status bar) → Account → Danger zone → **Delete account…**
  → type DELETE → Delete permanently.
Deletes: cloud save, leaderboard row, wallet row, Supabase auth user (via the
new `delete-account` Edge Function), local save + stored credentials, then
signs out to the login gate.

- ACTION: deploy the edge function once:
  `supabase functions deploy delete-account`
  (without it, all game data is still wiped; only the bare auth login row
  survives — deploy it so the auth user is erased too).
- ACTION: record the flow on a device (create account → gear → delete →
  confirmation) and attach in App Review notes as they requested.

## Purchase confirmation screens (all platforms)
Every checkout now ends in an explicit result screen:
- **Success** — "✓ Purchase complete — Thanks for purchasing 50,000 LootCoins!"
  fires the moment the wallet claim delivers (works for web/Stripe and any
  store wrapper, since it keys off actual delivery, not the redirect).
- **Failure/cancel** — "Sorry — we couldn't confirm your purchase" with
  Check-again + Contact-support actions. Shown when a started checkout
  delivers nothing within 4 minutes, or on a `?purchase=cancel` redirect.
- Redirect params supported: append `?purchase=success` / `?purchase=cancel`
  to the Payment Link's redirect URLs in Stripe. Pending purchases survive
  reloads (localStorage).

## Files changed (all copied to deploy-v158/)
js/payments-v91.js, js/ui-v94.js, js/auth.js, js/cloud.js, css/theme.css,
support.html (new), index.html (footer link), sitemap.xml,
supabase/functions/delete-account/index.ts (new)
