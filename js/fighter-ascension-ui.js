/* =============================================================================
   fighter-ascension-ui.js — the FIGHTER ASCENSION screen (Command ▸ Fighter Wing)
   -----------------------------------------------------------------------------
   One screen, four cards, one button each. Every figure on it is read from
   FASCEND (js/fighter-ascension.js) — the doctrine table is the only statement
   of what a rank does and what it costs, and this file never restates a number.

   The card prints THREE things a player has to be able to trust:
     · what the doctrine does at the rank they hold, in the units it fires in;
     · what the next rank changes, beside it, not instead of it;
     · the exact price, and if they cannot pay it, which stockpile is short.

   ONE DOCTRINE FLIES AT A TIME, and the screen has to make that impossible to
   misread — a player who buys a rank and sees nothing change in the fight will
   call it a bug. So the active doctrine is stated THREE ways that agree: a band
   at the top naming it, a FLYING badge on its card, and every other owned card
   visibly stood down with the switch sitting on it. An owned-but-inactive card
   still prints its full effect, labelled IF FLOWN rather than NOW — what you
   would get is the whole basis for choosing, and hiding it makes the choice
   blind.
   ========================================================================== */
(function () {
  'use strict';
  const G = () => window.GAME;
  const F = () => window.FASCEND;
  const $ = (id) => document.getElementById(id);
  function fmt(n) { try { return G().formatNum(Math.floor(n)); } catch (e) { return Math.floor(n || 0) + ''; } }
  function toast(m, c) { try { window.UI.toast ? window.UI.toast(m, c) : window.UI.unlockToast(m); } catch (e) {} }

  // The live wing, so the screen can say what these doctrines are actually
  // flying on rather than describing a wing the pilot may not have fitted.
  function wing() {
    try { return (window.FIGHTERS && window.FIGHTERS.status && window.FIGHTERS.status()) || null; } catch (e) { return null; }
  }

  function render() {
    const body = $('fasc-body'); if (!body || !F()) return;
    F().sync();
    const f = F(), sub = $('fasc-sub');
    const st = f.stars(), open = f.unlocked();
    if (sub) sub.textContent = open ? (f.totalRanks() + ' / ' + (f.DOCS.length * f.MAXR) + ' ranks') : ('★' + st + ' / ★' + f.GATE);
    body.innerHTML = open ? openHTML() : lockHTML();
    wire(body);
  }

  // ---- LOCKED --------------------------------------------------------------
  // ONE LINE, THE REQUIREMENT, AND A PROGRESS BAR. Every other lock veil in the
  // game is exactly that; a screen the player cannot open yet is not the place
  // to teach four systems they cannot use.
  function lockHTML() {
    const f = F(), st = f.stars(), need = f.GATE;
    return '<div class="fa-veil">' +
      '<div class="fa-veil-ic">➤</div>' +
      '<div class="fa-veil-t">FIGHTER ASCENSION</div>' +
      '<div class="fa-veil-s">Four permanent doctrines for every fighter you launch, on any hull. Opens at <b>Pilot Ascension ★' + need + '</b>.</div>' +
      '<div class="fa-veil-bar"><i style="width:' + Math.min(100, st / need * 100).toFixed(1) + '%"></i></div>' +
      '<div class="fa-veil-l"><span>★' + st + '</span><span>' + Math.max(0, need - st) + ' to go</span><span>★' + need + '</span></div>' +
    '</div>';
  }

  // ---- OPEN ----------------------------------------------------------------
  function openHTML() {
    const f = F(), w = wing();
    const mult = f.strikeMult();
    const bays = w ? w.armed : 0, cap = w ? w.bays : 0;
    const sortie = f.sortie();
    const bank = f.bank();
    const act = f.activeDoc(), actR = act ? f.rank(act.k) : 0;
    return '<div class="fa-hero">' +
        '<div class="fa-hero-l">' +
          '<div class="fa-hero-k">WING DOCTRINES · ACCOUNT-WIDE</div>' +
          '<div class="fa-hero-t">Every craft, every bay, every hull</div>' +
          '<div class="fa-hero-s">A doctrine is flown by <b>every fighter you launch</b> — from your flagship\u2019s bays and from every carrier in your wing. It is never tied to a hull, never lost on a refit, and <b>rides through every pilot ascension</b>.</div>' +
        '</div>' +
        '<div class="fa-hero-r">' +
          '<div class="fa-stat"><b>' + f.totalRanks() + '<i>/' + (f.DOCS.length * f.MAXR) + '</i></b><span>RANKS HELD</span></div>' +
          '<div class="fa-stat"><b>×' + mult.toFixed(2) + '</b><span>STRIKE WEIGHT</span></div>' +
          '<div class="fa-stat"><b>' + bays + '<i>/' + cap + '</i></b><span>BAYS ARMED</span></div>' +
        '</div>' +
      '</div>' +
      // WHAT IS ACTUALLY IN THE AIR, stated before anything the player can buy.
      (act
        ? '<div class="fa-active" style="--dc:' + act.col + '">' +
            '<span class="fa-active-ic">' + act.ic + '</span>' +
            '<div class="fa-active-m"><b>FLYING NOW — ' + act.name + '</b>' +
              '<span>' + act.line(act.at(actR)) + '</span></div>' +
            '<span class="fa-active-r">RANK ' + actR + '<i>/' + f.MAXR + '</i></span>' +
          '</div>'
        : '<div class="fa-active none">' +
            '<div class="fa-active-m"><b>NOTHING IN THE AIR YET</b>' +
              '<span>Buy a rank in any doctrine below and your whole wing starts flying it.</span></div>' +
          '</div>') +
      '<div class="fa-rule">Your wing trains to <b>one doctrine at a time</b>. Every rank you buy is kept forever, and switching between doctrines you own is <b>free and instant</b> — what this system costs you is the ranks, never the choice.</div>' +
      (cap === 0 ? '<div class="fa-warn">You have <b>no fighter bays fitted</b>. Doctrines are permanent and buying one is never wasted, but nothing will fly until a bay is in a Fighter slot \u2014 check the Hangar.</div>' : '') +
      (bays < cap ? '<div class="fa-warn dim">' + (cap - bays) + ' of your ' + cap + ' bays are <b>empty</b> \u2014 an empty bay flies nothing, doctrine or not.</div>' : '') +
      '<div class="fa-wallet">' +
        walletChip('gold', bank.gold) + walletChip('fuel', bank.fuel) +
        walletChip('iron', bank.iron) + walletChip('plasma', bank.plasma) + walletChip('ing', bank.ing) +
      '</div>' +
      '<div class="fa-grid">' + f.DOCS.map(card).join('') + '</div>' +
      (sortie ? '<div class="fa-live">➤ <b>APEX SORTIE</b> is live: a window opens every <b>' + Math.round(sortie.cdFull) + 's</b> and runs <b>' + sortie.dur.toFixed(1) + 's</b> \u2014 that is <b>' + Math.round(sortie.k * 100) + '%</b> of every minute at full burn.</div>' : '') +
      '<label class="fa-fx"><input type="checkbox" id="fa-fx"' + (F().fxOn() ? ' checked' : '') + '>' +
        '<span>Draw doctrine effects (haloes, echoes, novae). Turning this off changes <b>nothing</b> about the damage \u2014 it is a paint setting for this device only.</span></label>';
  }
  function walletChip(k, v) {
    const d = F().RES[k];
    return '<span class="fa-w" style="--wc:' + d.c + '">' + d.glyph + ' ' + fmt(v) + '</span>';
  }

  function card(d) {
    const f = F(), r = f.rank(d.k), maxed = r >= f.MAXR;
    const on = f.isActive(d.k), owned = r > 0;
    const now = d.at(r), next = maxed ? null : d.at(r + 1);
    const c = maxed ? null : f.cost(d.k, r + 1);
    const shortList = c ? f.short(c) : [];
    const can = !!c && shortList.length === 0;
    const pips = Array.from({ length: f.MAXR }, (_, i) => '<i class="' + (i < r ? 'on' : '') + '"></i>').join('');
    const costBits = c ? [costEm('gold', c.gold, shortList)]
      .concat(Object.keys(c.res).map((rk) => costEm(rk, c.res[rk], shortList)))
      .concat(c.ing ? [costEm('ing', c.ing, shortList)] : []).join('') : '';
    return '<div class="fa-card' + (owned ? ' owned' : '') + (maxed ? ' maxed' : '') +
        (on ? ' live' : owned ? ' off' : '') + '" id="fa-' + d.k + '" style="--dc:' + d.col + '">' +
      '<div class="fa-ch">' +
        '<span class="fa-ic">' + d.ic + '</span>' +
        '<div class="fa-ct"><b>' + d.name + '</b><em>' + d.sub + '</em></div>' +
        (on ? '<span class="fa-on">◉ FLYING</span>' : '') +
        '<span class="fa-rk">' + r + '<i>/' + f.MAXR + '</i></span>' +
      '</div>' +
      '<div class="fa-pips">' + pips + '</div>' +
      // "NOW" IS A LIE ON A DOCTRINE THAT IS NOT FLYING. The figures are what it
      // WOULD do — which is exactly what the player needs in order to choose —
      // so the LABEL changes rather than the numbers being hidden.
      '<div class="fa-now"><span>' + (owned && !on ? 'IF FLOWN' : 'NOW') + '</span>' + d.line(now) +
        (next ? ' <span class="fa-arw">→</span> <b>' + d.line(next) + '</b>' : '') + '</div>' +
      '<div class="fa-d">' + d.blurb + '</div>' +
      (owned && !on ? '<button class="fa-fly" data-faon="' + d.k + '">▶ FLY THIS DOCTRINE</button>' : '') +
      (maxed
        ? '<div class="fa-max">✦ RANK ' + f.MAXR + ' · DOCTRINE COMPLETE</div>'
        : '<button class="fa-buy' + (can ? '' : ' cant') + '" data-fabuy="' + d.k + '">' +
            '<span class="fa-buy-n">RANK ' + (r + 1) + '</span><span class="fa-buy-c">' + costBits + '</span></button>' +
          (can ? '' : '<div class="fa-shortl">Short on ' + shortList.map((s) => f.RES[s].name).join(' · ') + '</div>') +
          '<div class="fa-ladder">Rank ' + f.MAXR + ' of this doctrine costs <b>● ' + fmt(f.ladderGold(d.k)) + '</b> in gold all told \u2014 each rank is <b>5×</b> the last.</div>') +
    '</div>';
  }
  function costEm(k, v, shortList) {
    const d = F().RES[k];
    return '<em' + (shortList.indexOf(k) >= 0 ? ' class="s"' : '') + ' style="color:' + d.c + '">' + d.glyph + ' ' + fmt(v) + '</em>';
  }

  function wire(body) {
    body.querySelectorAll('[data-fabuy]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.fabuy, d = F().BY_K[k];
      const res = F().buy(k);
      if (res.ok) {
        flash(k);
        toast(d.ic + ' ' + d.name + ' → rank ' + res.rank, d.col);
        try { if (window.UI && window.UI.refreshAll) window.UI.refreshAll(); } catch (e) {}
        render();
      } else if (res.reason === 'cost') {
        toast('Not enough ' + res.short.map((s) => F().RES[s].name).join(' · '), '#ff6b78');
        render();
      } else if (res.reason === 'locked') {
        toast('Fighter Ascension opens at ★' + F().GATE, '#ff6b78');
      }
    }));
    // SWITCHING DOCTRINE. Free and instant, so there is no confirm sheet — but
    // it is still refused out loud rather than silently doing nothing.
    body.querySelectorAll('[data-faon]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.faon, d = F().BY_K[k];
      const res = F().setActive(k);
      if (res.ok) { flash(k); toast(d.ic + ' ' + d.name + ' — your wing is flying it', d.col); render(); }
      else if (res.reason === 'norank') toast('Buy a rank in ' + d.name + ' first', '#ff6b78');
      else if (res.reason === 'locked') toast('Fighter Ascension opens at ★' + F().GATE, '#ff6b78');
    }));
    const fx = $('fa-fx');
    if (fx) fx.addEventListener('change', () => F().setFx(fx.checked));
  }
  function flash(k) {
    const el = $('fa-' + k); if (!el) return;
    el.classList.add('lit'); setTimeout(() => el.classList.remove('lit'), 900);
  }

  window.FASCUI = { render };
  // The screen router calls FASCEND.render() for consistency with every other
  // Command screen, so point it here rather than teaching the router a second name.
  try { if (window.FASCEND) window.FASCEND.render = render; } catch (e) {}
})();
