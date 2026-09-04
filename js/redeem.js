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
  // sha256(normalized code) → reward id.
  // Two entries can point at the same reward: the LEGACY hashes below are codes
  // already handed out to players and must keep working, and the second block is
  // the readable set documented in CODES.md (project root — never shipped).
  const HASH = {
    // ---- current, documented set ----------------------------------------
    '4c487efee2ea903a6a55f550e94b232a943708517c627ee1ae0da3078a9dbc68': 'unlimited',
    'e5b4c8f25f7b5121822fd78ca61a32cb99cd7c38b20ed7b5cdd84157a2e6c181': 'allships',
    '0ac9de52441b339d974eb6a02e843bad7f73dedcf2e9563e85b1224a251bb79f': 'cur100b',
    '8e08f5932bc7975eae569865dfb6391a947cc151937b2e913f90ced22fb501bc': 'lvl100',
    'b73594a53866f757d1d2db0f96c26a7b7a27f7d92a3337a319d7e21c60cab6e2': 'lvl200',
    'ad4e3bef125286ba6feca86a07a3e7b700829d5e24cf29791dbeaca062c1b190': 'lvl500',
    '29a76145a8bfe2b0721812e86c8db05d745b4b75a325c775b7334bf3994a65f4': 'pro365',
    'f542c4091a26248648e7b83928c99e86dc9cc9f7c888262830a6a165f471202e': 'pro30',
    // ---- EVENT: the redesigned Discord, Aug 2026 --------------------------
    'f839bbc7dfcbf2b2f1a84aa8895d93d9e182a527770516284d5eabb7dfdd81bd': 'discord1k',
    // ---- BETA ACCESS ------------------------------------------------------
    // Opens a feature that is SHIPPED BUT HIDDEN so admins can test it on
    // production. See `tourbeta` below.
    '7f96669af9a455f4146ef636eb98acc7ce439bb6d35496438a62c60a83c6920d': 'tourbeta',
    // ---- VOIDMAW COMPENSATION, Aug 2026 (build 683) ----------------------
    // Ten single-use grants issued to players whose Voidmaw progress was lost.
    // Each is one-per-account like any non-repeatable code; hand ONE to each
    // affected player. A second one redeemed by the same account reports the
    // hull is already held and grants nothing, so a leaked code cannot compound.
    '9ff2504a7fc15161327c39e288114d3ad050badd03c5f43ba4856aeab1bbe07d': 'voidmaw',   // VOIDMAW-LHXU-V9LE
    '7bbf1ecf605cd6cc7d1bbeb6dc4b48fbe3ecfc76661684f0bee329749ba86555': 'voidmaw',   // VOIDMAW-KASK-9YKR
    'da1c04fa06c0616f7d8a66f95b9df791d0fc2e5f3bc96e4c430ba4db2177a67a': 'voidmaw',   // VOIDMAW-CTPE-RGQ5
    'f8acb1c9057d2f38fa843cb3eba80494ba00392178a544113e027709c18adfa9': 'voidmaw',   // VOIDMAW-N95V-TGHW
    '38c15cc47b8411eb0d90c86312049c0d3ec279055be48dc1f0a61b5cf9d2e984': 'voidmaw',   // VOIDMAW-7WPN-96V2
    '3c90b668569b3122870e306a6150641b61d42528ae7cf0064f916960622d0c5f': 'voidmaw',   // VOIDMAW-7RVB-UNLS
    '707d1def31f6780741a6a3bdf5d7d62cb9a8464ddcd396d28eb6ed6d38a13719': 'voidmaw',   // VOIDMAW-GMYJ-B3GG
    '8943651a20c271de77ab19456dfaec5bf8c2ae3ed210708c7bd3973081d37cb2': 'voidmaw',   // VOIDMAW-GBUL-HY6G
    'bfc2480f4b2c6820edecde10310a5c54670a6deadfe8d96c429370ae3cded934': 'voidmaw',   // VOIDMAW-SHMV-LLVM
    '94116824cb4b3cc82d3154d4da9995782132f21d5d04a623a73335d01ee51be4': 'voidmaw',   // VOIDMAW-24FT-S667
    // ---- legacy (plaintext lost — kept alive for codes already issued) ---
    '7154891c38981a593183a2bd5056954c602702768d17bc16db7f729c366c9c28': 'allships',
    'c85be0226b8210972b976cd432ef2f7b930cc7744a61fc20c8a2e1b7049b3ea3': 'cur100b',
    '2fd29fc18b227d135d29f6c247219d1810ba0de399944a922e5e3dbd8503d9a6': 'lvl100',
    '8b969257b1fb6a41faf97cdd280775d99eaf7351afa8f0d6a1854f3147a9a754': 'lvl200',
    '5783c02670fb4fca70cffa0eb9715832ac4f12e440bff0aff315afbd6ececd17': 'lvl500',
    'cd61d69bb4cc5ad93969432e5e51849f6160313d4c2ec8db6d52b6b0b05b71f6': 'pro365',
    'a0c0f10fa9b5bda29a15e70282be99200d802ca2de9c2cb7ba64d771542ced97': 'pro30',
  };
  // ---- UNLIMITED MODE ------------------------------------------------------
  // "Unlimited" is a SUSTAINED state, not a one-off grant: the flag lives in the
  // save and a watchdog re-tops any wallet that drops below the floor, so nothing
  // can be spent down. Deliberately a large FINITE number rather than Infinity —
  // Infinity does not survive JSON (saves as null), poisons formatNum, and the
  // engine's own non-finite guard would rewrite it to 1 the first time it touched
  // a stat. 1e15 is an order of magnitude under MAX_SAFE_INTEGER, so it still
  // adds, subtracts and formats like an ordinary number.
  //
  // THE CEILING WAS BELOW THE PRICE LIST (Sep 2026). A deep hull's last upgrade
  // is 3000 × 1.8^tier × (1.95+0.06·tier)^19 gold, which passes 1e15 on the top
  // hulls — so "unlimited" could not afford ONE upgrade, and because the watchdog
  // only re-tops a wallet that has fallen BELOW the floor, a pilot sitting on the
  // full 1e15 was stuck there permanently with nothing to spend it on. That is
  // the reported "the unlimited currency code doesn't give enough gold".
  // 4e15 clears the most expensive purchase in the game by ~3× and is still well
  // inside MAX_SAFE_INTEGER (9.007e15), so it adds, subtracts and formats exactly.
  // The floor moves with it — a floor below the biggest single price would let the
  // wallet drain to a point it can no longer buy anything and never trigger.
  const UNL_TOP = 4e15, UNL_FLOOR = 2e15;
  function topUpWallets(g) {
    const st = g.state; let changed = false;
    const set = (obj, k) => { if (!obj) return; if (!((obj[k] || 0) >= UNL_FLOOR)) { obj[k] = UNL_TOP; changed = true; } };
    set(st, 'gold');
    set(st, 'credits');            // ◈ LootCoins
    set(st, 'dreadCores');         // ◇ Dread Cores
    if (!st.resources) st.resources = { fuel: 0, iron: 0, plasma: 0 };
    set(st.resources, 'fuel'); set(st.resources, 'iron'); set(st.resources, 'plasma');
    if (st.prism) set(st.prism, 'ingots');   // ◭ Prism (only once Prism is unlocked)
    return changed;
  }
  // One watchdog for the session. Cheap (a handful of comparisons) and only
  // saves on an actual change, so it never spams the cloud.
  setInterval(() => {
    try {
      const g = G(); if (!g || !g.state || !g.state.unlimited) return;
      if (topUpWallets(g)) { g.save(); if (window.UI) window.UI.refreshAll(); }
    } catch (e) {}
  }, 4000);

  const REWARDS = {
    // REPEATABLE — re-entering it is how you turn the mode back on if a save
    // migration or a manual edit ever clears the flag.
    unlimited: { name: 'UNLIMITED — every currency, permanently topped up', repeatable: true, apply(g) {
      g.state.unlimited = 1;
      topUpWallets(g);
      return 'Gold, LootCoins, Fuel, Ore, Plasma, Dread Cores' + (g.state.prism ? ' and Prism' : '') + ' stay full from now on';
    } },
    // REPEATABLE — the fleet grows, so this code is a fleet SYNC rather than a
    // one-shot grant: redeeming it again unlocks any hull added since the last
    // time it was used, and says how many were new.
    allships: { name: 'FULL FLEET — every hull unlocked', repeatable: true, apply(g) {
      const st = g.state; st.ownedShips = st.ownedShips || {};
      // FLIGHT WAIVER. Granting the hull was only half the job: hulls with a
      // `flyReq` licence (only the Eternum has one — see its flyReq in config-v2
      // for the live figures; never restate them here)
      // stayed unswitchable, so the code handed over a ship you could look at and
      // not fly. The waiver clears every licence check for the account.
      st.flightWaiver = 1;
      let added = 0;
      ((window.CONFIG && window.CONFIG.SHIPS) || []).forEach((s) => {
        if (st.ownedShips[s.key]) return;
        try { g.grantShip(s.key); } catch (e) {}
        if (st.ownedShips[s.key]) added++;
      });
      return added ? added + ' new hull' + (added > 1 ? 's' : '') + ' unlocked — all flight requirements waived' : 'Fleet already complete — flight requirements waived on every hull';
    } },
    // VOIDMAW — the event carrier, normally assembled from 150 Voidmaw Parts
    // earned only during the event. Granted outright here because the parts
    // themselves are what went missing. NOT repeatable, and deliberately no
    // flightWaiver: the Voidmaw carries no flyReq licence (only the Eternum
    // does), so setting the waiver would silently unlock every other hull's
    // licence too — a compensation grant must give back exactly what was lost.
    voidmaw: { name: 'VOIDMAW — event carrier unlocked', apply(g) {
      const st = g.state; st.ownedShips = st.ownedShips || {};
      if (st.ownedShips.voidmaw) return 'Voidmaw is already in your hangar — nothing to grant';
      try { g.grantShip('voidmaw'); } catch (e) {}
      if (!st.ownedShips.voidmaw) { st.ownedShips.voidmaw = 1; }
      return 'Voidmaw added to your hangar — switch to it in Ships';
    } },
    cur100b: { name: '100B of every currency', apply(g) {
      const st = g.state;
      st.gold = (st.gold || 0) + 1e11;
      st.resources = st.resources || { fuel: 0, iron: 0, plasma: 0 };
      st.resources.fuel += 1e11; st.resources.iron += 1e11; st.resources.plasma += 1e11;
      if (g.addCredits) g.addCredits(1e11); else st.credits = (st.credits || 0) + 1e11;
    } },
    // ONE PER ACCOUNT, deliberately: the Discord unveiling hands the same code to
    // everyone, and 'repeatable' would let a single player farm it forever.
    discord1k: { name: '1,000 \u25c8 LootCoins \u2014 new Discord', apply(g) {
      const st = g.state;
      if (g.addCredits) g.addCredits(1000); else st.credits = (st.credits || 0) + 1000;
      return 'Welcome to the new Discord \u2014 1,000 \u25c8 LootCoins are in your wallet';
    } },
    lvl100: { name: 'Account Level 100', apply(g) { if ((g.state.level | 0) < 100 && g.setLevel) g.setLevel(100); } },
    lvl200: { name: 'Account Level 200', apply(g) { if ((g.state.level | 0) < 200 && g.setLevel) g.setLevel(200); } },
    lvl500: { name: 'Account Level 500', apply(g) { if ((g.state.level | 0) < 500 && g.setLevel) g.setLevel(500); } },
    // LOOTFLEET PRO. grantPro() extends from whichever is later — now or the
    // current expiry — so these stack onto an active subscription rather than
    // overwriting it. Repeatable: Pro is a duration, not a one-time unlock, and
    // the whole point of a comp code is being able to top someone up again.
    pro365: { name: 'LootFleet Pro — 365 days', repeatable: true, apply(g) {
      if (g.grantPro) g.grantPro(365); else g.state.proUntil = Math.max(Date.now(), g.state.proUntil || 0) + 365 * 86400000;
      return 'Pro active until ' + new Date(g.state.proUntil).toLocaleDateString();
    } },
    pro30: { name: 'LootFleet Pro — 30 days', repeatable: true, apply(g) {
      if (g.grantPro) g.grantPro(30); else g.state.proUntil = Math.max(Date.now(), g.state.proUntil || 0) + 30 * 86400000;
      return 'Pro active until ' + new Date(g.state.proUntil).toLocaleDateString();
    } },
    // ---- BETA ACCESS: TOUR OF DUTY -----------------------------------------
    // The season pass ships in the build but is HIDDEN from every player: the
    // Command card is not rendered and the screen refuses to open. This code is
    // the only way in, so admins can run it on production against real saves
    // before it goes public.
    //
    // REPEATABLE on purpose — it is an access switch, not a grant, and a tester
    // who lands on a save without the flag needs to be able to turn it back on.
    // Nothing about the pass is granted here: XP, levels and track purchases all
    // behave exactly as they will at launch.
    tourbeta: { name: 'TOUR OF DUTY — beta access', repeatable: true, apply(g) {
      g.state.tourBeta = 1;
      try { if (window.UI && window.UI.refreshAll) window.UI.refreshAll(); } catch (e) {}
      return 'Tour of Duty is already live for everyone — no code needed';
    } },
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
