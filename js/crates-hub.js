/* =============================================================================
   crates-hub.js — CRATES: one screen, three crate systems
   ---------------------------------------------------------------------------
   Galaxy Supply, Shipworks part crates and the new Nanocore Crate used to be
   three unrelated Command entries. They are now ONE surface with a sub-tab
   strip: NANOCORE · SUPPLY · SHIP PARTS.

   The strip is INSERTED INTO EACH SCREEN'S HEAD rather than wrapping the three
   bodies in a new container. That matters: `.scr-head` is the one part of a
   screen no renderer ever overwrites, so the tabs survive every re-render of
   Shipworks and Galaxy Supply without this module hooking their code, and both
   screens keep their own lock veil, their own gate and their own coach targets
   exactly as they were. Three screens that READ as one, with nothing rewired
   underneath.

   Level gates mirror the LOCKS table in game.html — they used to be enforced by
   the Command cards those two screens no longer have, so the strip enforces
   them here, on the chip, with the level showing.
   -------------------------------------------------------------------------- */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const lvl = () => { try { return (window.GAME && window.GAME.state.level) | 0 || 1; } catch (e) { return 1; } };
  const toast = (m, c) => { try { window.SOCIAL.toast(m, c || '#c9a0ff'); } catch (e) {} };

  const TABS = [
    { id: 'crates',    label: 'NANOCORE',   ic: '◈', col: '#c9a0ff', lv: 50, sub: 'Nanocore Crate · one core per open' },
    { id: 'boxes',     label: 'SUPPLY',     ic: '▣', col: '#5fd1ff', lv: 30, sub: 'Galaxy Supply · buy the tier you want' },
    { id: 'shipworks', label: 'SHIP PARTS', ic: '⬢', col: '#f2b24b', lv: 20, sub: 'Shipworks · part crates & assembly' },
  ];
  const BY = {}; TABS.forEach((t) => { BY[t.id] = t; });

  function ensureStrips() {
    TABS.forEach((t) => {
      const scr = $('screen-' + t.id); if (!scr) return;
      const head = scr.querySelector('.scr-head'); if (!head) return;
      if (head.querySelector('.ch-tabs')) return;
      const wrap = document.createElement('div');
      wrap.className = 'ch-tabs';
      wrap.innerHTML = TABS.map((x) =>
        '<button class="ch-tab" data-chtab="' + x.id + '" style="--c:' + x.col + '">' +
        '<i>' + x.ic + '</i><span>' + x.label + '</span><em></em></button>').join('');
      head.appendChild(wrap);
      wrap.querySelectorAll('[data-chtab]').forEach((b) => b.addEventListener('click', () => {
        const to = BY[b.dataset.chtab];
        if (!to || locked(to)) { toast('🔒 ' + to.label + ' opens at Level ' + to.lv); return; }
        open(to.id);
      }));
    });
  }
  function locked(t) {
    if (t.id === 'crates') { try { return !window.NANO.unlocked(); } catch (e) { return true; } }
    return lvl() < t.lv;
  }
  // Called by the router every time one of the three screens opens.
  function sync(active) {
    ensureStrips();
    TABS.forEach((t) => {
      const scr = $('screen-' + t.id); if (!scr) return;
      scr.querySelectorAll('.ch-tab').forEach((b) => {
        const x = BY[b.dataset.chtab]; if (!x) return;
        const lk = locked(x);
        b.classList.toggle('on', x.id === active);
        b.classList.toggle('lk', lk);
        const em = b.querySelector('em'); if (em) em.textContent = lk ? 'LV ' + x.lv : '';
      });
    });
    const t = BY[active];
    if (t && t.id === 'crates') { const s = $('crates-sub'); if (s) s.textContent = t.sub; }
  }
  function open(id) {
    const t = BY[id] || TABS[0];
    if (window.UI && window.UI.showScreen) window.UI.showScreen(t.id);
  }
  // The NANOCORE tab is this module's own screen body.
  function render() {
    const body = $('crates-body'); if (!body) return;
    if (!window.NANOUI) return;
    body.innerHTML = window.NANOUI.crateTab();
    window.NANOUI.wireCrate(body);
    sync('crates');
  }

  const css = `
  /* only the three crate screens wrap their head — every other screen's head
     keeps its single-row layout exactly as it was */
  #screen-crates .scr-head,#screen-boxes .scr-head,#screen-shipworks .scr-head{flex-wrap:wrap}
  .ch-tabs{flex:1 0 100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:9px}
  .ch-tab{min-width:0;min-height:44px;display:flex;align-items:center;justify-content:center;gap:6px;padding:6px 8px;border-radius:9px;
    border:1px solid #2a3650;background:#111a27;color:#93a2ba;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:10.5px;
    letter-spacing:.07em;cursor:pointer;overflow:hidden}
  .ch-tab i{font-style:normal;font-size:12px;line-height:1;color:var(--c);opacity:.85;flex:none}
  .ch-tab span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ch-tab em{font-style:normal;font-size:9px;font-weight:800;letter-spacing:.06em;color:#f2b24b;flex:none}
  .ch-tab.on{border-color:var(--c);color:#eaf2fb;background:linear-gradient(180deg,color-mix(in srgb,var(--c) 16%,transparent),transparent);
    box-shadow:0 0 14px -6px var(--c)}
  .ch-tab.on i{opacity:1}
  .ch-tab.lk{opacity:.65}
  .ch-tab.lk i{filter:grayscale(1)}
  @media (max-width:380px){.ch-tab{font-size:9.5px;letter-spacing:.03em;gap:4px}}
  `;
  (function inject() {
    const s = document.createElement('style'); s.id = 'ch-css'; s.textContent = css;
    document.head.appendChild(s);
  })();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureStrips);
  else ensureStrips();

  window.CRATES = { TABS, render, sync, open, ensureStrips };
})();
