# LootFleet — Native IAP Setup (Capacitor)

The game code (`js/payments-v91.js`) now routes purchases by platform:

- **Web browser** → Stripe Payment Links (unchanged)
- **Android app** → Google Play Billing
- **iOS app** → Apple StoreKit
- Native apps NEVER see Stripe; web never sees store billing.

Fulfilment is server-side: approved purchase → `iap-validate` Edge Function
(verifies receipt with Apple/Google, dedupes, credits wallet) → game pulls
coins/Pro with `claim_wallet`. The player must be signed in (Supabase account);
guest purchases stay pending until they sign in, then deliver.

## Product ids (must match the store consoles exactly)

| sku | iOS (App Store Connect) | Android (Play Console) |
|---|---|---|
| 25,000 coins | `com.lootfleet.lc_25` | `lc_25` |
| 50,000 coins | `com.lootfleet.lc_50` | `lc_50` |
| 75,000 coins | `com.lootfleet.lc_75` | `lc_75` |
| 100,000 coins | `com.lootfleet.lc_100_v2` | `lc_100` |
| Pro monthly | `com.lootfleet.pro_monthly_v2` | `pro_monthly` |

## 1. Capacitor project — install the purchase plugin

In your Capacitor app repo (the one with `capacitor.config.*`):

```bash
npm install cordova-plugin-purchase@13
npx cap sync android
npx cap sync ios
```

That's the whole native side — the plugin exposes `window.CdvPurchase`, which
`js/payments-v91.js` detects and uses automatically (product registration,
launch-time init, purchase, receipt hand-off, finish/acknowledge). The old
hand-rolled `window.AndroidIAP` / `messageHandlers.iap` bridges are no longer
needed (still supported as a fallback for old builds).

iOS: enable the **In-App Purchase** capability in Xcode (Signing & Capabilities).
Android: the Play Billing permission is added by the plugin; upload the build to
a Play track (internal testing is fine) — Billing only works on installed-from-Play builds.

## 2. Supabase — run the SQL

SQL Editor → run `supabase/iap.sql` (needs `payments.sql` to have been run
first — it creates `wallets`, `grant_credits`, `grant_pro`, `claim_wallet`).

## 3. Supabase — deploy the Edge Function

Dashboard → Edge Functions → Deploy new function:

- Name: `iap-validate` — paste `supabase/functions/iap-validate/index.ts`
- Keep **Verify JWT: ON** (the game calls it with the player's session token)

Secrets (Edge Functions → iap-validate → Secrets):

| Secret | Where to get it |
|---|---|
| `APPLE_SHARED_SECRET` | App Store Connect → your app → In-App Purchases → App-Specific Shared Secret |
| `GOOGLE_SERVICE_ACCOUNT` | Google Cloud → IAM → Service Accounts → JSON key. Grant the account **View financial data** in Play Console → Users & permissions |
| `ANDROID_PACKAGE_NAME` | your app's applicationId, e.g. `com.lootfleet.app` |

## 4. Test

- **Android:** license-tester account (Play Console → Settings → License testing)
  → buy a coin pack in the internal-testing build → coins appear in-game within
  seconds (claim poll). Check `iap_transactions` for the row.
- **iOS:** Sandbox tester (App Store Connect → Users → Sandbox) → same flow.
- Replay protection: buying, then re-triggering the same receipt inserts
  nothing (primary-key dedupe) and grants nothing.

## Failure behavior

- Network/backend down at purchase time → transaction stays **unfinished**;
  the plugin re-delivers it on next app launch and validation retries. Nothing lost.
- Store says receipt invalid → transaction finished without grant (no farming).
- Same receipt sent twice → `{duplicate:true}`, no double credit.
