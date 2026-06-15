# Star Collector — Payments setup (Stripe → LootCoins)

**LootCoins** are the premium micro-transaction currency (cosmetics only, never
power). The client is fully wired: packs live in `js/payments.js`, the
"Get LootCoins" sheet opens checkout, and every session is tagged with the
buyer's account id (`client_reference_id`).

## Why Stripe (the chosen financial system)
Optimized for **fast, repeat micro-purchases**:
- **Apple Pay & Google Pay** appear automatically in Stripe checkout on
  supported devices — one biometric tap, no typing.
- **Link by Stripe** saves the buyer's payment method after their FIRST
  purchase — every later purchase is **one-click re-buy**, across devices.
- Works on a static host (no backend) via Payment Links; clean upgrade path
  to embedded checkout + webhooks.
- Alternative if you ever want sales-tax/VAT handled for you: Paddle or
  Lemon Squeezy (merchant-of-record). Stripe is the better UX; MoR is the
  lazier bookkeeping. Start with Stripe.

## Phase 1 — Checkout live (15 min, no code)
1. Stripe account → **Payment Links** (Test mode first).
2. One product per pack ($25 per 25K base, +5% bonus coins per tier):
   - 25,000 — $25 · 52,500 — $50 · 82,500 — $75 · 115,000 — $100
3. Create a Payment Link per product. In each link's settings:
   - After payment → **redirect to your game URL**
   - Payment methods: cards + **Apple Pay/Google Pay** are on by default;
     make sure **Link** is enabled (Settings → Payment methods → Link).
4. Paste into `js/config.public.js`:
   ```js
   window.LOOTFLEET.stripeLinks = {
     lc_25:  'https://buy.stripe.com/XXXX',
     lc_50:  'https://buy.stripe.com/YYYY',
     // …one per pack through lc_200
   };
   ```
5. Redeploy. Checkout is live. **Fulfilment is manual in this phase**: each
   payment in the Stripe dashboard shows `client_reference_id` (the buyer's
   account id) — grant coins in Supabase SQL:
   ```sql
   insert into public.wallets (user_id, credits) values ('<id>', 500)
   on conflict (user_id) do update set credits = wallets.credits + 500;
   ```

## Phase 2 — AUTOMATIC fulfilment (LIVE as of v90)
The client code is fully wired (js/payments-v90.js). Three setup steps remain,
all copy-paste:

1. **SQL** — Supabase → SQL Editor → run `supabase/payments.sql`
   (creates wallets + stripe_customers + grant/claim functions).
2. **Edge Function** — Supabase → Edge Functions → Deploy new function,
   name `stripe-webhook`, paste `supabase/functions/stripe-webhook/index.ts`.
   Turn OFF "Verify JWT". Then add two secrets to the function:
   - STRIPE_SECRET_KEY  → Stripe → Developers → API keys → Secret key
   - STRIPE_WEBHOOK_SECRET → from step 3
3. **Stripe webhook** — Stripe → Developers → Webhooks → Add endpoint:
   - URL: https://<project-ref>.supabase.co/functions/v1/stripe-webhook
   - Events: checkout.session.completed, invoice.paid
   - Copy the signing secret (whsec_...) → save as STRIPE_WEBHOOK_SECRET above.

How delivery works after that:
- Pack purchase → webhook maps the $ amount → grant_credits → the game claims
  it on login / tab-refocus / fast 10s polling for 5 min after checkout opens
  → "+25,000 LootCoins delivered" toast.
- Pro signup → first month granted instantly; renewals via invoice.paid
  (subscription_cycle) keep extending pro_until; the game picks it up the
  same way. Cancel → pro_until simply lapses and 5×/2× switch off.
- Guests have no wallet — buyers must be signed into a cloud account (they
  are: client_reference_id is only attached for Supabase sessions).
