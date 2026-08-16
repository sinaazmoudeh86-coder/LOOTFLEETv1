/* =============================================================================
   discord-reward.js — 1,000 LootCoins for joining the Discord, once
   ---------------------------------------------------------------------------
   The Command sheet's Discord card was a plain link with a soft subtitle. It now
   carries the offer on its face, opens a confirm sheet that states the terms,
   and pays on click-through.

   HONEST ABOUT WHAT IT CHECKS
   Nothing here can verify a Discord join — that needs OAuth and a bot with
   guild-member read, which is a different piece of work. This pays for the
   CLICK-THROUGH. That is a deliberate trade: the reward is small, it fires once
   per account for the lifetime of that account, and the alternative (an unpaid
   promise) is worse for the players who do join. If Discord membership needs to
   be provable later, the flag this writes is the place to hang it.

   ONE TIME, FOR GOOD
   state.discordJoin records the claim. It is in ASC_KEEP, so an ascension —
   which wipes the fleet back to nothing — cannot re-arm the offer. Everything is
   guarded on the flag, not on the DOM, so a second tab can't double-pay either.
   ============================================================================= */
(function () {
  'use strict';

  const REWARD = 500;   // halved in the Aug 2026 LootCoin payout pass (build 614)
  const G = () => window.GAME;
  const claimed = () => { try { return !!(G().state && G().state.discordJoin); } catch (e) { return false; } };

  function fmt(n) { try { return G().formatNum(n); } catch (e) { return Number(n).toLocaleString(); } }

  // ---- the card ---------------------------------------------------------------
  function paint() {
    const a = document.getElementById('cmd-discord');
    if (!a) return;
    const sub = a.querySelector('.mc-s');
    const name = a.querySelector('.mc-n');
    if (!sub || !name) return;

    if (claimed()) {
      a.classList.remove('dcr-hot');
      const b = a.querySelector('.dcr-badge'); if (b) b.remove();
      sub.textContent = 'Join the fleet · patch notes, bug reports & alliance recruiting';
      return;
    }
    a.classList.add('dcr-hot');
    sub.innerHTML = 'Live kill feed, patch notes &amp; alliance recruiting \u2014 <b class="dcr-em">claim ' +
      REWARD.toLocaleString() + ' LootCoins for joining</b>';
    if (!a.querySelector('.dcr-badge')) {
      const b = document.createElement('div');
      b.className = 'dcr-badge';
      b.innerHTML = '<span class="dcr-g">\u25c8</span>+' + REWARD.toLocaleString();
      a.appendChild(b);
    }
  }

  // ---- the sheet --------------------------------------------------------------
  function open(href) {
    if (document.querySelector('.dcr-wrap')) return;
    const o = document.createElement('div');
    o.className = 'dcr-wrap';
    o.innerHTML =
      '<div class="dcr-card" role="dialog" aria-label="Join the Discord">' +
        '<div class="dcr-ic"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.27 5.33A16.5 16.5 0 0 0 15.16 4c-.18.32-.39.75-.53 1.09a15.3 15.3 0 0 0-4.26 0C10.23 4.75 10.01 4.32 9.83 4a16.4 16.4 0 0 0-4.11 1.33C3.1 9.24 2.39 13.05 2.74 16.8a16.6 16.6 0 0 0 5.06 2.57c.41-.56.77-1.15 1.09-1.78-.6-.22-1.17-.5-1.71-.82.14-.11.28-.22.42-.34a11.8 11.8 0 0 0 10.02 0c.14.12.28.23.42.34-.54.32-1.11.6-1.71.82.31.63.68 1.22 1.09 1.78a16.55 16.55 0 0 0 5.06-2.57c.42-4.35-.71-8.13-2.21-11.47zM8.84 14.5c-.99 0-1.8-.91-1.8-2.03s.79-2.03 1.8-2.03 1.82.91 1.8 2.03c0 1.12-.8 2.03-1.8 2.03zm6.32 0c-.99 0-1.8-.91-1.8-2.03s.79-2.03 1.8-2.03 1.82.91 1.8 2.03c0 1.12-.79 2.03-1.8 2.03z"></path></svg></div>' +
        '<div class="dcr-h">JOIN THE FLEET DISCORD</div>' +
        '<div class="dcr-prize"><span class="dcr-pg">\u25c8</span><b>' + REWARD.toLocaleString() + '</b><em>LootCoins</em></div>' +
        '<div class="dcr-sub">Paid the moment you head over. One time per account.</div>' +
        '<div class="dcr-list">' +
          '<div><span>\u2694</span>Live war feed \u2014 every capture, siege and citadel razed</div>' +
          '<div><span>\u{1F4CA}</span>Daily standings for all seven ladders</div>' +
          '<div><span>\u{1F513}</span>Shield-down alerts the moment a system opens up</div>' +
          '<div><span>\u{1F6E0}</span>Patch notes, bug reports and alliance recruiting</div>' +
        '</div>' +
        '<button class="dcr-go" type="button">JOIN &amp; CLAIM ' + REWARD.toLocaleString() + ' \u25c8</button>' +
        '<button class="dcr-no" type="button">Not now</button>' +
      '</div>';
    document.body.appendChild(o);
    const close = () => o.remove();
    o.addEventListener('click', (e) => { if (e.target === o) close(); });
    o.querySelector('.dcr-no').addEventListener('click', close);
    o.querySelector('.dcr-go').addEventListener('click', () => { close(); grant(href); });
  }

  // ---- the payout -------------------------------------------------------------
  function grant(href) {
    // Open FIRST, in the same user gesture — a popup blocker will swallow the tab
    // if we do work before calling window.open.
    try { window.open(href, '_blank', 'noopener'); } catch (e) {}
    const g = G();
    if (!g || !g.state || claimed()) return;
    g.state.discordJoin = { at: Date.now(), lc: REWARD };
    if (g.addCredits) g.addCredits(REWARD);
    else { g.state.credits = (g.state.credits || 0) + REWARD; g.save(); }
    g.save();
    paint();
    try {
      if (window.MAIL) window.MAIL.push({
        ic: '\u25c8', title: 'Welcome to the fleet Discord',
        body: '<b>' + REWARD.toLocaleString() + ' LootCoins</b> have been added to your account.' +
          '<div style="margin-top:8px;opacity:.7">The war feed posts every capture, siege and shield expiry as it happens, ' +
          'plus the daily standings for all seven ladders.</div>',
      });
    } catch (e) {}
    try {
      const t = document.createElement('div');
      t.className = 'lvl-toast'; t.style.color = '#f2a93c'; t.style.fontSize = '22px';
      t.innerHTML = '\u25c8 ' + REWARD.toLocaleString() + ' LOOTCOINS<br><span style="font-size:12px;color:#ffe6b8">Welcome to the Discord</span>';
      const tl = document.getElementById('toasts') || document.body;
      tl.appendChild(t); setTimeout(() => t.remove(), 4200);
    } catch (e) {}
    try { if (window.UI) window.UI.refreshAll(); } catch (e) {}
  }

  // ---- wiring -----------------------------------------------------------------
  function bind() {
    const a = document.getElementById('cmd-discord');
    if (!a || a._dcr) return;
    a._dcr = true;
    a.addEventListener('click', (e) => {
      if (claimed()) return;                 // already paid — let the link behave normally
      e.preventDefault();
      open(a.getAttribute('href'));
    });
    paint();
  }

  function boot() {
    bind();
    // The Command sheet is built once in game.html, but repaint on open so the
    // card reflects the flag after a cloud save lands or an account switch.
    document.addEventListener('click', () => setTimeout(bind, 60), true);
    setTimeout(bind, 2000);
    setTimeout(paint, 9000);                 // after the cloud save has settled
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  // ---- styles -----------------------------------------------------------------
  const css = document.createElement('style');
  css.textContent = `
  .cmd-discord.dcr-hot{ position:relative; border-color:rgba(242,169,60,.5) !important;
    background:linear-gradient(180deg,rgba(242,169,60,.1),rgba(88,101,242,.06)) !important; }
  .dcr-em{ color:#f2a93c; }
  .dcr-badge{ position:absolute; top:10px; right:10px; display:flex; align-items:center; gap:3px;
    font-family:'Orbitron',sans-serif; font-weight:800; font-size:11px; letter-spacing:.04em; color:#231302;
    background:linear-gradient(180deg,#ffd24d,#e09a2d); border-radius:999px; padding:4px 10px;
    box-shadow:0 0 14px -3px rgba(255,210,77,.9); }
  .dcr-badge .dcr-g{ font-size:10px; }
  .dcr-wrap{ position:fixed; inset:0; z-index:9000; background:rgba(4,8,14,.82); backdrop-filter:blur(6px);
    display:flex; align-items:center; justify-content:center; padding:22px; }
  .dcr-card{ width:100%; max-width:380px; border-radius:18px; padding:24px 22px 18px; text-align:center;
    background:linear-gradient(180deg,#141b28,#0c111a); border:1px solid rgba(242,169,60,.4);
    box-shadow:0 24px 70px -18px rgba(0,0,0,.9), 0 0 40px -18px rgba(242,169,60,.5); }
  .dcr-ic{ width:52px; height:52px; margin:0 auto 12px; border-radius:14px; color:#8b96ff;
    background:rgba(88,101,242,.14); border:1px solid rgba(139,150,255,.3);
    display:flex; align-items:center; justify-content:center; }
  .dcr-ic svg{ width:28px; height:28px; }
  .dcr-h{ font-family:'Orbitron',sans-serif; font-weight:900; font-size:14px; letter-spacing:.1em; color:#eaf0fa; }
  .dcr-prize{ display:flex; align-items:baseline; justify-content:center; gap:7px; margin:14px 0 4px; }
  .dcr-prize .dcr-pg{ font-size:22px; color:#f2a93c; }
  .dcr-prize b{ font-family:'Orbitron',sans-serif; font-weight:900; font-size:38px; line-height:1; color:#ffd24d;
    text-shadow:0 0 26px rgba(255,210,77,.5); }
  .dcr-prize em{ font-style:normal; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:14px;
    letter-spacing:.08em; color:#c8a061; }
  .dcr-sub{ font-size:12.5px; color:#93a2ba; margin-bottom:16px; }
  .dcr-list{ text-align:left; display:flex; flex-direction:column; gap:8px; margin-bottom:18px;
    padding:14px; border-radius:12px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.07); }
  .dcr-list div{ display:flex; align-items:flex-start; gap:9px; font-size:12.5px; line-height:1.4; color:#c3cede; }
  .dcr-list span{ flex:0 0 18px; text-align:center; opacity:.9; }
  .dcr-go{ display:block; width:100%; border:none; border-radius:11px; padding:15px; cursor:pointer;
    font-family:'Orbitron',sans-serif; font-weight:800; font-size:12px; letter-spacing:.09em; color:#231302;
    background:linear-gradient(180deg,#ffd24d,#e09a2d); box-shadow:0 0 20px -4px rgba(255,210,77,.85);
    min-height:48px; }
  .dcr-go:active{ transform:scale(.98); }
  .dcr-no{ display:block; width:100%; margin-top:9px; background:none; border:none; cursor:pointer;
    font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12.5px; letter-spacing:.05em; color:#6d7c92;
    padding:11px; min-height:44px; }
  @media (prefers-reduced-motion:no-preference){
    .cmd-discord.dcr-hot{ animation:dcrGlow 2.6s ease-in-out infinite; }
    @keyframes dcrGlow{ 0%,100%{ box-shadow:0 0 0 rgba(242,169,60,0); } 50%{ box-shadow:0 0 18px -6px rgba(242,169,60,.7); } }
  }`;
  document.head.appendChild(css);

  window.DISCORDREWARD = { paint, claimed, REWARD };
})();
