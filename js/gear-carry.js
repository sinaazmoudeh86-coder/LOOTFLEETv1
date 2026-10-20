/* gear-carry.js — "BEST LOADOUT?" after a ship switch (747)

   When the pilot switches flagship, GAME.gearCarryPlan() searches EVERY parked
   hull's fitting (never an active escort's) and proposes the strongest item for
   each slot on the new flagship. This sheet shows each proposed
   swap — what comes in, what it replaces — with a checkbox per row, and only the
   rows the pilot approves are handed to GAME.carryGear(), which re-validates
   every move at the moment of the write. Replaced gear goes to the bag. Nothing
   is ever sold, scrapped or deleted.

   WHEN IT ASKS: on EVERY flagship change — Bridge, Hangar list, ship sheet, the
   hangar-bay tap, Shipworks "Fly it now", Ship Ascension "Fly it", a purchase that
   auto-flies the new hull. It listens for 'lf:shipswitch', which switchShip()
   itself fires, so no caller can route around it. Not during the tutorial or an
   event run, not for a quiet system correction, and only when at least one move
   is a real upgrade. A Pilot Ascension does not go through switchShip (it resets
   the run and surrenders gear by design), so it never prompts — and any sheet
   still open closes itself the moment the flagship or the source fitting changes.
   No save footprint of its own: no state key, no storage. */
(function () {
  const G = () => window.GAME;
  const C = () => window.CONFIG;
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const name = (k) => { try { return C().SHIP_BY_KEY[k].name; } catch (e) { return k; } };
  const rcol = (it) => { try { return C().RARITY[it.rarity].color; } catch (e) { return '#c9d6e6'; } };
  const rname = (it) => { try { return C().RARITY[it.rarity].name; } catch (e) { return ''; } };

  let sheet = null, watch = 0;
  function close() { if (sheet) { sheet.remove(); sheet = null; } if (watch) { clearInterval(watch); watch = 0; } }

  function labels() {
    const out = {};
    try { (G().equipLayout() || []).forEach((l) => { out[l.key] = l.label; }); } catch (e) {}
    return out;
  }
  function gain(m) {
    if (!m.displaced) return 'Fills an empty slot';
    if (!(m.was > 0)) return 'Upgrade';
    return '+' + Math.max(1, Math.round((m.power / m.was - 1) * 100)) + '% power';
  }

  function offer(fromKey, toKey) {
    const g = G(); if (!g || !g.gearCarryPlan) return;
    let moves = [];
    try { moves = g.gearCarryPlan() || []; } catch (e) { moves = []; }
    if (!moves.length) return;
    close();
    const lab = labels();
    const nShips = new Set(moves.map((m) => m.fromShip)).size;
    const s = g.state;
    let cap = 0; try { cap = g.invCap ? g.invCap() : 0; } catch (e) {}
    sheet = document.createElement('div');
    sheet.className = 'gcarry-wrap';
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-labelledby', 'gcarry-h');
    sheet.innerHTML =
      '<div class="gcarry-card">' +
        '<div class="gcarry-k">Ship switch</div>' +
        '<h2 id="gcarry-h">Build your best loadout?</h2>' +
        '<p class="gcarry-sub">Your hangar has ' + moves.length + ' item' + (moves.length === 1 ? '' : 's') + ' across ' + nShips + ' ship' + (nShips === 1 ? '' : 's') +
          ' that beat what the <b>' + esc(name(toKey)) + '</b> has fitted.</p>' +
        '<div class="gcarry-list">' + moves.map((m, i) =>
          '<label class="gcarry-row">' +
            '<input type="checkbox" checked data-i="' + i + '">' +
            '<span class="gcarry-box"></span>' +
            '<span class="gcarry-body">' +
              '<span class="gcarry-slot">' + esc(lab[m.toSlot] || m.toSlot) + '<em>' + esc(gain(m)) + '</em></span>' +
              '<span class="gcarry-from">from your ' + esc(name(m.fromShip)) + '</span>' +
              '<span class="gcarry-in" style="color:' + rcol(m.item) + '">' + esc(m.item.name) + '<i>' + esc(rname(m.item)) + '</i></span>' +
              '<span class="gcarry-out">' + (m.displaced
                ? 'Replaces <b style="color:' + rcol(m.displaced) + '">' + esc(m.displaced.name) + '</b> \u2192 bag'
                : 'Slot is empty') + '</span>' +
            '</span>' +
          '</label>').join('') + '</div>' +
        '<p class="gcarry-note">Replaced gear goes to your bag. Nothing is sold or scrapped. Ships flying as escorts keep their gear.</p>' +
        '<p class="gcarry-warn" hidden></p>' +
        '<div class="gcarry-acts"><button type="button" class="gcarry-no">Not now</button><button type="button" class="gcarry-yes"></button></div>' +
      '</div>';
    const yes = sheet.querySelector('.gcarry-yes'), warn = sheet.querySelector('.gcarry-warn');
    const picked = () => [...sheet.querySelectorAll('input[data-i]')].filter((x) => x.checked).map((x) => moves[+x.dataset.i]);
    const sync = () => {
      const p = picked(), bag = p.filter((m) => m.displaced).length;
      yes.textContent = p.length ? 'Swap ' + p.length + ' item' + (p.length === 1 ? '' : 's') : 'Swap';
      yes.disabled = !p.length;
      const over = cap && (s.inventory || []).length + bag > cap;
      warn.hidden = !over;
      if (over) warn.textContent = 'Your bag will be over its ' + cap + ' slots. Make room before new loot drops, or it will be scrapped.';
    };
    sheet.querySelectorAll('input[data-i]').forEach((x) => x.addEventListener('change', sync));
    sheet.querySelector('.gcarry-no').addEventListener('click', close);
    sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
    yes.addEventListener('click', () => {
      if (yes.disabled) return;
      yes.disabled = true;                                   // one press, one write
      let r = null;
      try { r = g.carryGear(picked(), toKey); } catch (e) { r = null; }
      close();
      try {
        const msg = r && r.moved ? '\u2714 ' + r.moved + ' item' + (r.moved === 1 ? '' : 's') + ' fitted to the ' + name(toKey) + (r.ships > 1 ? ' from ' + r.ships + ' ships' : '') + (r.bagged ? ' \u00b7 ' + r.bagged + ' to your bag' : '')
          : 'Nothing moved \u2014 your gear changed since this was offered';
        if (window.UI && window.UI.unlockToast) window.UI.unlockToast(msg);
      } catch (e) {}
    });
    document.addEventListener('keydown', function k(e) { if (e.key === 'Escape' && sheet) { close(); document.removeEventListener('keydown', k); } });
    sync();
    document.body.appendChild(sheet);
    // A sheet must never outlive the situation it describes: another switch, a
    // Pilot Ascension (fittings wiped, starter hull), or a cloud pull replacing
    // the save all make it stale. Close rather than offer moves that cannot land.
    watch = setInterval(() => {
      try {
        const st = g.state, fits = (st && st.fittings) || {};
        const live = st && st.ship === toKey && moves.some((m) => fits[m.fromShip] && fits[m.fromShip][m.fromSlot] === m.item);
        if (!live) close();
      } catch (e) { close(); }
    }, 500);
    setTimeout(() => { try { yes.focus({ preventScroll: true }); } catch (e) {} }, 60);
  }

  window.addEventListener('lf:shipswitch', (e) => {
    close();                                             // any change of flagship retires an open offer
    const d = (e && e.detail) || {};
    const g = G(); if (!g || !g.state || !d.from || !d.to || d.from === d.to) return;
    try {
      const rt = g.rt || {};
      if (rt.hcrun || rt.sdrun || rt.cgrun || rt.kothRun || document.querySelector('.ob-bar, .fg-wrap')) return;
    } catch (er) { return; }
    // after the caller's own toast / sheet close / re-render have run
    setTimeout(() => { try { if (g.state.ship === d.to) offer(d.from, d.to); } catch (er) {} }, 150);
  });

  const css = document.createElement('style'); css.id = 'gear-carry-css';
  css.textContent = `
.gcarry-wrap{position:fixed;inset:0;z-index:7200;display:grid;place-items:center;padding:16px;background:rgba(5,8,16,.74);
  -webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px)}
.gcarry-card{width:100%;max-width:440px;max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;
  background:linear-gradient(180deg,#141c2c,#0b111c);border:1px solid rgba(95,209,255,.3);border-radius:16px;padding:18px 16px 16px;
  box-shadow:0 24px 70px rgba(0,0,0,.65);font-family:'Rajdhani',sans-serif;color:#eaf0fa;animation:gcarryIn .3s cubic-bezier(.22,1,.36,1)}
@keyframes gcarryIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.gcarry-card{animation:none}}
.gcarry-k{font-family:'Orbitron',sans-serif;font-weight:800;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#5fd1ff}
.gcarry-card h2{margin:-4px 0 0;font-family:'Orbitron',sans-serif;font-size:17px;letter-spacing:.03em;color:#fff}
.gcarry-sub{margin:0;font-size:13px;line-height:1.4;color:#9fb6c9;text-wrap:pretty}
.gcarry-sub b{color:#eaf0fa}
.gcarry-list{display:flex;flex-direction:column;gap:6px}
.gcarry-row{display:flex;align-items:flex-start;gap:10px;padding:9px 10px;border-radius:11px;background:#0e1626;border:1px solid #1f2c45;cursor:pointer;min-height:44px;box-sizing:border-box}
.gcarry-row:has(input:checked){border-color:rgba(95,209,255,.5);background:#0f1b2e}
.gcarry-row input{position:absolute;opacity:0;pointer-events:none}
.gcarry-box{flex:none;width:18px;height:18px;margin-top:1px;border-radius:5px;border:1.5px solid #3a4c68;display:grid;place-items:center;box-sizing:border-box}
.gcarry-row input:checked + .gcarry-box{background:#5fd1ff;border-color:#5fd1ff}
.gcarry-row input:checked + .gcarry-box::after{content:'';width:5px;height:9px;border-right:2px solid #0a1119;border-bottom:2px solid #0a1119;transform:translateY(-1px) rotate(45deg)}
.gcarry-row input:focus-visible + .gcarry-box{outline:2px solid #5fd1ff;outline-offset:2px}
.gcarry-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.gcarry-slot{display:flex;justify-content:space-between;gap:8px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8193ad}
.gcarry-slot em{font-style:normal;text-transform:none;letter-spacing:0;color:#3ecf8e;font-size:12px}
.gcarry-in{font-size:14px;font-weight:700;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gcarry-in i{font-style:normal;font-size:11px;font-weight:700;margin-left:6px;opacity:.85}
.gcarry-from{font-size:11px;font-weight:700;color:#8fd8ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gcarry-out{font-size:12px;color:#9fb0c4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gcarry-out b{font-weight:700}
.gcarry-note{margin:0;font-size:12px;color:#8193ad}
.gcarry-warn{margin:0;font-size:12px;font-weight:700;color:#f2b24b}
.gcarry-acts{display:flex;gap:8px;margin-top:2px}
.gcarry-acts button{flex:1;min-height:44px;border-radius:11px;font-family:'Orbitron',sans-serif;font-weight:800;font-size:12px;letter-spacing:.06em;cursor:pointer}
.gcarry-no{background:transparent;border:1px solid #2a3a55;color:#c3cede}
.gcarry-yes{background:linear-gradient(180deg,#ffd24d,#e8960f);border:none;color:#0b1220}
.gcarry-yes:disabled{opacity:.45;cursor:default}
`;
  document.head.appendChild(css);
  window.GEARCARRY = { offer, close };
})();
