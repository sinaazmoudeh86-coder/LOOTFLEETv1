/* =============================================================================
   payments.js — Star Collector LOOTCOINS (premium micro-transaction currency)
   ---------------------------------------------------------------------------
   LootCoins buy cosmetics only — never power. This module defines the packs
   and the checkout hand-off. SAFE BY DEFAULT: until real payment links are
   configured, checkout is disabled and the UI says so.

   PAYMENT SYSTEM (chosen for fastest repeat purchases):
   ── Stripe Checkout via Payment Links, with:
      • APPLE PAY + GOOGLE PAY — wallet buttons appear automatically in
        Stripe checkout on supported devices (one biometric tap to pay).
      • LINK BY STRIPE — Stripe's saved-payment layer: the buyer's card is
        remembered after the FIRST purchase, so every later purchase is
        one-click, exactly the fast re-buy loop micro-transactions need.
      • No backend required on a static host; upgrade path to embedded
        checkout + webhooks later (see PAYMENTS_SETUP.md).

   GOING LIVE:
   1. Create one Stripe Payment Link per pack (test mode first).
   2. Paste into js/config.public.js:
        window.LOOTFLEET.stripeLinks = {
          lc_25:  'https://buy.stripe.com/...',   // …one link per pack,
          lc_50:  'https://buy.stripe.com/...',   // …lc_75, lc_100
          lc_100: 'https://buy.stripe.com/...',
        };
   3. Webhook → Supabase Edge Function credits the buyer's wallet
      (full walkthrough + SQL in PAYMENTS_SETUP.md).
   ============================================================================= */
(function () {
  'use strict';
  // PACK LADDER — $25 per 25,000 LootCoins at the base tier, then +5% BONUS
  // coins per additional tier. Four clean options, capped at $100.
  const PACKS = [
    { sku: 'lc_25',  usd: '25',  credits: 25000,  bonus: 0 },
    { sku: 'lc_50',  usd: '50',  credits: 52500,  bonus: 5, tag: 'POPULAR' },
    { sku: 'lc_75',  usd: '75',  credits: 82500,  bonus: 10 },
    { sku: 'lc_100', usd: '100', credits: 115000, bonus: 15, tag: 'BEST VALUE' },
  ];
  function linkFor(sku) {
    const links = (window.LOOTFLEET && window.LOOTFLEET.stripeLinks) || {};
    return links[sku] || null;
  }
  // LOOTFLEET PRO — $20/mo subscription (5× speed + 2× XP). Uses a recurring
  // Stripe Payment Link under the 'pro_monthly' sku.
  const PRO = { sku: 'pro_monthly', usd: '20' };
  function subscribe() { return buy(PRO.sku); }
  function configured() { return PACKS.some((p) => linkFor(p.sku)); }
  // Open Stripe checkout in a new tab, tagging the session with the player's
  // account id so the webhook knows whose wallet to credit.
  function buy(sku) {
    const url = linkFor(sku);
    if (!url) return { ok: false, reason: 'unconfigured' };
    let uid = '';
    try { const s = window.AUTH && window.AUTH.session && window.AUTH.session(); uid = (s && s.id) || ''; } catch (e) {}
    window.open(url + (url.includes('?') ? '&' : '?') + 'client_reference_id=' + encodeURIComponent(uid), '_blank');
    return { ok: true };
  }
  window.PAYMENTS = { PACKS, PRO, buy, subscribe, configured, linkFor };
})();
