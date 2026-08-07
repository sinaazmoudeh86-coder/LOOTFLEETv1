/* =============================================================================
   redeem.js — COUPON CODES (⚙ Settings ▸ Coupon code)
   ---------------------------------------------------------------------------
   Codes ship as SHA-256 HASHES only — the plaintext never appears in the
   client, so codes can't be scraped from source and high-entropy codes can't
   be brute-forced. One redemption per code per account (hash logged in the
   save, syncs with cloud). Also wires the bottom-nav ⚙ Settings tab.
============================================================================= */
(function () {
  'use strict';
  const G = () => window.GAME;
  // sha256(normalized code) → reward id
  const HASH = {
    '7154891c38981a593183a2bd5056954c602702768d17bc16db7f729c366c9c28': 'allships',
    'c85be0226b8210972b976cd432ef2f7b930cc7744a61fc20c8a2e1b7049b3ea3': 'cur100b',
    '2fd29fc18b227d135d29f6c247219d1810ba0de399944a922e5e3dbd8503d9a6': 'lvl100',
    '8b969257b1fb6a41faf97cdd280775d99eaf7351afa8f0d6a1854f3147a9a754': 'lvl200',
    '5783c02670fb4fca70cffa0eb9715832ac4f12e440bff0aff315afbd6ececd17': 'lvl500',
  };
  const REWARDS = {
    // REPEATABLE — the fleet grows, so this code is a fleet SYNC rather than a
    // one-shot grant: redeeming it again unlocks any hull added since the last
    // time it was used, and says how many were new.
    allships: { name: 'FULL FLEET — every hull unlocked', repeatable: true, apply(g) {
      const st = g.state; st.ownedShips = st.ownedShips || {};
      let added = 0;
      ((window.CONFIG && window.CONFIG.SHIPS) || []).forEach((s) => {
        if (st.ownedShips[s.key]) return;
        try { g.grantShip(s.key); } catch (e) {}
        if (st.ownedShips[s.key]) added++;
      });
      return added ? added + ' new hull' + (added > 1 ? 's' : '') + ' unlocked' : 'Fleet already complete — nothing new to add';
    } },
    cur100b: { name: '100B of every currency', apply(g) {
      const st = g.state;
      st.gold = (st.gold || 0) + 1e11;
      st.resources = st.resources || { fuel: 0, iron: 0, plasma: 0 };
      st.resources.fuel += 1e11; st.resources.iron += 1e11; st.resources.plasma += 1e11;
      if (g.addCredits) g.addCredits(1e11); else st.credits = (st.credits || 0) + 1e11;
    } },
    lvl100: { name: 'Account Level 100', apply(g) { if ((g.state.level | 0) < 100 && g.setLevel) g.setLevel(100); } },
    lvl200: { name: 'Account Level 200', apply(g) { if ((g.state.level | 0) < 200 && g.setLevel) g.setLevel(200); } },
    lvl500: { name: 'Account Level 500', apply(g) { if ((g.state.level | 0) < 500 && g.setLevel) g.setLevel(500); } },
  };
  async function sha256(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  async function redeem(raw, cb) {
    cb = cb || function () {};
    const g = G();
    if (!g || !g.state) return cb(false, 'Game still loading — try again');
    const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 10) return cb(false, 'Enter the full code');
    let h;
    try { h = await sha256(code); } catch (e) { return cb(false, 'Redeem needs a secure connection'); }
    const id = HASH[h];
    if (!id || !REWARDS[id]) return cb(false, 'Invalid code');
    const R = REWARDS[id];
    g.state.redeemedCodes = g.state.redeemedCodes || {};
    const again = !!g.state.redeemedCodes[h];
    // repeatable codes may be re-entered forever; everything else is once only
    if (again && !R.repeatable) return cb(false, 'Code already redeemed on this account');
    let extra = '';
    try { extra = R.apply(g) || ''; } catch (e) { return cb(false, 'Redeem failed — try again'); }
    g.state.redeemedCodes[h] = Date.now();
    try { g.save(); } catch (e) {}
    if (window.UI) { try { window.UI.refreshAll(); } catch (e) {} }
    cb(true, R.name + (extra ? ' — ' + extra : ''));
  }
  // ⚙ Settings button (battle screen dock, beside Loot/Ship) → Account sheet
  function boot() {
    const b = document.getElementById('hd-settings');
    if (b && window.UI && window.UI.openAccountSheet) {
      if (!b._wired) { b._wired = 1; b.addEventListener('click', () => window.UI.openAccountSheet()); }
      return;
    }
    setTimeout(boot, 500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  setTimeout(boot, 1500);
  window.REDEEM = { redeem };
})();
