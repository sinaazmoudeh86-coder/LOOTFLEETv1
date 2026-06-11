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
    _claimSoon();          // start polling — coins land moments after checkout
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // AUTOMATIC FULFILMENT — the stripe-webhook Edge Function credits a wallets
  // row in Supabase; the client claims it here. Runs on login, when the tab
  // regains focus (returning from checkout), and on a slow background poll.
  // ---------------------------------------------------------------------------
  let _claimBusy = false, _fastUntil = 0;
  async function claimWallet() {
    if (_claimBusy) return null;
    try {
      if (!(window.CLOUD && window.CLOUD.enabled && window.CLOUD.client)) return null;
      const s = window.AUTH && window.AUTH.session && window.AUTH.session();
      if (!s || s.method !== 'Supabase' || !s.id) return null;   // guests have no wallet
      const G = window.GAME; if (!G || !G.state) return null;
      _claimBusy = true;
      const { data, error } = await window.CLOUD.client.rpc('claim_wallet');
      _claimBusy = false;
      if (error || !data) return null;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;
      let changed = false;
      if (row.credits > 0) {
        G.state.credits = (G.state.credits || 0) + row.credits;
        changed = true;
        if (window.UI && window.UI.unlockToast) window.UI.unlockToast('+' + row.credits.toLocaleString() + ' LootCoins delivered — thank you!');
      }
      if (row.pro_until) {
        const t = new Date(row.pro_until).getTime();
        if (t > (G.state.proUntil || 0)) {
          G.state.proUntil = t; changed = true;
          if (window.UI && window.UI.unlockToast) window.UI.unlockToast('LootFleet PRO active — 5× speed + 2× XP unlocked');
        }
      }
      if (changed) { G.save(); if (window.UI) window.UI.refreshAll(); }
      return row;
    } catch (e) { _claimBusy = false; return null; }
  }
  // After opening checkout, poll fast for 5 minutes so delivery feels instant.
  function _claimSoon() { _fastUntil = Date.now() + 5 * 60000; }
  setInterval(() => {
    if (!window.GAME || !window.GAME.state) return;
    const fast = Date.now() < _fastUntil;
    const tick = Math.floor(Date.now() / 1000);
    if (fast ? tick % 10 === 0 : tick % 300 === 0) claimWallet();
  }, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(claimWallet, 800); });
  // first claim shortly after boot (game + cloud session ready)
  let _bootTries = 0;
  const _bootTimer = setInterval(() => {
    if (window.GAME && window.GAME.state && window.CLOUD && window.CLOUD.client) { clearInterval(_bootTimer); claimWallet(); }
    else if (++_bootTries > 40) clearInterval(_bootTimer);
  }, 1500);

  window.PAYMENTS = { PACKS, PRO, buy, subscribe, configured, linkFor, claimWallet };
})();
