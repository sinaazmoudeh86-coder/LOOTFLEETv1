/* =============================================================================
   fit-audit.js — CLIP AUDITOR (QA tool, dormant by default, zero cost off)
   -----------------------------------------------------------------------------
   Turn on: open the game with ?fitaudit, or set localStorage.lf_fitaudit='1',
   or run FITAUDIT.on() in the console (FITAUDIT.on(true) persists it).
   While on, it rescans the visible screen + sheets every ~1s for boxes whose
   content is genuinely CUT OFF (scroll size exceeds the box behind
   overflow:hidden/clip) and:
     · outlines every offender with a red dashed line
     · shows a counter chip bottom-left — tap it for a console.table listing
   Deliberate patterns are ignored: scrollable panes, single-line ellipsis.
   This is the regression net for the "text/art cut off" class of bug — run it
   on a 360×640 phone and a ~450px-tall landscape window before shipping UI.
   ========================================================================== */
(function () {
  'use strict';
  const FLAG = 'lf_fitaudit';
  let timer = null, marked = [], chip = null, css = null, last = [];
  function ensureUi() {
    if (css) return;
    css = document.createElement('style');
    css.textContent = '.fit-clip{outline:2px dashed #ff3b4e !important;outline-offset:-2px !important}' +
      '#fit-audit-chip{position:fixed;left:10px;bottom:calc(96px + env(safe-area-inset-bottom,0px));z-index:9999;font:800 11px Rajdhani,sans-serif;letter-spacing:.05em;color:#fff;background:#c92338;border:1px solid #ff8290;border-radius:9px;padding:6px 10px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.5)}' +
      '#fit-audit-chip.ok{background:#14532d;border-color:#46d27a}';
    document.head.appendChild(css);
    chip = document.createElement('button');
    chip.id = 'fit-audit-chip';
    chip.type = 'button';
    chip.addEventListener('click', dump);
    document.body.appendChild(chip);
  }
  function path(el) {
    const bits = [];
    for (let n = el, i = 0; n && n !== document.body && i < 5; n = n.parentElement, i++)
      bits.unshift(n.tagName.toLowerCase() + (n.id ? '#' + n.id : (n.classList && n.classList[0]) ? '.' + n.classList[0] : ''));
    return bits.join(' > ');
  }
  function scan() {
    marked.forEach((el) => el.classList.remove('fit-clip'));
    marked = []; last = [];
    const seen = new Set();
    // THE COMMAND SHEET IS A ROOT TOO. It is neither a .scr-body nor a
    // .sheet-body — it is #mega .mega-grid — so the one screen with fourteen
    // stacked cards on a phone was the one screen this auditor never looked at.
    // That is where the clipped Pilot Ascension title lived, unflagged.
    // The Pilot Tree LIST is a scroll root of its own (build 712): it lives inside
    // a deliberate fill pane (.pl-treewrap), so its rows are not children of the
    // .scr-body the auditor walks from, and nothing inside it would be inspected.
    // The Commander picker and the Exchange lists are scroll roots of their own: the
    // picker is a fixed-position sheet outside any .scr-body, and .cmx-list sits
    // inside a flex card. Both overflowed their containers before min-height:0 was
    // set on them, and neither was inside anything this auditor walked.
    // The chat dock's message list is a scroll root of its own (build 728): it is
    // not a .scr-body — the dock lives outside #screens entirely — so nothing
    // inside it would ever be inspected. It is also the one place in the game
    // where the content length is set by OTHER PLAYERS, which is exactly the
    // case worth auditing.
    // TEN MORE ROOTS ADDED (729 audit). The rule this file states — "the auditor
    // only sees the roots it is told about" — had drifted again: a sweep of every
    // `overflow-y:auto` in css/ found ten scroll containers outside the net, and
    // the list below is that sweep's result rather than the roots anyone happened
    // to remember. Worth naming why several of them matter:
    //   .pn-body     the patch-notes card — EVERY player sees it on EVERY new
    //                build, and its length is set by how much shipped
    //   .kov-card    the KOTH arena overlay, which now carries the WHEN KILLS
    //                COUNT card added in 712
    //   .pa-picks    the perk picker behind an IRREVERSIBLE action
    //   .tp-*        the season pass — bought with real money
    //   .gc-cd       the chat pilot card, whose content is another player's name
    //   .death-body  shown at the player's worst moment, listing what they lost
    document.querySelectorAll([
      '.screen.active .scr-body', '.sheet-body', '.mega.open .mega-grid',
      '.screen.active .pl-lrows', '.cmp-list', '.cmx-list', '#gc-dock.open .gc-scroll',
      '.pn-body', '.kov-card', '.pa-picks', '.pa-modal', '.tp-ladder.all', '.tp-modal',
      '.tp-rcpt', '.ex-picklist', '.mn-sheet', '.gc-cd', '.death-body',
    ].join(', ')).forEach((root) => {
      if (seen.has(root)) return; seen.add(root);
      const els = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
      for (const el of els) {
        if (!el.clientWidth && !el.clientHeight) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const hidY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
        const hidX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
        if (!hidX && !hidY) continue;
        const dh = hidY ? el.scrollHeight - el.clientHeight : 0;
        const dw = hidX ? el.scrollWidth - el.clientWidth : 0;
        if (dh < 8 && dw < 8) continue;
        if (dw >= 8 && dh < 8 && cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap') continue;   // deliberate truncation
        el.classList.add('fit-clip');
        marked.push(el);
        last.push({ where: path(el), clippedY: dh >= 8 ? dh + 'px' : '', clippedX: dw >= 8 ? dw + 'px' : '' });
      }
    });
    ensureUi();
    chip.textContent = last.length ? '\u2702 ' + last.length + ' CLIPPED \u2014 tap for list' : '\u2714 NO CLIPPING';
    chip.classList.toggle('ok', !last.length);
  }
  function dump() { console.table(last); }
  function on(persist) {
    if (persist) try { localStorage.setItem(FLAG, '1'); } catch (e) {}
    if (!timer) { timer = setInterval(scan, 1100); try { scan(); } catch (e) {} }
    return 'fit audit ON';
  }
  function off() {
    try { localStorage.removeItem(FLAG); } catch (e) {}
    if (timer) { clearInterval(timer); timer = null; }
    marked.forEach((el) => el.classList.remove('fit-clip')); marked = [];
    if (chip) { chip.remove(); chip = null; }
    if (css) { css.remove(); css = null; }
    return 'fit audit OFF';
  }
  window.FITAUDIT = { on, off, scan };
  let want = false;
  try { want = /[?&]fitaudit/.test(location.search) || localStorage.getItem(FLAG) === '1'; } catch (e) {}
  if (want) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => on()); else on(); }
})();
