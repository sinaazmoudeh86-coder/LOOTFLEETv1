/* =============================================================================
   fleet-deep.js — MY FLEET DEEP DETAILS
   -----------------------------------------------------------------------------
   A hero banner above the multiplier pills on Hangar ▸ My Ship that shows HOW
   every fleet stat is actually built: base, then each contributing system, then
   the total the game uses.

   ---------------------------------------------------------------------------
   IT DERIVES, IT NEVER RESTATES.

   Every figure here is read live from the same functions computeStats() reads —
   skillMods(), PASCEND.mods(), AEGIS.mods(), NANO.combatMods(), COMMANDERS.mods(),
   the hull table, the escort share. Nothing is hardcoded and nothing is
   recomputed a second way, so a balance retune moves this panel on its own and
   the breakdown can never disagree with the stat it is explaining.

   That is the whole reason to build it: the game already had ten systems feeding
   one number and no way to see which one was doing the work. A player holding
   five sources of hull bonus saw a single figure and had to take it on faith.

   ---------------------------------------------------------------------------
   THE ONE PIECE OF MATH WORTH STATING OUT LOUD

   Percentage sources DO NOT COMPOUND. game-v93 computeStats() does:

       s.health *= (1 + (m.hpPct + sm.hpPct + fs.hpPct + hlHp + am.hpPct + nc.hpPct) / 100)

   — one pool, summed, applied to base ONCE. So +176% from a Commander on an
   account already holding +2,000% is +176 points on a 21× multiplier, not a
   1.76× multiplication of the final number. That is the single most
   misunderstood thing in the game (it has been reported as a bug more than
   once), and this panel exists largely to make it visible rather than folklore.

   window.FLEETDEEP.mount()  — called from SHIPPANELS.mount()
   ========================================================================== */
(function () {
  'use strict';
  const G = () => window.GAME;
  const C = () => window.CONFIG || {};
  const num = (x) => (typeof x === 'number' && isFinite(x) ? x : 0);
  const safe = (fn, d) => { try { const v = fn(); return (v == null || (typeof v === 'number' && isNaN(v))) ? d : v; } catch (e) { return d; } };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => safe(() => G().formatNum(n), String(Math.floor(num(n))));
  const pct = (n) => (Math.round(num(n) * 10) / 10);

  // ---- THE STATS WE EXPLAIN --------------------------------------------------
  // Keyed exactly as computeStats() keys them, so a source's contribution can be
  // read straight out of the same object the engine sums.
  const STATS = [
    { k: 'dmgPct',      ic: '⚔', name: 'Fleet Damage',  col: '#ff6b6b', unit: '%' },
    { k: 'hpPct',       ic: '❤', name: 'Fleet Hull',    col: '#59d98c', unit: '%' },
    { k: 'critChance',  ic: '✦', name: 'Crit Chance',   col: '#ffd24d', unit: '%' },
    { k: 'critDamage',  ic: '✧', name: 'Crit Damage',   col: '#ff9f43', unit: '%' },
    { k: 'atkSpeedPct', ic: '⚡', name: 'Fire Rate',     col: '#5bc0ff', unit: '%' },
    { k: 'multiShot',   ic: '⁂', name: 'Multi-Fire',    col: '#c07bff', unit: '×' },
    { k: 'rangePct',    ic: '◎', name: 'Weapon Range',  col: '#7fd0b0', unit: '%' },
    { k: 'moveSpeed',   ic: '➤', name: 'Move Speed',    col: '#8fb7d9', unit: '%' },
    { k: 'lifeSteal',   ic: '✚', name: 'Life Steal',    col: '#ff8ab0', unit: '%' },
  ];
  const STAT_BY_K = {};
  STATS.forEach((s) => { STAT_BY_K[s.k] = s; });

  // ---- WHERE EVERY POINT COMES FROM ------------------------------------------
  // One row per system, each returning the same shape computeStats() consumes.
  // A source that is not installed, not unlocked or contributing nothing simply
  // returns an empty object and drops out of the display — the panel shows what
  // a pilot HAS, never a list of things they do not.
  function sources() {
    const s = safe(() => G().state, {}) || {};
    const out = [];

    // HULL — the flagship's own mods, the floor everything else builds on.
    const ship = safe(() => C().SHIP_BY_KEY[s.ship] || C().SHIPS[0], null);
    if (ship && ship.mods) out.push({ id: 'hull', ic: '⬡', name: ship.name || 'Flagship', kind: 'Hull', col: '#8fb7d9', mods: ship.mods });

    // HULL LEVELS — the flat per-level curve computeStats() applies as hlDmg/hlHp/hlAtk.
    const hl = safe(() => num((s.shipLevels || {})[s.ship]), 0);
    if (hl > 0) out.push({ id: 'hulllv', ic: '▲', name: 'Hull Upgrades', kind: 'Lv ' + hl, col: '#a0c8ff',
      mods: { dmgPct: hl * 10, hpPct: hl * 12, atkSpeedPct: hl * 5 } });

    // SKILL TREE
    const sk = safe(() => G().skillMods(), null);
    if (sk) out.push({ id: 'skills', ic: '◈', name: 'Skill Tree', kind: 'Skills', col: '#5bc0ff', mods: sk });

    // PILOT ASCENSION PERKS. There is no PASCEND.mods() — perks apply through
    // mult()/perkPct(), so this reads the perk table and maps only the ranks that
    // land on a combat stat this panel explains. A perk with no combat key (gold,
    // XP, AFK) is real but belongs to the multiplier pills below, not here.
    const paMods = safe(() => {
      const P = window.PASCEND; if (!P || !P.PERKS || !P.perkPct) return null;
      const m = {};
      P.PERKS.forEach((d) => {
        const v = num(P.perkPct(d.k));
        if (!v || !STAT_BY_K[d.k]) return;
        m[d.k] = (m[d.k] || 0) + v;
      });
      return Object.keys(m).length ? m : null;
    }, null);
    if (paMods) out.push({ id: 'perks', ic: '✦', name: 'Ascension Perks', kind: 'Permanent', col: '#ffd24d', mods: paMods });

    // ESCORTS — each contributes C.FLEET.statShare of its own hull mods.
    const esc = safe(() => G().fleetShips(), []) || [];
    if (esc.length) {
      const share = safe(() => C().FLEET.statShare, 0.25);
      const fs = {};
      esc.forEach((f) => { const fm = f.mods || {}; for (const k in fm) fs[k] = (fs[k] || 0) + num(fm[k]) * share; });
      out.push({ id: 'escorts', ic: '⬢', name: 'Escort Wing', kind: esc.length + ' ship' + (esc.length === 1 ? '' : 's') + ' · ' + Math.round(share * 100) + '% each', col: '#7fd0b0', mods: fs });
    }

    // NANOCORES — per-hull, so this is the flagship's fitted core.
    const nc = safe(() => window.NANO && window.NANO.combatMods && window.NANO.combatMods(s.ship), null);
    if (nc) out.push({ id: 'nano', ic: '⬢', name: 'Nanocore', kind: 'Fitted', col: '#f0972a', mods: nc });

    // AEGIS AURAS
    const am = safe(() => window.AEGIS && window.AEGIS.mods && window.AEGIS.mods(), null);
    if (am) out.push({ id: 'aegis', ic: '◇', name: 'Aegis Auras', kind: 'Field', col: '#9ad4ff', mods: am });

    // COMMANDERS
    const cm = safe(() => window.COMMANDERS && window.COMMANDERS.mods && window.COMMANDERS.mods(), null);
    if (cm) {
      const n = safe(() => window.COMMANDERS.slots().length, 0);
      out.push({ id: 'cmdr', ic: '✦', name: 'Commanders', kind: n + ' seated', col: '#c07bff', mods: cm });
    }

    // Keep only sources that actually move one of the stats we explain. Anything
    // installed but contributing zero to every combat stat is genuinely not part
    // of this breakdown — it belongs to the utility pills (XP, gold, AFK) below.
    return out.filter((src) => STATS.some((st) => Math.abs(num((src.mods || {})[st.k])) > 0.05));
  }

  // Total per stat, summed exactly the way computeStats() sums them.
  function totals(srcs) {
    const t = {};
    STATS.forEach((st) => { t[st.k] = 0; });
    srcs.forEach((src) => { STATS.forEach((st) => { t[st.k] += num((src.mods || {})[st.k]); }); });
    return t;
  }

  // ---- THE BUILD SHAPE --------------------------------------------------------
  // Nine axes on one polygon. Values are compressed with a 0.45 power curve
  // rather than plotted linearly: Weapon Range at +4063 alongside Life Steal at
  // +30 would otherwise draw a spike and eight flat lines, which reads as a
  // broken chart instead of a lopsided build. The curve keeps the small axes
  // visible while the big ones still dominate — and the axis labels carry the
  // real numbers, so nothing is hidden by the shaping.
  function radar(t, live) {
    const R = 74, cx = 96, cy = 90;
    const peak = live.reduce((m, s) => Math.max(m, Math.abs(t[s.k])), 1);
    const pt = (i, f) => {
      const a = (i / live.length) * Math.PI * 2 - Math.PI / 2;
      return [cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f];
    };
    const norm = (v) => Math.max(0.06, Math.pow(Math.abs(v) / peak, 0.45));
    const poly = live.map((s, i) => pt(i, norm(t[s.k])).map((n) => Math.round(n * 10) / 10).join(',')).join(' ');
    const web = [0.25, 0.5, 0.75, 1].map((f) =>
      '<polygon class="fd-web" points="' + live.map((s, i) => pt(i, f).map((n) => Math.round(n * 10) / 10).join(',')).join(' ') + '"/>').join('');
    const spokes = live.map((s, i) => {
      const p = pt(i, 1);
      return '<line class="fd-spoke" x1="' + cx + '" y1="' + cy + '" x2="' + (Math.round(p[0] * 10) / 10) + '" y2="' + (Math.round(p[1] * 10) / 10) + '"/>';
    }).join('');
    const dots = live.map((s, i) => {
      const p = pt(i, norm(t[s.k]));
      return '<circle class="fd-dot" cx="' + (Math.round(p[0] * 10) / 10) + '" cy="' + (Math.round(p[1] * 10) / 10) + '" r="3.2" style="--c:' + s.col + ';--d:' + (i * 55) + 'ms"/>';
    }).join('');
    const labels = live.map((s, i) => {
      const p = pt(i, 1.28);
      const anchor = p[0] > cx + 6 ? 'start' : p[0] < cx - 6 ? 'end' : 'middle';
      return '<text class="fd-ax" x="' + (Math.round(p[0])) + '" y="' + (Math.round(p[1]) + 3) + '" text-anchor="' + anchor + '" style="fill:' + s.col + '">' + s.ic + '</text>';
    }).join('');
    return '<div class="fd-radar">'
      + '<svg viewBox="0 0 192 180" aria-hidden="true">'
      + '<defs><radialGradient id="fdg"><stop offset="0%" stop-color="#7fd0ff" stop-opacity=".55"/><stop offset="100%" stop-color="#7fd0ff" stop-opacity=".06"/></radialGradient></defs>'
      + web + spokes
      + '<polygon class="fd-poly" points="' + poly + '"/>'
      + dots + labels
      + '</svg>'
      + '<div class="fd-radar-x"><b>BUILD SHAPE</b>'
      + '<span>Relative weight across all nine stats. Compressed so the small axes stay readable \u2014 the numbers on the tabs are the real ones.</span></div>'
      + '</div>';
  }

  // ---- THE PANEL --------------------------------------------------------------
  let _open = false, _stat = 'dmgPct';

  function html() {
    const srcs = sources();
    const t = totals(srcs);
    const live = STATS.filter((st) => Math.abs(t[st.k]) > 0.05);
    if (!live.length) {
      return '<div class="fd-wrap"><div class="fd-head"><span class="fd-t">MY FLEET DEEP DETAILS</span>'
        + '<span class="fd-s">No bonuses yet — fit gear, level your hull or seat a Commander and the breakdown appears here.</span></div></div>';
    }
    if (!live.some((st) => st.k === _stat)) _stat = live[0].k;
    const st = STAT_BY_K[_stat];
    const total = t[_stat];

    // Contributions to the SELECTED stat, biggest first — the question a player
    // is actually asking is "what is doing the work here".
    const rows = srcs
      .map((src) => ({ src, v: num((src.mods || {})[_stat]) }))
      .filter((r) => Math.abs(r.v) > 0.05)
      .sort((a, b) => b.v - a.v);
    const peak = rows.reduce((m, r) => Math.max(m, Math.abs(r.v)), 1);

    // The real multiplier this pool produces, and the honest headline: a stat is
    // base × (1 + pool/100), so this is the number the engine actually uses.
    const mult = 1 + total / 100;

    return '<div class="fd-wrap' + (_open ? ' open' : '') + '">'
      + '<button class="fd-head" data-fd-toggle>'
      + '<span class="fd-orb" style="--c:' + st.col + '"><i>' + st.ic + '</i></span>'
      + '<span class="fd-hx">'
      + '<span class="fd-t">MY FLEET DEEP DETAILS</span>'
      + '<span class="fd-s">' + srcs.length + ' system' + (srcs.length === 1 ? '' : 's') + ' feeding ' + live.length + ' stat' + (live.length === 1 ? '' : 's')
      + ' — tap to see exactly how</span>'
      + '</span>'
      + '<span class="fd-big" style="--c:' + st.col + '">×' + (Math.round(mult * 100) / 100) + '</span>'
      + '<span class="fd-caret">' + (_open ? '▲' : '▼') + '</span>'
      + '</button>'
      + (_open ? body(live, t, st, rows, peak, total, mult) : '')
      + '</div>';
  }

  function body(live, t, st, rows, peak, total, mult) {
    return '<div class="fd-body">'
      // ---- stat selector -----------------------------------------------------
      + '<div class="fd-tabs">' + live.map((x) =>
          '<button class="fd-tab' + (x.k === _stat ? ' on' : '') + '" data-fd-stat="' + x.k + '" style="--c:' + x.col + '">'
          + '<i>' + x.ic + '</i><b>' + esc(x.name) + '</b>'
          + '<em>+' + pct(t[x.k]) + (x.unit === '×' ? '' : '%') + '</em></button>').join('')
      + '</div>'
      // ---- the equation ------------------------------------------------------
      // Stated as the engine states it, because the compounding assumption is the
      // single most common misreading of these numbers.
      + '<div class="fd-eq">'
      + '<span class="fd-eq-p">BASE</span><span class="fd-eq-o">×</span>'
      + '<span class="fd-eq-p">( 1 + <b style="color:' + st.col + '">' + pct(total) + '</b> ÷ 100 )</span>'
      + '<span class="fd-eq-o">=</span>'
      + '<span class="fd-eq-r" style="color:' + st.col + '">×' + (Math.round(mult * 100) / 100) + '</span>'
      + '</div>'
      + '<div class="fd-note">Every source below <b>adds into one pool</b>, then that pool multiplies your base <b>once</b>. '
      + 'They do not compound with each other — which is why a big percentage on a deep account moves the final number less than it reads.</div>'
      + radar(t, live)
      // ---- the stacked bar ---------------------------------------------------
      + '<div class="fd-stack">' + rows.map((r, i) =>
          '<span class="fd-seg" style="--c:' + r.src.col + ';--w:' + (Math.max(0, r.v) / Math.max(1, total) * 100) + '%;--d:' + (i * 70) + 'ms" title="' + esc(r.src.name) + '"></span>').join('')
      + '</div>'
      // ---- per-source rows ---------------------------------------------------
      + '<div class="fd-rows">' + rows.map((r, i) => {
          const share = total > 0 ? Math.round(r.v / total * 100) : 0;
          return '<div class="fd-row" style="--c:' + r.src.col + ';--d:' + (i * 60) + 'ms">'
            + '<span class="fd-r-ic">' + r.src.ic + '</span>'
            + '<span class="fd-r-x"><b>' + esc(r.src.name) + '</b><em>' + esc(r.src.kind) + '</em></span>'
            + '<span class="fd-r-bar"><i style="--w:' + (Math.abs(r.v) / peak * 100) + '%;--d:' + (i * 60) + 'ms"></i></span>'
            + '<span class="fd-r-v">' + (r.v >= 0 ? '+' : '') + pct(r.v) + (st.unit === '×' ? '' : '%') + '</span>'
            + '<span class="fd-r-p">' + share + '%</span>'
            // WHAT YOU LOSE IF IT GOES. The multiplier without this source, and
            // the real percentage drop — which is NOT its share of the pool. A
            // system holding 18% of the points is worth far less than 18% of your
            // damage once the base multiplier is accounted for, and that gap is
            // exactly what people get wrong comparing two upgrades.
            + '<span class="fd-r-w">without<b>\u00d7' + (Math.round((1 + (total - r.v) / 100) * 100) / 100) + '</b>'
            + '<em>\u2212' + (Math.round((1 - (1 + (total - r.v) / 100) / mult) * 1000) / 10) + '%</em></span>'
            + '</div>';
        }).join('')
      + '</div>'
      // ---- what it lands on --------------------------------------------------
      + liveStats()
      + '</div>';
  }

  // The engine's OWN output, so the panel can be checked against the thing it
  // claims to explain rather than asking to be trusted.
  function liveStats() {
    const s = safe(() => G().rt.stats, null);
    if (!s) return '';
    const cells = [
      ['Damage', fmt(s.attackDamage)],
      ['Hull', fmt(s.health)],
      ['Crit', pct(s.critChance) + '%'],
      ['Crit Dmg', pct(s.critDamage) + '%'],
      ['Fire Rate', (Math.round(num(s.attacksPerSec) * 100) / 100) + '/s'],
      ['Multi-Fire', '×' + (num(s.multiShot) || 1)],
    ];
    return '<div class="fd-live"><div class="fd-live-h">WHAT THE ENGINE IS USING RIGHT NOW</div>'
      + '<div class="fd-live-g">' + cells.map((c) =>
          '<span class="fd-live-c"><b>' + esc(c[1]) + '</b><em>' + esc(c[0]) + '</em></span>').join('')
      + '</div></div>';
  }

  // ---- MOUNT ------------------------------------------------------------------
  // Writes ONLY when the rendered HTML changed. refreshAll() re-runs on every
  // combat tick while this screen is open, and rebuilding identical innerHTML
  // each tick is what made the panels above it flicker during a grind.
  function mount() {
    try {
      const pillsHost = document.getElementById('sp-pills-host');
      if (!pillsHost || !pillsHost.parentNode) return;
      let host = document.getElementById('fd-host');
      if (!host) {
        host = document.createElement('div');
        host.id = 'fd-host';
        pillsHost.parentNode.insertBefore(host, pillsHost);
      } else if (host.nextSibling !== pillsHost) {
        pillsHost.parentNode.insertBefore(host, pillsHost);   // stay directly above the pills
      }
      const h = html();
      if (host._lastHtml === h) return;
      host._lastHtml = h;
      host.innerHTML = h;
      const tog = host.querySelector('[data-fd-toggle]');
      if (tog) tog.addEventListener('click', () => { _open = !_open; host._lastHtml = null; mount(); });
      host.querySelectorAll('[data-fd-stat]').forEach((b) => b.addEventListener('click', () => {
        _stat = b.dataset.fdStat; host._lastHtml = null; mount();
      }));
    } catch (e) {}
  }

  (function css() {
    if (document.getElementById('fd-css')) return;
    const s = document.createElement('style');
    s.id = 'fd-css';
    s.textContent = [
      '#fd-host{margin:0 0 12px}',
      '.fd-wrap{border:1px solid #2a3546;border-radius:16px;overflow:hidden;background:radial-gradient(130% 120% at 8% 0%,#1a2438 0%,#111823 55%,#0d131c 100%)}',
      '.fd-wrap.open{border-color:#3a4a63}',
      // ---- header ----
      '.fd-head{display:flex;align-items:center;gap:13px;width:100%;padding:15px 16px;border:0;background:none;cursor:pointer;text-align:left}',
      '.fd-orb{position:relative;width:44px;height:44px;flex:0 0 44px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 34% 30%,color-mix(in srgb,var(--c) 55%,transparent),#0b0f16 72%);border:1px solid color-mix(in srgb,var(--c) 50%,transparent)}',
      '.fd-orb i{font-style:normal;font-size:19px;color:var(--c);text-shadow:0 0 10px color-mix(in srgb,var(--c) 70%,transparent)}',
      '.fd-orb::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:1px solid color-mix(in srgb,var(--c) 30%,transparent);animation:fdpulse 2.6s ease-in-out infinite}',
      '@keyframes fdpulse{0%,100%{transform:scale(1);opacity:.55}50%{transform:scale(1.13);opacity:0}}',
      '.fd-hx{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.fd-t{font:900 13px/1 Orbitron,sans-serif;letter-spacing:.11em;color:#eaf0fa}',
      '.fd-s{font:700 12px/1.35 Rajdhani,sans-serif;color:#8ba0b5}',
      '.fd-big{font:900 24px/1 Orbitron,sans-serif;color:var(--c);text-shadow:0 0 16px color-mix(in srgb,var(--c) 45%,transparent);flex:0 0 auto}',
      '.fd-caret{font-size:11px;color:#5d6b84;flex:0 0 auto}',
      // ---- body ----
      '.fd-body{padding:0 16px 16px;display:flex;flex-direction:column;gap:12px;animation:fdin .28s cubic-bezier(.2,.9,.3,1)}',
      '@keyframes fdin{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}',
      '.fd-tabs{display:flex;gap:7px;flex-wrap:wrap}',
      '.fd-tab{display:flex;align-items:center;gap:6px;padding:8px 11px;border-radius:10px;border:1px solid #2a3546;background:#0f141c;cursor:pointer;font-family:Rajdhani,sans-serif}',
      '.fd-tab i{font-style:normal;font-size:13px;color:var(--c)}',
      '.fd-tab b{font-weight:800;font-size:12px;color:#c3cede}',
      '.fd-tab em{font-style:normal;font-weight:800;font-size:12px;color:var(--c)}',
      '.fd-tab.on{border-color:var(--c);background:color-mix(in srgb,var(--c) 13%,#0f141c);box-shadow:0 0 14px -6px var(--c)}',
      // ---- the equation ----
      '.fd-eq{display:flex;align-items:center;gap:9px;flex-wrap:wrap;justify-content:center;padding:13px 12px;border-radius:12px;background:#0b0f16;border:1px solid #1f2836}',
      '.fd-eq-p{font:800 13px/1 Rajdhani,sans-serif;color:#9fb0c4}',
      '.fd-eq-p b{font-size:17px}',
      '.fd-eq-o{font:800 15px/1 Rajdhani,sans-serif;color:#5d6b84}',
      '.fd-eq-r{font:900 22px/1 Orbitron,sans-serif}',
      '.fd-note{font:700 12.5px/1.55 Rajdhani,sans-serif;color:#8ba0b5;text-wrap:pretty}',
      '.fd-note b{color:#c3cede}',
      // ---- stacked bar ----
      '.fd-stack{display:flex;height:12px;border-radius:7px;overflow:hidden;background:#0b0f16;border:1px solid #1f2836}',
      '.fd-seg{display:block;height:100%;background:var(--c);width:0;animation:fdgrow .7s cubic-bezier(.2,.9,.3,1) forwards;animation-delay:var(--d);box-shadow:0 0 10px -3px var(--c)}',
      '@keyframes fdgrow{to{width:var(--w)}}',
      // ---- rows ----
      '.fd-rows{display:flex;flex-direction:column;gap:7px}',
      '.fd-row{display:grid;grid-template-columns:26px minmax(0,1fr) 72px 58px 36px 78px;align-items:center;gap:9px;padding:9px 11px;border-radius:10px;background:#0f141c;border:1px solid #1f2836;border-left:3px solid var(--c);opacity:0;animation:fdrow .4s ease-out forwards;animation-delay:var(--d)}',
      '@keyframes fdrow{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none}}',
      '.fd-r-ic{font-size:15px;color:var(--c);text-align:center}',
      '.fd-r-x{min-width:0;display:flex;flex-direction:column;gap:1px}',
      '.fd-r-x b{font:800 13px/1.15 Rajdhani,sans-serif;color:#eaf0fa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.fd-r-x em{font:700 11px/1.15 Rajdhani,sans-serif;font-style:normal;color:#7d8ba0}',
      '.fd-r-bar{height:6px;border-radius:4px;background:#0b0f16;overflow:hidden}',
      '.fd-r-bar i{display:block;height:100%;width:0;background:var(--c);border-radius:4px;animation:fdgrow .65s cubic-bezier(.2,.9,.3,1) forwards;animation-delay:var(--d)}',
      '.fd-r-v{font:900 14px/1 Rajdhani,sans-serif;color:var(--c);text-align:right}',
      '.fd-r-p{font:700 11px/1 Rajdhani,sans-serif;color:#7d8ba0;text-align:right}',
      '.fd-r-w{display:flex;flex-direction:column;align-items:flex-end;gap:0;font:700 9.5px/1.15 Rajdhani,sans-serif;letter-spacing:.08em;color:#5d6b84}',
      '.fd-r-w b{font:900 13px/1.1 Rajdhani,sans-serif;color:#9fb0c4}',
      '.fd-r-w em{font-style:normal;font:800 10.5px/1.1 Rajdhani,sans-serif;color:#ff9f9f}',
      // ---- radar ----
      '.fd-radar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px;border-radius:12px;background:#0b0f16;border:1px solid #1f2836}',
      '.fd-radar svg{width:192px;height:180px;flex:0 0 192px;overflow:visible}',
      '.fd-web{fill:none;stroke:#1f2836;stroke-width:1}',
      '.fd-spoke{stroke:#1a2230;stroke-width:1}',
      '.fd-poly{fill:url(#fdg);stroke:#7fd0ff;stroke-width:2;stroke-linejoin:round;filter:drop-shadow(0 0 6px rgba(127,208,255,.45));transform-origin:96px 90px;animation:fdradar .85s cubic-bezier(.2,.9,.3,1) both}',
      '@keyframes fdradar{from{transform:scale(.2);opacity:0}to{transform:scale(1);opacity:1}}',
      '.fd-dot{fill:var(--c);opacity:0;animation:fddot .35s ease-out forwards;animation-delay:calc(var(--d) + 300ms);filter:drop-shadow(0 0 4px var(--c))}',
      '@keyframes fddot{to{opacity:1}}',
      '.fd-ax{font:800 11px Rajdhani,sans-serif;opacity:.9}',
      '.fd-radar-x{flex:1 1 180px;min-width:0;display:flex;flex-direction:column;gap:4px}',
      '.fd-radar-x b{font:800 11px/1 Rajdhani,sans-serif;letter-spacing:.15em;color:#7fd0ff}',
      '.fd-radar-x span{font:700 12px/1.5 Rajdhani,sans-serif;color:#8ba0b5;text-wrap:pretty}',
      '@media (max-width:520px){.fd-radar{justify-content:center}.fd-radar svg{width:170px;height:160px;flex:0 0 170px}}',
      '@media (max-width:520px){.fd-row{grid-template-columns:22px minmax(0,1fr) 56px 66px;gap:7px}.fd-r-bar,.fd-r-p{display:none}}',
      // ---- live readout ----
      '.fd-live{border-top:1px solid #1f2836;padding-top:12px}',
      '.fd-live-h{font:800 10.5px/1 Rajdhani,sans-serif;letter-spacing:.15em;color:#5d6b84;margin-bottom:8px}',
      '.fd-live-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:7px}',
      '.fd-live-c{display:flex;flex-direction:column;gap:2px;padding:9px 10px;border-radius:9px;background:#0b0f16;border:1px solid #1f2836}',
      '.fd-live-c b{font:900 15px/1 Rajdhani,sans-serif;color:#eaf0fa}',
      '.fd-live-c em{font:700 10.5px/1 Rajdhani,sans-serif;font-style:normal;letter-spacing:.08em;color:#7d8ba0}',
    ].join('');
    document.head.appendChild(s);
  })();

  window.FLEETDEEP = { mount, sources, totals };
})();
