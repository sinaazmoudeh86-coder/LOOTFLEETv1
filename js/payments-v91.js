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
  // NATIVE STORE BILLING
  //   Android app  → Google Play Billing   (Capacitor + cordova-plugin-purchase)
  //   iOS app      → Apple StoreKit        (Capacitor + cordova-plugin-purchase)
  //   Web browser  → Stripe Payment Links  (never used inside the native apps)
  //
  // Purchases are fulfilled SERVER-SIDE: the plugin's approved transaction is
  // sent (receipt/purchaseToken + the player's Supabase JWT) to the
  // `iap-validate` Edge Function, which verifies it with Apple/Google, dedupes
  // it, and credits the wallet via grant_credits/grant_pro. The game then
  // pulls the coins with claim_wallet — the same path Stripe fulfilment uses.
  // Setup: see IAP-SETUP.md. Ids must match the store consoles exactly.
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
  // Capacitor native runtime (the real apps)
  function capPlatform() {
    try {
      const c = window.Capacitor;
      if (c && c.isNativePlatform && c.isNativePlatform()) {
        const p = c.getPlatform();
        if (p === 'ios' || p === 'android') return p;
      }
    } catch (e) {}
    return null;
  }
  // legacy hand-rolled wrapper bridges (kept for older builds still in the wild)
  function legacyBridgePlatform() {
    try { if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.iap) return 'ios'; } catch (e) {}
    if (window.AndroidIAP && typeof window.AndroidIAP.buy === 'function') return 'android';
    return null;
  }
  function nativePlatform() { return capPlatform() || legacyBridgePlatform(); }
  function storeId(sku) {
    const p = nativePlatform();
    return (p && STORE_IDS[p][sku]) || sku;
  }

  // ---- CAPACITOR / cordova-plugin-purchase (CdvPurchase v13) -----------------
  let _store = null, _storeReady = false;
  function _cpPlatform(CP, plat) {
    return plat === 'ios' ? CP.Platform.APPLE_APPSTORE : CP.Platform.GOOGLE_PLAY;
  }
  function _initCapStore() {
    const plat = capPlatform();
    const CP = window.CdvPurchase;
    if (!plat || !CP || !CP.store || _store) return !!_store;
    const store = CP.store;
    _store = store;
    const sp = _cpPlatform(CP, plat);
    const ids = STORE_IDS[plat];
    store.register(Object.keys(ids).map((sku) => ({
      id: ids[sku],
      platform: sp,
      type: sku === 'pro_monthly' ? CP.ProductType.PAID_SUBSCRIPTION : CP.ProductType.CONSUMABLE,
    })));
    // approved → validate on our backend → finish → claim the credited wallet
    store.when().approved((tx) => { _validateAndFinish(tx, plat); });
    store.error((err) => { try { console.warn('[IAP]', err && err.message); } catch (e) {} });
    store.initialize([sp]).then(() => { _storeReady = true; });
    return true;
  }
  // Send the approved transaction to the iap-validate Edge Function. The
  // player's Supabase JWT tells the backend WHO to credit; Apple/Google
  // receipts prove the purchase. Transaction stays unfinished until the
  // backend confirms, so the plugin re-delivers it on next launch if the
  // network dropped — nothing is ever lost or double-credited.
  async function _validateAndFinish(tx, plat) {
    let body;
    try {
      const prod = tx.products && tx.products[0];
      const np = tx.nativePurchase || {};
      const parent = tx.parentReceipt || {};
      const nd = parent.nativeData || {};
      body = {
        platform: plat,
        productId: (prod && prod.id) || null,
        transactionId: tx.transactionId || null,
        purchaseToken: np.purchaseToken || np.token || null,          // Google
        receipt: nd.appStoreReceipt || null,                           // Apple
      };
    } catch (e) { return; }
    const r = await _postValidate(body);
    if (r && (r.ok || r.duplicate)) {
      try { tx.finish(); } catch (e) {}
      _clearPending();
      if (r.ok) { _claimSoon(); claimWallet(); }   // wallet was credited server-side
    } else if (r && r.invalid) {
      // Store says this receipt is bad — don't retry forever
      try { tx.finish(); } catch (e) {}
      _clearPending(); _result(false, _getPending() || {});
    }
    // network/backend error → leave unfinished; plugin retries automatically
  }
  async function _postValidate(body) {
    try {
      const cfg = window.LOOTFLEET || {};
      if (!cfg.supabaseUrl || !(window.CLOUD && window.CLOUD.client)) return null;
      const { data } = await window.CLOUD.client.auth.getSession();
      const tok = data && data.session && data.session.access_token;
      if (!tok) return null;   // guest — retried after login (tx stays unfinished)
      const res = await fetch(cfg.supabaseUrl + '/functions/v1/iap-validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, apikey: cfg.supabaseAnonKey },
        body: JSON.stringify(body),
      });
      if (!res.ok && res.status >= 500) return null;   // backend hiccup → retry later
      return await res.json();
    } catch (e) { return null; }
  }

  // ---------------------------------------------------------------------------
  // NATIVE IAP INIT — initialize billing + preload products AS SOON AS the game
  // launches (StoreKit/Play Billing want the product list fetched before the
  // first buy; it also makes the first purchase sheet instant). Plugins load
  // after the page, so retry briefly until one appears.
  // ---------------------------------------------------------------------------
  let _legacyInitDone = false, _iapInitTries = 0;
  function initNativeIAP() {
    if (_initCapStore()) return true;                 // Capacitor plugin path
    const p = legacyBridgePlatform();                 // legacy wrapper path
    if (!p || _legacyInitDone) return _legacyInitDone;
    const ids = Object.keys(STORE_IDS[p]).map((sku) => STORE_IDS[p][sku]);
    try {
      if (p === 'ios') window.webkit.messageHandlers.iap.postMessage({ action: 'init', productIds: ids });
      else if (window.AndroidIAP.init) window.AndroidIAP.init(JSON.stringify(ids));
      _legacyInitDone = true;
      return true;
    } catch (e) { return false; }
  }
  const _iapInitTimer = setInterval(() => {
    if (initNativeIAP() || ++_iapInitTries > 40) clearInterval(_iapInitTimer);
  }, 500);

  function buyNative(sku) {
    // Capacitor plugin (preferred)
    const plat = capPlatform();
    if (plat) {
      if (!_store || !_storeReady) { _initCapStore(); return false; }  // store still warming up
      try {
        const CP = window.CdvPurchase;
        const prod = _store.get(STORE_IDS[plat][sku], _cpPlatform(CP, plat));
        const offer = prod && prod.getOffer();
        if (!offer) return false;
        _setPending(sku);
        offer.order().then((err) => { if (err) { _clearPending(); _result(false, { label: sku }); } });
        return true;
      } catch (e) { return false; }
    }
    // legacy wrapper bridge
    const p = legacyBridgePlatform(); if (!p) return false;
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
  // Open checkout. NATIVE APPS use store billing ONLY — Stripe is never
  // offered inside the iOS/Android apps (store policy). Web uses Stripe.
  function buy(sku) {
    if (nativePlatform()) {
      return buyNative(sku)
        ? { ok: true, native: true }
        : { ok: false, reason: 'store-not-ready' };   // never fall through to Stripe
    }
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
