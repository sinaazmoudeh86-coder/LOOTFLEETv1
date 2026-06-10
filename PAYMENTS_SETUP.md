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

## Phase 2 — Automatic fulfilment (Supabase Edge Function)
1. Wallet table (client reads, only the webhook writes):
   ```sql
   create table if not exists public.wallets (
     user_id uuid primary key references auth.users(id) on delete cascade,
     credits integer not null default 0,
     updated_at timestamptz not null default now()
   );
   alter table public.wallets enable row level security;
   create policy "read own wallet" on public.wallets
     for select using (auth.uid() = user_id);
   ```
2. Edge Function `stripe-webhook`: verify the Stripe signature; on
   `checkout.session.completed` map price → pack and upsert
   `wallets.credits + pack` for `client_reference_id`.
3. Stripe → Developers → Webhooks → point `checkout.session.completed`
   at the function URL.
4. Client pickup on login (read wallet, sync local balance) — ask Claude
   when Phase 2 is deployed; it's ~20 lines.

## Notes
- The anon key can never write wallets — only Stripe via service role.
- Stay in Test mode until one full loop works, then flip links to live.
- Internal save field is still named `credits` — display-only rebrand, so
  no player saves were touched.

## LootFleet Pro ($20/month subscription)
- Create a Stripe **subscription** Payment Link ($20/mo recurring) and add it
  as `pro_monthly` in `window.LOOTFLEET.stripeLinks`.
- Webhook events to handle in the Edge Function:
  - `checkout.session.completed` / `invoice.paid` → extend the buyer's
    `pro_until` by one month (add a `pro_until timestamptz` column to
    `wallets`, keyed by `client_reference_id`).
  - `customer.subscription.deleted` → leave `pro_until` to lapse naturally.
- Manual fulfilment meanwhile: in the game console of YOUR admin session is
  not needed — run SQL or ask Claude to wire the login sync; client-side the
  fulfilment hook is `GAME.grantPro(30)` (extends 30 days from now/expiry).
- The client enforces lapse automatically: 5× speed drops off and XP returns
  to 1× the moment `proUntil` passes.

## Customer portal (subscription self-cancel)
Stripe → Settings → Billing → Customer portal → activate the no-code portal,
copy its login link and add it to js/config.public.js as:
  window.LOOTFLEET.stripePortal = 'https://billing.stripe.com/p/login/...';
The in-game Account sheet's "Manage / cancel subscription" button uses it.

## Text-alert signups
Opted-in phone numbers live inside each player's save (state.smsPhone /
state.smsOptIn) — query them in SQL when you want a broadcast list:
  select data->>'smsPhone' as phone from public.saves
  where (data->>'smsOptIn')::boolean is true;
(Hook an SMS provider like Twilio later; nothing else to set up now.)
