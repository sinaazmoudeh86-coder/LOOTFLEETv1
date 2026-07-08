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
  // PACK LADDER — matches the App Store IAP products exactly:
  // "Loot Coins 25000 / 50000 / 75000 / 100000". Names & amounts must stay in
  // sync with App Store Connect so review can locate each product in-game.
  const PACKS = [
    { sku: 'lc_25',  usd: '25',  credits: 25000,  bonus: 0 },
    { sku: 'lc_50',  usd: '50',  credits: 50000,  bonus: 0, tag: 'POPULAR' },
    { sku: 'lc_75',  usd: '75',  credits: 75000,  bonus: 0 },
    { sku: 'lc_100', usd: '100', credits: 100000, bonus: 0, tag: 'BEST VALUE' },
  ];
  function linkFor(sku) {
    const links = (window.LOOTFLEET && window.LOOTFLEET.stripeLinks) || {};
    return links[sku] || null;
  }
  // ---------------------------------------------------------------------------
  // NATIVE STORE BILLING — platform product ids for the app wrappers.
  // NOTE: ids must match App Store Connect exactly — lc_25 and lc_100 were
  // re-registered (2026-07): lc_25 is now com.lootfleet.lc_25 (was leetfleet),
  // lc_100 is com.lootfleet.lc_100_v2.
  // The wrapper injects a bridge:
  //   iOS:     window.webkit.messageHandlers.iap.postMessage({ action:'buy', productId })
  //   Android: window.AndroidIAP.buy(productId)
  // and reports back via window.PAYMENTS.onNativeResult({ ok, sku }).
  // ---------------------------------------------------------------------------
  const STORE_IDS = {
    ios: {
      lc_25: 'com.lootfleet.lc_25',
      lc_50: 'com.lootfleet.lc_50',
      lc_75: 'com.lootfleet.lc_75',
      lc_100: 'com.lootfleet.lc_100_v2',
      pro_monthly: 'com.lootfleet.pro_monthly_v2',
    },
    android: {
      lc_25: 'lc_25', lc_50: 'lc_50', lc_75: 'lc_75', lc_100: 'lc_100',
      pro_monthly: 'pro_monthly',
    },
  };
  function nativePlatform() {
    try { if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.iap) return 'ios'; } catch (e) {}
    if (window.AndroidIAP && typeof window.AndroidIAP.buy === 'function') return 'android';
    return null;
  }
  function storeId(sku) {
    const p = nativePlatform();
    return (p && STORE_IDS[p][sku]) || sku;
  }
  // ---------------------------------------------------------------------------
  // NATIVE IAP INIT — tell the wrapper to initialize billing and preload all
  // product ids AS SOON AS the game launches (StoreKit/Play Billing need the
  // product list fetched before the first buy, and preloading makes the first
  // purchase sheet instant). The bridge may be injected after page load, so
  // retry briefly until it appears. Safe to call more than once — wrappers
  // treat repeat inits as a no-op.
  let _iapInitDone = false, _iapInitTries = 0;
  function initNativeIAP() {
    if (_iapInitDone) return true;
    const p = nativePlatform(); if (!p) return false;
    const ids = Object.keys(STORE_IDS[p]).map((sku) => STORE_IDS[p][sku]);
    try {
      if (p === 'ios') window.webkit.messageHandlers.iap.postMessage({ action: 'init', productIds: ids });
      else if (window.AndroidIAP.init) window.AndroidIAP.init(JSON.stringify(ids));
      _iapInitDone = true;
      return true;
    } catch (e) { return false; }
  }
  const _iapInitTimer = setInterval(() => {
    if (initNativeIAP() || ++_iapInitTries > 20) clearInterval(_iapInitTimer);
  }, 500);

  function buyNative(sku) {
    const p = nativePlatform(); if (!p) return false;
    const pid = storeId(sku);
    try {
      if (p === 'ios') window.webkit.messageHandlers.iap.postMessage({ action: 'buy', productId: pid, sku });
      else window.AndroidIAP.buy(pid);
      _setPending(sku);
      return true;
    } catch (e) { return false; }
  }
  // Reverse-map a platform product id back to our internal sku. Wrappers
  // (iOS + Android) report the STORE product id, not our sku — crediting must
  // never depend on which one we get, nor on the pending record surviving.
  function skuFromProductId(pid) {
    if (!pid) return null;
    for (const plat in STORE_IDS) {
      const map = STORE_IDS[plat];
      for (const sku in map) if (map[sku] === pid) return sku;
    }
    return null;
  }
  // Called by the native wrapper when the store sheet closes.
  // { ok:true, sku } → credit + thank-you screen · { ok:false, sku } → sorry screen
  // Accepts sku OR productId in either field (wrappers differ).
  function onNativeResult(res) {
    res = res || {};
    let sku = res.sku || res.productId || res.product_id || (_getPending() || {}).sku;
    sku = skuFromProductId(sku) || sku;   // normalize store id → internal sku
    const p = PACKS.find((x) => x.sku === sku);
    _clearPending();
    if (res.ok && p) {
      const G = window.GAME;
      if (G && G.state) { G.state.credits = (G.state.credits || 0) + p.credits; G.save(); if (window.UI) window.UI.refreshAll(); }
      _result(true, { credits: p.credits });
    } else if (res.ok && sku === PRO.sku) {
      const G = window.GAME;
      if (G && G.state) { G.state.proUntil = Math.max(G.state.proUntil || 0, Date.now()) + 31 * 864e5; G.save(); if (window.UI) window.UI.refreshAll(); }
      _result(true, { label: 'LootFleet Pro — 5× speed + 2× XP' });
    } else {
      _result(false, p ? { credits: p.credits } : {});
    }
  }
  // LOOTFLEET PRO — $19.99/mo subscription (5× speed + 2× XP). Uses a recurring
  // Stripe Payment Link under the 'pro_monthly' sku.
  const PRO = { sku: 'pro_monthly', usd: '19.99' };
  function subscribe() { return buy(PRO.sku); }
  function configured() { return !!nativePlatform() || PACKS.some((p) => linkFor(p.sku)); }
  // Open Stripe checkout in a new tab, tagging the session with the player's
  // account id so the webhook knows whose wallet to credit.
  function buy(sku) {
    if (buyNative(sku)) return { ok: true, native: true };   // App Store / Play billing
    const url = linkFor(sku);
    if (!url) return { ok: false, reason: 'unconfigured' };
    let uid = '';
    try { const s = window.AUTH && window.AUTH.session && window.AUTH.session(); uid = (s && s.id) || ''; } catch (e) {}
    window.open(url + (url.includes('?') ? '&' : '?') + 'client_reference_id=' + encodeURIComponent(uid), '_blank');
    _setPending(sku);      // watch for the confirmation screen
    _claimSoon();          // start polling — coins land moments after checkout
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // PURCHASE CONFIRMATION SCREEN — every checkout ends in an explicit result:
  // success ("thanks for purchasing …") when the wallet claim delivers, or a
  // sorry/retry screen if nothing confirms within the watch window or the
  // player returns from a cancelled checkout. Survives reloads via storage.
  // ---------------------------------------------------------------------------
  const PENDING_KEY = 'lf-pending-purchase';
  function _setPending(sku) {
    const p = PACKS.find((x) => x.sku === sku);
    const rec = { sku, credits: p ? p.credits : 0, label: p ? p.credits.toLocaleString() + ' LootCoins' : (sku === 'pro_monthly' ? 'LootFleet Pro' : sku), at: Date.now() };
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(rec)); } catch (e) {}
  }
  function _getPending() { try { return JSON.parse(localStorage.getItem(PENDING_KEY)); } catch (e) { return null; } }
  function _clearPending() { try { localStorage.removeItem(PENDING_KEY); } catch (e) {} }
  function _result(ok, info) { if (window.UI && window.UI.purchaseResult) window.UI.purchaseResult(ok, info); }
  // no-confirmation watchdog: if a checkout was started and nothing delivered
  // within the watch window (while the tab is visible), show the sorry screen
  // once. Native store sheets keep the page "visible" and can legitimately sit
  // open for a long time (password prompts, slow App Store), so give native
  // purchases 15 minutes vs 4 for web checkout in another tab.
  setInterval(() => {
    const p = _getPending();
    if (!p || document.hidden) return;
    const windowMs = nativePlatform() ? 15 * 60000 : 4 * 60000;
    if (Date.now() - p.at > windowMs) { _clearPending(); _result(false, p); }
  }, 5000);
  // checkout redirect result (?purchase=success|cancel) — works when the
  // Stripe Payment Link (or native store wrapper) redirects back to the game.
  try {
    const q = new URLSearchParams(location.search).get('purchase');
    if (q) {
      const p = _getPending() || {};
      history.replaceState(null, '', location.pathname + location.hash);
      if (/^(cancel|cancelled|canceled|fail|failed)$/i.test(q)) { _clearPending(); setTimeout(() => _result(false, p), 1200); }
      else if (/^(success|paid|complete)$/i.test(q)) { _claimSoon(); }  // success sheet fires on actual delivery
    }
  } catch (e) {}

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
        const p = _getPending(); _clearPending();
        _result(true, { credits: row.credits, label: (p && p.label) || null });
      }
      if (row.pro_until) {
        const t = new Date(row.pro_until).getTime();
        if (t > (G.state.proUntil || 0)) {
          G.state.proUntil = t; changed = true;
          const p = _getPending(); if (p && p.sku === 'pro_monthly') _clearPending();
          _result(true, { label: 'LootFleet Pro — 5× speed + 2× XP' });
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
    if (fast ? tick % 10 === 0 : tick % 60 === 0) claimWallet();
  }, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(claimWallet, 800); });
  // first claim shortly after boot (game + cloud session ready)
  let _bootTries = 0;
  const _bootTimer = setInterval(() => {
    if (window.GAME && window.GAME.state && window.CLOUD && window.CLOUD.client) { clearInterval(_bootTimer); claimWallet(); }
    else if (++_bootTries > 40) clearInterval(_bootTimer);
  }, 1500);

  window.PAYMENTS = { PACKS, PRO, buy, subscribe, configured, linkFor, claimWallet, storeId, skuFromProductId, initNativeIAP, onNativeResult };
})();
