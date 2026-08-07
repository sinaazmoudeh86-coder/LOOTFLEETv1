/* =============================================================================
   ship-panels.js — two readouts for Hangar ▸ My Ship
   ---------------------------------------------------------------------------
   1. MULTIPLIERS. The stat list shows what the ship does. It never showed the
      multipliers stacked on top of it — XP gain, boss damage, gold, AFK — which
      are spread across the Pilot Tree, Ship Ascension, Pilot Ascension, VIP and
      Pro. A player could hold five sources of XP bonus and see none of them.
      Rendered as pills, matching the Pilot tab's language.

   2. INCOME. Every hourly earner the account owns, broken down and totalled:
      galaxy tiles, Void spires, and the Moon Colony. Sits at the bottom of the
      My Ship scroll as a hero block.

   EVERY READ IS DEFENSIVE. These numbers come from six other modules, any of
   which can be mid-load, absent on an older save, or gated behind a level the
   player hasn't reached. A missing source contributes nothing and is omitted
   rather than shown as zero — a row that reads "0×" is worse than no row.
   ============================================================================= */
(function () {
  'use strict';

  const G = () => window.GAME;
  const num = (n) => { try { return G().formatNum(n); } catch (e) { return String(Math.round(n || 0)); } };
  const pct = (m) => Math.round((m - 1) * 1000) / 10;
  // isNaN() only applies to NUMBERS — isNaN(object) coerces to NaN and is true,
  // so the old guard silently threw away every OBJECT result: resourceRates()
  // (the "empire income shows nothing despite tiles" bug), MOON.totalRates(),
  // DREAD.combatMods() and xpFleetInfo() were all being replaced by their
  // fallbacks on every single call.
  const safe = (fn, d) => { try { const v = fn(); return (v == null || (typeof v === 'number' && isNaN(v))) ? d : v; } catch (e) { return d; } };

  // ---- 1. MULTIPLIERS ---------------------------------------------------------
  function bonuses() {
    const s = (G() || {}).state || {};
    const out = [];

    // XP — read straight from GAME.xpFleetInfo(): ONE base rate (100%, or 200%
    // on Pro), and every bonus is a flat % of that base — summed, then
    // multiplied in. No cap. Shown as the TOTAL rate (100% = normal).
    // NOT safe(): its isNaN() guard coerces an OBJECT to NaN and throws the whole
    // result away — xpFleetInfo returns an object, so safe() returned null on
    // every account and the pill never rendered. Plain try/catch.
    let xi = null; try { xi = G().xpFleetInfo ? G().xpFleetInfo() : null; } catch (e) {}
    // ALWAYS visible — even at base. Hiding the pill read as a missing feature,
    // and the base rate is itself information: none of your bonuses are on.
    if (xi) {
      const brk = (xi.sources || []).map((s) => s.n + ' +' + s.pct + '%').join(' · ');
      out.push({
        ic: '✦', n: 'XP Rate', v: xi.pct + '%', c: xi.buffPct > 0 ? '#7ce0a0' : '#8fa3bd',
        tip: 'Base ' + xi.basePct + '%' + (xi.pro ? ' (doubled by LootFleet Pro)' : '')
          + (xi.buffPct > 0
            ? ' + bonuses ' + xi.buffPct + '% of base (' + brk + '). Bonuses add together, then multiply the base — no cap.'
            : '. No bonuses active — VIP, Pilot Tree XP nodes, Neural Uplink, Combat Computer and Kaevith hulls each add a flat % of this base.'),
      });
    }

    // LOOT — right next to XP, same always-on treatment. Two account-wide
    // halves: DROP CHANCE (Salvage Doctrine) and LOOT QUALITY (Pilot Tree
    // Treasure Sense nodes). Zone/tile quality bonuses are location-based and
    // deliberately not counted here.
    {
      const drop = safe(() => (window.PASCEND ? PASCEND.mult('loot') : 1), 1);
      const qual = safe(() => (window.DREAD && DREAD.mult ? DREAD.mult('lootQuality') : 1), 1);
      const dPct = pct(drop), qPct = pct(qual);
      out.push({
        ic: '❖', n: 'Loot Quality', v: '+' + Math.round(qPct + dPct) + '%',
        c: (qPct + dPct) > 0 ? '#7ce0a0' : '#8fa3bd',
        tip: (qPct + dPct) > 0
          ? 'Drop chance +' + Math.round(dPct) + '% (Salvage Doctrine) · roll quality +' + Math.round(qPct) + '% (Pilot Tree). Zone bonuses (×2 quality tiles, deep space) stack on top where you fly.'
          : 'No loot sources active. The Salvage Doctrine ascension perk raises drop chance; Pilot Tree Treasure Sense nodes raise roll quality.',
      });
    }

    // Damage against the things that matter
    const cm = safe(() => (window.DREAD && DREAD.combatMods ? DREAD.combatMods() : {}), {});
    if (cm.bossDamage > 0)  out.push({ ic: '☠', n: 'Boss Damage',  v: '+' + Math.round(cm.bossDamage) + '%',  c: '#ff8a96' });
    if (cm.eliteDamage > 0) out.push({ ic: '◈', n: 'Elite Damage', v: '+' + Math.round(cm.eliteDamage) + '%', c: '#ffb4bb' });

    const gold = safe(() => (window.VIP ? VIP.mult('gold') : 1), 1)
               * safe(() => (window.PASCEND ? PASCEND.mult('gold') : 1), 1);
    if (gold > 1.001) out.push({ ic: '$', n: 'Gold Find', v: '+' + pct(gold) + '%', c: '#e6b566' });

    const afk = safe(() => (window.VIP ? VIP.mult('afk') : 1), 1);
    if (afk > 1.001) out.push({ ic: '◷', n: 'Offline Rate', v: '+' + pct(afk) + '%', c: '#8fb0c8' });

    // Ascension stars are the headline the Pilot tab leads with
    const stars = safe(() => (window.PASCEND ? PASCEND.stars() | 0 : 0), 0);
    if (stars > 0) out.push({ ic: '★', n: 'Ascension', v: stars + (stars === 1 ? ' star' : ' stars'), c: '#f2a93c' });

    const vip = safe(() => (window.VIP ? VIP.level() | 0 : 0), 0);
    if (vip > 0) out.push({ ic: '♛', n: 'VIP', v: 'Level ' + vip, c: '#b57bff' });

    if (safe(() => (G().isPro && G().isPro()), false)) out.push({ ic: '⚡', n: 'Pro', v: '5× speed', c: '#5fd1ff' });

    const badges = (s.badgeRanks | 0) || (s.achClaimed | 0) || 0;
    if (badges > 0) out.push({ ic: '⬡', n: 'Badges', v: num(badges) + ' / 1,000', c: '#9fd6ff' });

    return out;
  }

  function bonusHtml() {
    const b = bonuses();
    if (!b.length) return '';
    return '<div class="sp-pills">' + b.map((x) =>
      '<span class="sp-pill" style="--c:' + x.c + '"'
      + (x.tip ? ' title="' + String(x.tip).replace(/"/g, '&quot;') + '"' : '') + '>'
      + '<i>' + x.ic + '</i>' + x.n + '<b>' + x.v + '</b></span>').join('') + '</div>';
  }

  // ---- 2. INCOME ---------------------------------------------------------------
  const CUR = [
    { k: 'gold',   g: '$', n: 'Gold',   c: '#e6b566' },
    { k: 'fuel',   g: '⬢', n: 'Fuel',   c: '#5fd1ff' },
    { k: 'iron',   g: '◆', n: 'Iron',   c: '#c3cede' },
    { k: 'plasma', g: '✦', n: 'Plasma', c: '#b57bff' },
    { k: 'prism',  g: '◈', n: 'Prism',  c: '#ff8ad4' },
  ];

  // Galaxy and Void both deposit through resourceRates(). It returns one merged
  // figure, so they are split here by walking the same tiles it walks — Void
  // spires pay all four currencies and are worth calling out separately.
  function sources() {
    const g = G(), s = g && g.state;
    if (!g || !s) return [];
    const src = [];

    const all = safe(() => g.resourceRates(), null);
    if (all) {
      const voidR = { gold: 0, fuel: 0, iron: 0, plasma: 0 };
      let voidN = 0, tileN = 0, citN = 0;
      try {
        Object.keys(s.ownedSystems || {}).forEach((k) => {
          const t = g.sysAt ? g.sysAt(k) : null; if (!t || !t.rate) return;
          if (t.void) {
            voidN++;
            const vr = t.rate * 25;
            voidR.fuel += vr; voidR.iron += vr; voidR.plasma += vr; voidR.gold += vr * 1000;
          } else {
            tileN++;
            // Count NATURAL citadels (seeded terrain, t.citadel) as well as ones you
            // built (state.citadels). captureSystem() deliberately writes no
            // state.citadels entry for a natural citadel — its ×1000 is already
            // baked into t.rate, and an entry would multiply it again — so this
            // panel used to report "0 citadels" for a fortress the player had just
            // conquered.
            if (t.citadel || (s.citadels && s.citadels[k])) citN++;
          }
        });
      } catch (e) {}
      const galaxy = {};
      CUR.forEach((c) => { galaxy[c.k] = Math.max(0, (all[c.k] || 0) - (voidR[c.k] || 0)); });
      if (tileN) src.push({ n: 'Galaxy Tiles', sub: tileN + ' system' + (tileN === 1 ? '' : 's') + (citN ? ' · ' + citN + ' citadel' + (citN === 1 ? '' : 's') : ''), ic: '⚑', c: '#5fa8ff', r: galaxy });
      if (voidN) src.push({ n: 'Void Zone', sub: voidN + ' apex spire' + (voidN === 1 ? '' : 's') + ' · pays every currency', ic: '🌌', c: '#9b4dff', r: voidR });
    }

    const moon = safe(() => (window.MOON && MOON.totalRates ? MOON.totalRates() : null), null);
    if (moon && CUR.some((c) => (moon[c.k] || 0) > 0)) {
      const n = safe(() => ((G().state.moon || {}).moons || []).length, 0);
      src.push({ n: 'Moon Colony', sub: n + ' colon' + (n === 1 ? 'y' : 'ies') + ' · mines run offline', ic: '🌑', c: '#8fb0c8', r: moon });
    }

    // HOME CITADEL — wave-defense infrastructure; produces hourly into its silo.
    const hcit = safe(() => (window.HOMECIT && HOMECIT.totalRates ? HOMECIT.totalRates() : null), null);
    if (hcit && hcit.rates && CUR.some((c) => (hcit.rates[c.k] || 0) > 0)) {
      src.push({
        n: 'Home Citadel',
        sub: 'Wave ' + hcit.wave + ' defended · ' + (hcit.damaged ? '⚠ damaged — production paused' : 'stores at the citadel, collect there'),
        ic: '🏰', c: '#ffd24d', r: hcit.rates,
      });
    }
    return src;
  }

  function incomeHtml() {
    const src = sources();
    const total = {};
    CUR.forEach((c) => { total[c.k] = src.reduce((a, s) => a + (s.r[c.k] || 0), 0); });
    const any = CUR.some((c) => total[c.k] > 0);

    let h = '<div class="sp-inc"><div class="sp-inc-h"><span class="sp-inc-t">EMPIRE INCOME</span><em>every hour, whether you play or not</em></div>';

    if (!any) {
      h += '<div class="sp-inc-empty">Nothing is paying you yet.<br><span>Claim a system in <b>My Galaxy</b> and it starts producing immediately \u2014 online or off.</span></div></div>';
      return h;
    }

    h += '<div class="sp-tot">' + CUR.filter((c) => total[c.k] > 0).map((c) =>
      '<div class="sp-tot-i" style="--c:' + c.c + '"><span class="sp-g">' + c.g + '</span><b>' + num(total[c.k]) + '</b><em>' + c.n + ' / hr</em></div>').join('') + '</div>';

    h += '<div class="sp-src">' + src.map((s) => {
      const parts = CUR.filter((c) => (s.r[c.k] || 0) > 0)
        .map((c) => '<span style="color:' + c.c + '">' + c.g + ' ' + num(s.r[c.k]) + '</span>').join('');
      return '<div class="sp-row"><div class="sp-row-ic" style="--c:' + s.c + '">' + s.ic + '</div>' +
             '<div class="sp-row-m"><div class="sp-row-n">' + s.n + '</div><div class="sp-row-s">' + s.sub + '</div></div>' +
             '<div class="sp-row-v">' + parts + '</div></div>';
    }).join('') + '</div></div>';
    return h;
  }

  // ---- mount -------------------------------------------------------------------
  // Called from renderHero — which refreshAll() re-runs on every combat tick
  // while the screen is open. Rebuilding identical innerHTML each tick made the
  // whole block flicker during a zone grind, so both hosts now write ONLY when
  // their rendered HTML actually changed.
  function mount() {
    try {
      const list = document.getElementById('stat-list');
      if (!list) return;
      const host = list.parentNode;

      let pills = document.getElementById('sp-pills-host');
      if (!pills) {
        pills = document.createElement('div');
        pills.id = 'sp-pills-host';
        list.parentNode.insertBefore(pills, list);
      }
      const ph = bonusHtml();
      if (pills._lastHtml !== ph) { pills._lastHtml = ph; pills.innerHTML = ph; }

      let inc = document.getElementById('sp-inc-host');
      if (!inc) { inc = document.createElement('div'); inc.id = 'sp-inc-host'; host.appendChild(inc); }
      else if (inc.parentNode !== host || inc.nextSibling) host.appendChild(inc);   // keep last in the scroll
      const ih = incomeHtml();
      if (inc._lastHtml !== ih) { inc._lastHtml = ih; inc.innerHTML = ih; }
    } catch (e) {}
  }

  const css = document.createElement('style');
  css.textContent = `
  #sp-pills-host{margin:0 0 10px}
  .sp-pills{display:flex;flex-wrap:wrap;gap:6px}
  .sp-pill{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;
    border:1px solid color-mix(in srgb,var(--c) 42%,transparent);background:color-mix(in srgb,var(--c) 11%,transparent);
    font-family:'Rajdhani',sans-serif;font-weight:700;font-size:11.5px;letter-spacing:.02em;color:#c3cede;white-space:nowrap}
  .sp-pill i{font-style:normal;color:var(--c);font-size:12px}
  .sp-pill b{color:var(--c);font-weight:800}
  #sp-inc-host{margin:14px 0 4px}
  .sp-inc{border:1px solid rgba(95,168,255,.3);border-radius:15px;overflow:hidden;
    background:linear-gradient(180deg,rgba(95,168,255,.09),rgba(95,168,255,.02))}
  .sp-inc-h{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;padding:13px 15px 10px}
  .sp-inc-t{font-family:'Orbitron',sans-serif;font-weight:900;font-size:12px;letter-spacing:.11em;color:#eaf0fa}
  .sp-inc-h em{font-style:normal;font-size:11px;color:#8ba0b5}
  .sp-inc-empty{padding:6px 15px 16px;font-size:13px;font-weight:700;color:#c3cede;font-family:'Rajdhani',sans-serif}
  .sp-inc-empty span{display:block;margin-top:4px;font-weight:400;font-size:12px;color:#8ba0b5;line-height:1.45}
  .sp-tot{display:flex;flex-wrap:wrap;gap:8px;padding:0 15px 13px}
  .sp-tot-i{flex:1 1 92px;display:flex;flex-direction:column;align-items:flex-start;gap:1px;
    padding:9px 11px;border-radius:11px;background:rgba(0,0,0,.28);border:1px solid color-mix(in srgb,var(--c) 26%,transparent)}
  .sp-tot-i .sp-g{font-size:12px;color:var(--c);line-height:1}
  .sp-tot-i b{font-family:'Orbitron',sans-serif;font-weight:800;font-size:16px;color:var(--c);line-height:1.15}
  .sp-tot-i em{font-style:normal;font-size:9.5px;letter-spacing:.06em;color:#7e90a6;text-transform:uppercase}
  .sp-src{border-top:1px solid rgba(255,255,255,.07);padding:4px 0 6px}
  .sp-row{display:flex;align-items:center;gap:11px;padding:9px 15px}
  .sp-row+.sp-row{border-top:1px solid rgba(255,255,255,.05)}
  .sp-row-ic{flex:0 0 32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;
    font-size:15px;background:color-mix(in srgb,var(--c) 14%,transparent);border:1px solid color-mix(in srgb,var(--c) 32%,transparent)}
  .sp-row-m{flex:1;min-width:0}
  .sp-row-n{font-family:'Rajdhani',sans-serif;font-weight:700;font-size:13.5px;color:#eaf0fa;line-height:1.2}
  .sp-row-s{font-size:11px;color:#7e90a6;line-height:1.3;margin-top:1px}
  .sp-row-v{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px 9px;max-width:47%;
    font-family:'Rajdhani',sans-serif;font-weight:700;font-size:11.5px;text-align:right}
  `;
  document.head.appendChild(css);

  window.SHIPPANELS = { mount, bonuses, sources };
})();
