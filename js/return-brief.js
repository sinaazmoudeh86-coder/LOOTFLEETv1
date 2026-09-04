/* =============================================================================
   return-brief.js — WHILE YOU WERE AWAY
   ---------------------------------------------------------------------------
   The game already earns for you while you're gone. It just never told you.

   Three things happen during an absence and only ONE of them was ever shown:
     · computeOffline()   — the combat sim. Kills, XP, gold, loot, deaths.
                            Already banked. The old modal showed this.
     · accrueResources()  — hourly income from held systems. Already banked —
                            and BOTH call sites threw the return value away, so
                            a player earning 40K fuel a night never saw a digit.
     · MOON stored        — colony output. NOT banked: it sits waiting for a
                            manual COLLECT the player has to go and find.

   So this screen REPORTS the two that already happened and CLAIMS the one that
   hadn't. That division matters — nothing here re-grants combat or tile income,
   which is what a "welcome back" screen usually gets wrong.

   It also names the two things that quietly cost the player money: the offline
   cap they slept through, and colony storage filling up and idling production.
   ========================================================================== */
(function () {
  const G = () => window.GAME;
  const S = () => (window.GAME ? window.GAME.state : null);
  const fN = (n) => { try { return G().formatNum(n); } catch (e) { return String(Math.floor(n || 0)); } };
  const fT = (s) => { try { return G().formatTime(s); } catch (e) { return Math.round(s / 60) + 'm'; } };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const CUR = [
    { k: 'gold',   ic: '$', c: '#f2a93c' },
    { k: 'fuel',   ic: '\u2b22', c: '#5bc0ff' },
    { k: 'iron',   ic: '\u25c6', c: '#d0a060' },
    { k: 'plasma', ic: '\u2726', c: '#c07bff' },
    { k: 'prism',  ic: '\u25ed', c: '#1fe3b2' },
  ];

  // ---- what the colony is holding -------------------------------------------
  // MUST go through MOON.pending(), which runs the colony's own accrual first.
  // state.moon.moons[].stored is a derived cache, only ever written inside
  // accrueMoon() — read cold at login it reports the value at the player's last
  // COLLECT, which is normally 0. Reading it directly made this whole section
  // vanish in the common case, and show a figure smaller than the one granted
  // in the uncommon one. `_idle` (storage filled, production stopped) is set on
  // the same line and was stale for exactly the same reason.
  function moonPending() {
    try {
      if (!window.MOON || !window.MOON.pending) return null;
      return window.MOON.pending();
    } catch (e) { return null; }
  }

  // ---- what happened TO you -------------------------------------------------
  // Mail is already written for captures and colony raids. Read it rather than
  // re-deriving events, so the brief can never disagree with the inbox.
  function eventsSince(ts) {
    try {
      // state.mail is { list, seq } — not an array. Guarding the wrapper with
      // Array.isArray silently returned [] on every call.
      const mail = S() && S().mail && S().mail.list;
      if (!Array.isArray(mail)) return [];
      return mail
        .filter((m) => m && (m.t || m.at || 0) >= ts && m.title)
        .slice(0, 4)
        .map((m) => ({ ic: m.ic || '\u2022', title: String(m.title) }));
    } catch (e) { return []; }
  }

  function rows(obj) {
    return CUR.filter((c) => (obj[c.k] || 0) >= 1)
      .map((c) => `<span style="color:${c.c}">${c.ic} ${fN(obj[c.k])}</span>`).join('');
  }

  let _open = false;

  function show(d) {
    if (_open) return;
    d = d || {};
    const combat = d.combat || null;
    const tiles = d.tiles || null;
    const moon = moonPending();
    const evts = eventsSince(d.since || 0);

    const tileTotal = tiles ? CUR.reduce((a, c) => a + (tiles[c.k] || 0), 0) : 0;
    const hasCombat = combat && (combat.kills > 0 || combat.gold > 0);
    const hasTiles = tileTotal >= 1;
    // Nothing to report is not worth a modal. A player who tabbed out for six
    // minutes with no empire should land straight back in the game.
    if (!hasCombat && !hasTiles && !moon && !evts.length) return;

    _open = true;
    const wrap = document.createElement('div');
    wrap.className = 'rb-wrap';
    wrap.innerHTML =
      '<div class="rb-card">' +
        '<div class="rb-top">' +
          '<div class="rb-eyebrow">While you were away</div>' +
          '<div class="rb-time">' + fT(d.elapsed || 0) + '</div>' +
        '</div>' +

        (hasCombat ?
          '<div class="rb-sect">' +
            '<div class="rb-sect-t">\u2694 Your operator held the line</div>' +
            '<div class="rb-grid">' +
              '<div class="rb-cell"><b>' + fN(combat.kills) + '</b><span>kills</span></div>' +
              '<div class="rb-cell"><b>' + fN(combat.xp) + '</b><span>XP</span></div>' +
              '<div class="rb-cell"><b style="color:#f2a93c">' + fN(combat.gold) + '</b><span>gold</span></div>' +
              '<div class="rb-cell"><b>' + fN(combat.found) + '</b><span>loot</span></div>' +
            '</div>' +
            (combat.lost ? '<div class="rb-warn">\u2716 ' + combat.lost + ' item' + (combat.lost === 1 ? '' : 's') + ' lost to enemy fire</div>' : '') +
          '</div>' : '') +

        (hasTiles ?
          '<div class="rb-sect">' +
            '<div class="rb-sect-t">\u2691 Your systems paid out</div>' +
            '<div class="rb-cur">' + rows(tiles) + '</div>' +
            '<div class="rb-note">Banked automatically \u2014 already in your balance.</div>' +
          '</div>' : '') +

        (moon ?
          '<div class="rb-sect rb-claimable">' +
            '<div class="rb-sect-t">\u{1F311} Colony production \u2014 waiting for you</div>' +
            '<div class="rb-cur">' + rows(moon.got) + '</div>' +
            (moon.idle ?
              '<div class="rb-warn">\u26a0 Storage filled on ' + moon.idle + ' ' + (moon.idle === 1 ? 'moon' : 'moons') +
              ' \u2014 production stopped early. Build more storage to sleep longer.</div>' : '') +
          '</div>' : '') +

        (evts.length ?
          '<div class="rb-sect">' +
            '<div class="rb-sect-t">\u25c9 In the galaxy</div>' +
            evts.map((e) => '<div class="rb-evt"><i>' + esc(e.ic) + '</i>' + esc(e.title) + '</div>').join('') +
          '</div>' : '') +

        '<button class="rb-go" id="rb-go">' + (moon ? 'CLAIM EVERYTHING' : 'BACK TO THE FLEET') + '</button>' +

        (d.cappedOut ?
          '<div class="rb-cap">Offline earnings capped at <b>' + (d.capH || 12) + ' hours</b>' +
          (d.capBonus ? ' <span>(+' + d.capBonus + 'h from VIP)</span>' : ' <span>\u2014 VIP raises this</span>') + '</div>' : '') +
      '</div>';

    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('on'));

    const close = () => {
      if (!_open) return;
      _open = false;
      // The one thing that hadn't been banked yet.
      if (moon) {
        try { if (window.MOON && window.MOON.collectAll) window.MOON.collectAll({ skipAccrue: true }); } catch (e) {}
      }
      wrap.classList.remove('on');
      setTimeout(() => { try { wrap.remove(); } catch (e) {} }, 220);
      try { if (window.UI) window.UI.refreshAll(); } catch (e) {}
    };
    wrap.querySelector('#rb-go').addEventListener('click', close);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  }

  const CSS = `
.rb-wrap{position:fixed;inset:0;z-index:8000;display:flex;align-items:center;justify-content:center;padding:18px;
  background:rgba(4,6,14,.82);backdrop-filter:blur(7px);opacity:0;transition:opacity .2s}
.rb-wrap.on{opacity:1}
.rb-card{width:100%;max-width:380px;max-height:88vh;overflow-y:auto;border-radius:18px;padding:17px 16px 15px;
  background:linear-gradient(180deg,#161228,#0d0b18);border:1px solid rgba(255,255,255,.11);
  box-shadow:0 24px 70px rgba(0,0,0,.66);transform:translateY(14px) scale(.98);transition:transform .24s cubic-bezier(.2,.9,.3,1)}
.rb-wrap.on .rb-card{transform:none}
.rb-top{text-align:center;margin-bottom:14px}
.rb-eyebrow{font-family:'Rajdhani',sans-serif;font-weight:700;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#8d7aab}
.rb-time{font-family:'Orbitron',sans-serif;font-weight:900;font-size:27px;color:#ffd24d;line-height:1.15;margin-top:2px}
.rb-sect{border-radius:13px;padding:11px 12px;margin-bottom:9px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.028)}
.rb-sect.rb-claimable{border-color:rgba(242,169,60,.34);background:rgba(242,169,60,.07)}
.rb-sect-t{font-family:'Rajdhani',sans-serif;font-weight:700;font-size:12px;letter-spacing:.05em;color:#cfc4de;margin-bottom:8px}
.rb-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
.rb-cell{text-align:center;padding:7px 3px;border-radius:9px;background:rgba(0,0,0,.26)}
.rb-cell b{display:block;font-family:'Orbitron',sans-serif;font-weight:900;font-size:13px;color:#eaf0fa;line-height:1.15;word-break:break-all}
.rb-cell span{display:block;margin-top:2px;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#8d7aab}
.rb-cur{display:flex;flex-wrap:wrap;gap:6px 13px}
.rb-cur span{font-family:'Orbitron',sans-serif;font-weight:700;font-size:12.5px;white-space:nowrap}
.rb-note{margin-top:7px;font-size:10.5px;color:#7d7192}
.rb-warn{margin-top:8px;font-size:11px;line-height:1.4;color:#ffb0a0}
.rb-evt{display:flex;gap:8px;align-items:flex-start;font-size:11.5px;line-height:1.4;color:#b5aac8;padding:3px 0}
.rb-evt i{flex:0 0 14px;font-style:normal;text-align:center;opacity:.9}
.rb-go{width:100%;margin-top:4px;padding:13px;border:0;border-radius:12px;cursor:pointer;
  font-family:'Orbitron',sans-serif;font-weight:900;font-size:13px;letter-spacing:.07em;color:#231302;
  background:linear-gradient(180deg,#ffd76b,#f2a93c)}
.rb-go:active{transform:translateY(1px)}
.rb-cap{margin-top:9px;text-align:center;font-size:10.5px;color:#7d7192}
.rb-cap b{color:#a293b8}.rb-cap span{opacity:.75}
@media(max-height:640px){.rb-time{font-size:23px}.rb-sect{padding:9px 11px;margin-bottom:7px}}
`;
  try {
    const st = document.createElement('style');
    st.id = 'rb-css'; st.textContent = CSS;
    document.head.appendChild(st);
  } catch (e) {}

  window.RETURNBRIEF = { show };
})();
