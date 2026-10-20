/* cmd-status.js — LIVE STATUS LINES ON THE COMMAND CARDS (747)

   Each Command card gets one line of live fact under its name: "2 surveys back",
   "Race ends in 5h 12m", "14 points to spend". The card's own description stays
   exactly where it was; this only adds a sibling `.mc-live` beside it.

   READ-ONLY, AND THAT IS THE WHOLE DESIGN.
   This file never writes to GAME.state, never calls save(), and never calls a
   module accessor that might. That rules out most of the obvious ones:
     • EXPO.ex()        creates state.expo (with a salt) if missing
     • CARGO.st()       creates state.cargo and rolls the day
     • TOUR.s()         creates / resets the season record
     • PASCEND.points() goes through st(), which creates state.pasc
     • MOON.pending()   runs ensure() AND accrueAll() — which ROLLS RAIDS and
                        advances nextRaid. A status line must never roll a raid.
   A record created on the boot thread before the cloud pull is the Home Citadel
   phantom-stamp defect (741). So every provider reads RAW state, treats a missing
   or malformed record as "say nothing", and the only calls out are to functions
   verified pure: GAME.formatNum, EXPO.slots(), KOTH.msLeft(), SERVERTIME.now().

   CLOCK: each line uses the SAME clock its own screen uses (SERVERTIME, else
   Date.now()), so a card can never say "back" while the screen says "not yet".
   Display only — nothing here grants anything, so the nowMs() grant rule is not
   in play.

   FAILURE MODE: a provider that throws or returns null leaves the line empty and
   the card exactly as it was before this file existed. Locked cards are skipped
   (their .mc-s already carries the unlock message). No save footprint: no state,
   no localStorage, no ASC_KEEP, no mergeSaves(). */
(function () {
  const G = () => window.GAME;
  const S = () => { try { return G() && G().state; } catch (e) { return null; } };
  const now = () => { try { return window.SERVERTIME ? window.SERVERTIME.now() : Date.now(); } catch (e) { return Date.now(); } };
  const N = (x) => Math.floor(Number(x) || 0);
  const fmtN = (n) => { try { return G().formatNum(n); } catch (e) { return String(n); } };
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  function dur(ms) {
    ms = Math.max(0, Number(ms) || 0);
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d >= 1) return d + 'd ' + (h % 24) + 'h';
    if (h >= 1) return h + 'h ' + (m % 60) + 'm';
    return m >= 1 ? m + 'm' : '<1m';
  }

  // Each returns { t, hot } or null. `hot` = the player can act on it right now.
  const P = {
    expo(s) {
      const e = s.expo; if (!e || typeof e !== 'object' || !Array.isArray(e.act)) return null;
      const act = e.act.filter((a) => a && typeof a === 'object' && !a.done);
      const t = now();
      const back = act.filter((a) => isFinite(+a.t1) && t >= +a.t1).length;
      if (back) return { t: plural(back, 'survey') + ' back · collect', hot: true };
      let free = 0; try { if (window.EXPO && EXPO.slots) free = Math.max(0, (EXPO.slots() | 0) - act.length); } catch (er) {}
      if (!act.length) return free ? { t: plural(free, 'slot') + ' free · send a survey', hot: false } : null;
      const next = Math.min(...act.map((a) => +a.t1).filter(isFinite));
      return isFinite(next) ? { t: act.length + ' out · next back in ' + dur(next - t), hot: false } : null;
    },
    moon(s) {
      const m = s.moon; if (!m || !Array.isArray(m.moons) || !m.moons.length) return null;
      const ms = m.moons.filter((x) => x && typeof x === 'object');
      if (ms.some((x) => x._idle === true)) return { t: 'Storage full · collect', hot: true };
      const lc = ms.map((x) => +x.lastCollect).filter((v) => isFinite(v) && v > 0);
      if (!lc.length) return null;
      return { t: 'Collected ' + dur(Date.now() - Math.min(...lc)) + ' ago', hot: false };
    },
    koth() {
      try { if (!window.KOTH || !KOTH.msLeft) return null; const l = KOTH.msLeft(); return isFinite(l) ? { t: 'Today\u2019s race ends in ' + dur(l), hot: false } : null; } catch (e) { return null; }
    },
    skills(s) { const n = N(s.skillPoints); return n > 0 ? { t: fmtN(n) + ' point' + (n === 1 ? '' : 's') + ' to spend', hot: true } : null; },
    pasc(s) { const p = s.pasc; if (!p || typeof p !== 'object') return null; const n = N(p.pts); return n > 0 ? { t: fmtN(n) + ' perk point' + (n === 1 ? '' : 's') + ' to spend', hot: true } : null; },
  };

  function lineFor(card) {
    let el = card.querySelector(':scope > div > .mc-live, :scope > .pa-pill-txt > .mc-live');
    if (el) return el;
    const host = card.querySelector('.mc-n') ? card.querySelector('.mc-n').parentNode : card.querySelector('.pa-pill-txt');
    if (!host) return null;
    el = document.createElement('div'); el.className = 'mc-live'; host.appendChild(el);
    return el;
  }
  function paint() {
    const mega = document.getElementById('mega'); if (!mega) return 0;
    const s = S(); if (!s || !(N(s.level) > 0)) return 0;          // not hydrated: say nothing
    let n = 0;
    Object.keys(P).forEach((id) => {
      const card = mega.querySelector('.mega-grid [data-go="' + id + '"]'); if (!card) return;
      let r = null;
      if (!card.classList.contains('locked')) { try { r = P[id](s); } catch (e) { r = null; } }
      const el = card.querySelector('.mc-live') || (r ? lineFor(card) : null); if (!el) return;
      const t = r && r.t ? String(r.t) : '';
      if (el.textContent !== t) el.textContent = t;
      el.classList.toggle('hot', !!(r && r.hot));
      el.style.display = t ? '' : 'none';
      if (t) n++;
    });
    return n;
  }

  // Paint on open, then once a second while open (countdowns). Closed: idle.
  let _wasOpen = false;
  setInterval(() => {
    const mega = document.getElementById('mega'); if (!mega) return;
    const open = mega.classList.contains('open');
    if (open || !_wasOpen) { try { paint(); } catch (e) {} }
    _wasOpen = open;
  }, 1000);
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('#nav-command')) setTimeout(() => { try { paint(); } catch (er) {} }, 0);
  }, true);

  const css = document.createElement('style'); css.id = 'cmd-status-css';
  css.textContent =
    '.mega-card .mc-live{font-family:"Rajdhani",sans-serif;font-size:12px;font-weight:700;line-height:1.3;color:#8fd8ff;margin-top:2px;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.02em}' +
    '.mega-card .mc-live.hot{color:#f2b24b}' +
    '.mega-card.locked .mc-live{display:none !important}';
  document.head.appendChild(css);

  window.CMDSTATUS = { paint, P, dur };
})();
