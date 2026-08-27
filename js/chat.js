/* =============================================================================
   chat.js — GLOBAL CHAT (build 728)
   ---------------------------------------------------------------------------
   A NON-MODAL DOCK, not a screen. In an idle game the value of a global room is
   that you read it WHILE you grind; a full-screen overlay would make the player
   choose between playing and talking, and draw() early-returns behind overlays
   so the arena would stop painting entirely. The dock floats over the arena, the
   nav stays reachable, and the sim is untouched.

   ZERO SAVE FOOTPRINT — deliberately. Nothing here writes to `state`, so chat
   can never corrupt, fork or lose a save; it needs no migration, no saveWeight()
   term and no mergeSaves() union block. The only local values are DEVICE
   preferences (last-read marker, dock open) in localStorage, which is correct:
   what you have already read on your phone is not an account fact.
   Mutes DO belong to the account, so they live server-side and roam.

   THE CLIENT IS NOT A TRUST BOUNDARY. Every limit is enforced in chat_post();
   the copy of the rules held here exists only so the composer can STATE them
   before the player types. See supabase/global-chat.sql.
   ========================================================================== */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const C = () => window.CLOUD;
  const G = () => window.GAME;

  const LS_READ = 'lf_gc_read';        // highest message id this DEVICE has seen
  const LS_OPEN = 'lf_gc_open';        // dock left open (restored on wide screens)
  const MAX_ROWS = 150;                // rendered ceiling — chat is not history
  const CONV_MS = 45000;               // convergence pull; realtime alone can miss

  let _mounted = false, _open = false, _off = false, _booted = false;
  let _msgs = [], _ids = new Set(), _cursor = 0, _mutes = new Set();
  let _gate = null, _online = 0, _live = false;
  let _chan = null, _convIv = 0, _cdIv = 0, _cdLeft = 0, _pendN = 0, _sending = false;
  let _atBottom = true, _newBelow = 0;

  // ONE notion of "wide": 620px, the same breakpoint css/chat.css switches the
  // dock from a bottom sheet to a right column at. Three separate 760s here meant
  // the keyboard lift, the autofocus and the restore-on-load each disagreed with
  // the layout between 620 and 760.
  const WIDE = '(min-width:620px)';
  const wide = () => { try { return window.matchMedia(WIDE).matches; } catch (e) { return false; } };

  const ICON =
'<svg class="gc-ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 9 9 0 0 1-3.8-.8L3 21l1.9-5.2a8.1 8.1 0 0 1-.9-3.7A8.4 8.4 0 0 1 12.5 4 8.4 8.4 0 0 1 21 11.5z"/></svg>';

  const esc = (s) => String(s == null ? '' : s).replace(/[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => Math.floor(Number(v) || 0);
  const fmt = (n) => { try { return G().formatNum(Math.floor(n)); } catch (e) { return String(Math.floor(Number(n) || 0)); } };
  function toast(t, c) { try { if (window.UI && UI.toast) return UI.toast(t, c); if (window.UI && UI.unlockToast) return UI.unlockToast(t); } catch (e) {} }
  function signedIn() { try { const s = window.ACCOUNT && ACCOUNT.session && ACCOUNT.session(); return !!(s && s.id && C() && C().enabled && C().client); } catch (e) { return false; } }
  function myUid() { try { const s = window.ACCOUNT && ACCOUNT.session && ACCOUNT.session(); return (s && s.id) || null; } catch (e) { return null; } }
  async function rpc(name, args) { const { data, error } = await C().client.rpc(name, args || {}); if (error) throw error; return data; }
  // same shape test the ladders use — ask the SERVER whether the migration ran
  function isMissing(err) {
    const m = ((err && (err.message || err.details || err.code)) || '') + '';
    return /does not exist|not find|schema cache|PGRST202|42883|42P01/i.test(m);
  }
  // ONLY A DELIBERATE raise exception REACHES THE PLAYER. Those arrive as
  // SQLSTATE P0001 (raise_exception); anything else is a coding or schema fault
  // whose text is developer information — "column reference "pat" is ambiguous"
  // is not a sentence any pilot can act on. The real error goes to the console.
  function errText(e) {
    const code = ((e && e.code) || '') + '';
    if (code && code !== 'P0001') {
      try { console.warn('[chat] server error ' + code + ':', (e && e.message) || e); } catch (x) {}
      return 'That didn\u2019t send \u2014 try again in a moment';
    }
    let m = ((e && (e.message || e.details)) || '') + '';
    m = m.replace(/^.*?\b(?:error|exception):\s*/i, '').trim();
    if (!m || /\b(42[0-9A-Z]{3}|22P02|PGRST|syntax|relation|column reference|does not exist)\b/i.test(m)) {
      try { console.warn('[chat] unrecognised server error:', (e && e.message) || e); } catch (x) {}
      return 'That didn\u2019t send \u2014 try again in a moment';
    }
    return m;
  }
  // NEVER print a save key. A ship key that outlives its entry still must not leak.
  function shipName(k) {
    try { return window.CONFIG.SHIP_BY_KEY[k].name; }
    catch (e) { return String(k || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }
  }
  const lastRead = () => { try { return num(localStorage.getItem(LS_READ)); } catch (e) { return 0; } };
  function setLastRead(id) { try { localStorage.setItem(LS_READ, String(Math.max(lastRead(), num(id)))); } catch (e) {} }

  // ===========================================================================
  //  MOUNT — chip into #statusbar, dock into #app
  // ===========================================================================
  function mount() {
    if (_mounted) return true;
    const app = $('app'), sb = $('statusbar');
    if (!app || !sb) return false;
    _mounted = true;

    const chip = document.createElement('button');
    chip.id = 'gc-chip'; chip.type = 'button';
    chip.innerHTML = ICON + '<span class="gc-lbl">CHAT</span><i class="gc-dot"></i><span class="gc-n" id="gc-chip-n">—</span>' +
      '<span class="gc-unread" id="gc-chip-u">0</span>';
    chip.setAttribute('aria-label', 'Global chat');
    const wallet = sb.querySelector('.wallet');
    if (wallet && wallet.parentNode === sb) wallet.insertAdjacentElement('afterend', chip); else sb.appendChild(chip);
    chip.addEventListener('click', toggle);

    const dock = document.createElement('div');
    dock.id = 'gc-dock';
    dock.innerHTML =
      '<div class="gc-head"><span class="gc-title">' + ICON + 'GLOBAL</span>' +
        '<span class="gc-count" id="gc-count"><i class="gc-dot"></i><b>—</b></span>' +
        '<button class="gc-x" id="gc-close" type="button" aria-label="Close chat">\u00d7</button></div>' +
      '<div class="gc-scroll" id="gc-scroll"></div>' +
      '<button class="gc-jump" id="gc-jump" type="button">\u2193 NEW MESSAGES</button>' +
      '<div class="gc-foot"><div class="gc-note" id="gc-note"></div>' +
        '<form class="gc-form" id="gc-form" autocomplete="off"><input class="gc-in" id="gc-in" type="text" ' +
        'placeholder="Say something\u2026" maxlength="180" enterkeyhint="send" autocomplete="off" ' +
        'autocapitalize="sentences" spellcheck="false">' +
        '<span class="gc-left" id="gc-left"></span>' +
        '<button class="gc-send" id="gc-send" type="submit">SEND</button></form></div>';
    app.appendChild(dock);

    $('gc-close').addEventListener('click', close);
    $('gc-jump').addEventListener('click', () => scrollBottom());
    $('gc-form').addEventListener('submit', send);
    const sc = $('gc-scroll');
    sc.addEventListener('scroll', onScroll, { passive: true });
    sc.addEventListener('click', onListClick);
    const inp = $('gc-in');
    // the game binds its own key handlers — typing must never reach them
    ['keydown', 'keypress', 'keyup'].forEach((ev) => inp.addEventListener(ev, (e) => {
      e.stopPropagation();
      if (ev === 'keydown' && e.key === 'Escape') { e.preventDefault(); close(); }
    }));
    inp.addEventListener('input', paintLeft);

    sizeToNav();
    try { new ResizeObserver(sizeToNav).observe($('nav')); } catch (e) { window.addEventListener('resize', sizeToNav); }
    try { new ResizeObserver(sizeToNav).observe($('hud')); } catch (e) {}
    // the composer grows a note line whenever there is a rule to state, so the
    // "new messages" pill has to know the footer's real height
    try { new ResizeObserver(() => {
      const f = dock.querySelector('.gc-foot');
      if (f) dock.style.setProperty('--gc-foot', Math.round(f.offsetHeight) + 'px');
    }).observe(dock.querySelector('.gc-foot')); } catch (e) {}
    // #screen-battle never carries .active — the battle screen IS "no overlay
    // active" — so the lift is recomputed whenever any screen's class changes
    try {
      const scr = $('screens');
      if (scr) new MutationObserver(sizeToNav).observe(scr, { subtree: true, attributes: true, attributeFilter: ['class'] });
    } catch (e) {}
    try {
      const lg = $('login');
      if (lg) new MutationObserver(applyGate).observe(lg, { attributes: true, attributeFilter: ['style', 'class'] });
    } catch (e) {}
    watchCoach();
    kbWatch();
    return true;
  }

  // #coach-layer is appended to document.body the first time a tip fires, so at
  // mount there is usually nothing to observe. Wait for it once, then watch its
  // display. Without this the gate was only re-evaluated by luck — open() refused
  // correctly but the chip stayed on screen through the whole tutorial.
  function watchCoach() {
    const attach = (co) => {
      try { new MutationObserver(applyGate).observe(co, { attributes: true, attributeFilter: ['style', 'class'] }); } catch (e) {}
      applyGate();
    };
    const existing = $('coach-layer');
    if (existing) return attach(existing);
    try {
      const mo = new MutationObserver(() => {
        const co = $('coach-layer');
        if (co) { mo.disconnect(); attach(co); }
      });
      mo.observe(document.body, { childList: true });
    } catch (e) {}
  }

  // The footer's height changes whenever the note line appears or disappears, so
  // it is set THERE rather than left to a ResizeObserver that may not have fired
  // before first paint. Without a value the pill falls back to 66px against a
  // real 77px footer and sits on the note — the exact collision --gc-foot exists
  // to prevent. The observer in mount() stays as a backstop for reflow.
  function syncFoot() {
    const dock = $('gc-dock'); if (!dock) return;
    const f = dock.querySelector('.gc-foot');
    if (f && f.offsetHeight) dock.style.setProperty('--gc-foot', Math.round(f.offsetHeight) + 'px');
  }

  function sizeToNav() {
    const app = $('app'), nav = $('nav'), dock = $('gc-dock'); if (!app) return;
    app.style.setProperty('--gc-nav', ((nav && nav.offsetHeight) || 60) + 'px');
    // top chrome is MEASURED: the HUD drops .hud-bars in landscape, and web-v89
    // changes the status row's padding by breakpoint, so neither is a constant.
    //
    // ON A SHORT WINDOW THE PANEL WINS OVER THE HUD. Reserving statusbar + HUD +
    // nav + a lift over the battle controls on a 450px-tall landscape window left
    // a 56px message list — one line, which is not a chat. There is no
    // arrangement that fits all of it, so the order is: nav and the composer are
    // untouchable, then a readable list, then the HUD, then the battle controls.
    // Everything the dock covers is one tap from being uncovered.
    const sb = $('statusbar'), hud = $('hud');
    const sbH = (sb && sb.offsetHeight) || 44;
    const short = app.clientHeight < 520;
    const top = short ? sbH : sbH + ((hud && hud.offsetHeight) || 96);
    app.style.setProperty('--gc-top', Math.round(top) + 'px');
    if (!dock) return;
    // On the battle screen the arena's bottom strip is #battle-controls (Bail,
    // AUTO, speed). Lift the dock clear of it so opening chat never takes the
    // player's controls away — but only when the height is genuinely spare.
    const onBattle = !document.querySelector('#screens .screen.overlay.active');
    let lift = 0;
    if (onBattle && !short) {
      const bc = $('battle-controls');
      const h = (bc && bc.offsetHeight) || 0;
      // What the dock would be left with AFTER lifting. The list is worth more
      // than the clearance: header + composer are 126px, so a dock under ~260px
      // is a three-line room. This subtraction has to include the nav and the
      // 16px of margins — leaving them out lifted 97px on a 540px-tall window
      // and squeezed the list to 78px.
      const leftOver = app.clientHeight - top - ((nav && nav.offsetHeight) || 60) - 16 - (h + 6);
      lift = leftOver >= 260 ? h + 6 : 0;   // clear them properly or not at all
    }
    dock.style.setProperty('--gc-lift', Math.round(lift) + 'px');
  }
  // the on-screen keyboard covers a bottom sheet; lift it by the real overlap
  function kbWatch() {
    const vv = window.visualViewport; if (!vv) return;
    const on = () => {
      const dock = $('gc-dock'); if (!dock) return;
      const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      if (overlap > 90 && !wide()) {
        dock.style.setProperty('--gc-kb', Math.round(overlap) + 'px');
        dock.classList.add('kb');
      } else dock.classList.remove('kb');
    };
    vv.addEventListener('resize', on); vv.addEventListener('scroll', on);
  }

  // ===========================================================================
  //  OPEN / CLOSE
  // ===========================================================================
  // The auth gate and the forced-update veil outrank chat completely: both are
  // children of #app that the dock's z-index sits above, and a chat panel in
  // front of a login form is an obstacle in front of the only thing the player
  // can usefully do. Reachable by signing out mid-session, not just at boot.
  function gated() {
    try {
      const lg = $('login');
      if (lg && getComputedStyle(lg).display !== 'none') return true;
      if (document.querySelector('.uv-wrap')) return true;
      // the onboarding coach dims the screen to teach one control at a time
      // (#coach-layer, z-index 320, display:none when idle). A chat chip in the
      // status bar during it is noise, and posting is gated until Level 5 anyway.
      const co = $('coach-layer');
      if (co && getComputedStyle(co).display !== 'none') return true;
    } catch (e) {}
    return false;
  }
  let _gateIv = 0;
  function applyGate() {
    const g = gated();
    if (g && _open) close(); else paintChip();
    // #coach-layer is created lazily and toggled by inline display, so there is
    // nothing stable to observe until it exists. Watch cheaply, and only while
    // actually gated — the interval cancels itself.
    if (g && !_gateIv) {
      _gateIv = setInterval(() => {
        if (!gated()) { clearInterval(_gateIv); _gateIv = 0; paintChip(); }
      }, 1000);
    }
  }

  function open() {
    if (gated()) return;
    if (!mount()) return;
    _open = true;
    $('gc-dock').classList.add('open');
    $('gc-chip').classList.add('open');
    try { localStorage.setItem(LS_OPEN, '1'); } catch (e) {}
    render(); scrollBottom(); markRead(); paintChip();
    sizeToNav(); syncFoot();
    // fonts and the note line can reflow the list a frame later
    requestAnimationFrame(() => { if (_open) { syncFoot(); scrollBottom(); } });
    refreshGate(); pull();
    // never yank the keyboard up on touch — the player opened a room to read it
    if (wide() && !('ontouchstart' in window)) {
      try { $('gc-in').focus({ preventScroll: true }); } catch (e) {}
    }
  }
  function close() {
    _open = false;
    const d = $('gc-dock'); if (d) { d.classList.remove('open'); d.classList.remove('kb'); }
    const c = $('gc-chip'); if (c) c.classList.remove('open');
    try { localStorage.setItem(LS_OPEN, '0'); } catch (e) {}
    try { $('gc-in').blur(); } catch (e) {}
    paintChip();
  }
  function toggle() { _open ? close() : open(); }
  function markRead() { if (_cursor) setLastRead(_cursor); }

  // ===========================================================================
  //  DATA
  // ===========================================================================
  function goOffline(why) {
    if (_off) return;
    _off = true;
    // THE FILENAME GOES TO THE CONSOLE, NEVER TO THE PLAYER.
    try { console.warn('[chat] global chat RPCs are not installed — run supabase/global-chat.sql' + (why ? ' (' + why + ')' : '')); } catch (e) {}
    if (_convIv) { clearInterval(_convIv); _convIv = 0; }
    if (_chan) { try { C().client.removeChannel(_chan); } catch (e) {} _chan = null; }
    // don't advertise a feature that cannot work; a dock already open stays open
    // and says so rather than vanishing mid-read
    const c = $('gc-chip'); if (c && !_open) c.classList.remove('on');
    render(); paintNote();
  }

  async function loadMutes() {
    try {
      const rows = await rpc('chat_mute_list');
      _mutes = new Set((rows || []).map((r) => (r && r.muted) || r));
    } catch (e) { if (isMissing(e)) goOffline('mute_list'); }
  }

  async function pull() {
    if (_off || !signedIn()) return;
    try {
      const rows = await rpc('chat_pull', { p_after: _cursor, p_limit: 80 });
      if (rows && rows.length) ingest(rows);
    } catch (e) { if (isMissing(e)) goOffline('pull'); }
  }

  // chat_pull answers NEWEST-FIRST. The cursor is max(id) of what actually
  // arrived — never a position in the array. Reading a page oldest-first and
  // taking its last row is how the war feed pinned its cursor at the page size
  // and froze for four days.
  function ingest(rows) {
    const me = myUid(), add = [];
    for (const r of (rows || [])) {
      const id = num(r && r.id); if (!id) continue;
      if (id > _cursor) _cursor = id;
      if (_ids.has(id)) continue;
      if (r.hidden) continue;
      if (r.user_id && _mutes.has(r.user_id)) continue;
      _ids.add(id);
      add.push({ id: id, user_id: r.user_id || null, name: r.name || '', lvl: num(r.lvl), tag: r.tag || '', kind: r.kind || 'chat', txt: r.txt || '', created_at: r.created_at });
    }
    if (!add.length) return;

    const solid = _msgs.filter((m) => !m.pending);
    const pend = _msgs.filter((m) => m.pending);
    const highest = solid.length ? solid[solid.length - 1].id : 0;
    const appendOnly = add.every((m) => m.id > highest) && !pend.length;

    add.sort((a, b) => a.id - b.id);
    _msgs = solid.concat(add).sort((a, b) => a.id - b.id);
    while (_msgs.length > MAX_ROWS) _msgs.shift();
    _msgs = _msgs.concat(pend);
    // _ids is the dedupe set, not a history. Trimmed messages sit below _cursor,
    // so chat_pull can never return them again and rebuilding cannot resurrect one.
    if (_ids.size > 4000) _ids = new Set(_msgs.filter((m) => !m.pending).map((m) => m.id));

    if (_open) {
      const wasBottom = _atBottom;
      if (appendOnly) { for (const m of add) appendRow(m); trimDom(); }
      else render();
      if (wasBottom) scrollBottom();
      else { _newBelow += add.filter((m) => m.user_id !== me).length; if (_newBelow) $('gc-jump').classList.add('on'); }
      markRead();
    }
    paintChip();
  }

  function removeId(id) {
    id = num(id);
    if (!_ids.has(id)) return;
    _ids.delete(id);
    _msgs = _msgs.filter((m) => m.id !== id);
    if (_open) render();
    paintChip();
  }

  function subscribe() {
    const cl = C() && C().client; if (!cl || _off) return;
    try {
      if (_chan) { try { cl.removeChannel(_chan); } catch (e) {} _chan = null; }
      // presence key = account id, so two tabs of one pilot count once — which is
      // what "pilots online" should mean
      const key = myUid() || ('anon-' + Math.random().toString(36).slice(2));
      _chan = cl.channel('lf-chat', { config: { presence: { key: key } } })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (p) => {
          const r = p && p.new; if (!r) return;
          if (r.chan && r.chan !== 'global') return;
          ingest([r]);
        })
        // a moderator hiding a message should retract it live, not on next reload
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, (p) => {
          const r = p && p.new; if (r && r.hidden) removeId(r.id);
        })
        .on('presence', { event: 'sync' }, () => {
          try { _online = Object.keys(_chan.presenceState() || {}).length; } catch (e) { _online = 0; }
          paintCounts();
        })
        .subscribe((st) => {
          if (st === 'SUBSCRIBED') { _live = true; try { _chan.track({ at: Date.now() }); } catch (e) {} }
          else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') { _live = false; _online = 0; }
          paintCounts();
        });
    } catch (e) {}
  }

  async function refreshGate() {
    if (_off || !signedIn()) { paintNote(); return; }
    try { _gate = await rpc('chat_gate'); }
    catch (e) { if (isMissing(e)) return goOffline('gate'); _gate = null; }
    if (_gate && num(_gate.wait) > 0) startCooldown(num(_gate.wait));
    paintNote(); paintLeft();
  }

  // ===========================================================================
  //  RENDER
  // ===========================================================================
  const timeOf = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
  const dayOf = (iso) => { try { return new Date(iso).toDateString(); } catch (e) { return ''; } };

  function rowHtml(m, prev) {
    const me = myUid();
    const sys = m.kind === 'sys';
    let out = '';
    if (!m.pending && prev && !prev.pending && dayOf(prev.created_at) !== dayOf(m.created_at)) {
      const d = new Date(m.created_at);
      out += '<div class="gc-day">' + esc(d.toLocaleDateString([], { month: 'short', day: 'numeric' })) + '</div>';
    }
    const cont = !sys && prev && prev.kind !== 'sys' && prev.user_id && m.user_id &&
      prev.user_id === m.user_id && Math.abs(new Date(m.created_at) - new Date(prev.created_at)) < 240000;
    const cls = 'gc-msg' + (sys ? ' sys' : '') + (cont ? ' cont' : '') +
      (!sys && m.user_id && m.user_id === me ? ' mine' : '') + (m.pending ? ' pending' : '');
    out += '<div class="' + cls + '" data-mid="' + esc(m.id) + '">' +
      '<div class="gc-who">' +
        (m.tag ? '<span class="gc-tag">' + esc(m.tag) + '</span>' : '') +
        (sys
          ? '<span class="gc-nm">' + esc(m.name || 'FLEET COMMAND') + '</span>'
          : '<button class="gc-nm" type="button"' + (m.user_id ? ' data-who="' + esc(m.user_id) + '"' : '') + '>' + esc(m.name || 'Pilot') + '</button>') +
        (!sys && m.lvl ? '<span class="gc-lv">Lv ' + esc(m.lvl) + '</span>' : '') +
        '<span class="gc-t">' + (m.pending ? 'sending' : esc(timeOf(m.created_at))) + '</span>' +
        (!sys && !m.pending && m.user_id && m.user_id !== me
          ? '<button class="gc-flag" type="button" data-flag="' + esc(m.id) + '" aria-label="Report message">\u2691</button>' : '') +
      '</div>' +
      '<div class="gc-txt">' + esc(m.txt) + '</div></div>';
    return out;
  }

  function render() {
    const sc = $('gc-scroll'); if (!sc) return;
    if (_off) {
      sc.innerHTML = '<div class="gc-empty"><b>CHAT IS NOT LIVE</b>Global chat isn\u2019t switched on for this server yet. Everything else works normally.</div>';
      return;
    }
    if (!signedIn()) {
      sc.innerHTML = '<div class="gc-empty"><b>GLOBAL CHAT</b>Talk to every pilot on the server. You need a free account to read and post.' +
        '<button class="gc-btn gold" id="gc-signin" type="button">Create account / Log in</button></div>';
      const b = $('gc-signin');
      if (b) b.addEventListener('click', () => { try { if (window.UI && UI.openAccountSheet) return UI.openAccountSheet(); } catch (e) {} location.reload(); });
      return;
    }
    const vis = _msgs;
    if (!vis.length) {
      // If a room can be empty, say it is empty. Never pad it.
      sc.innerHTML = '<div class="gc-empty"><b>NOTHING SAID YET</b>The room is quiet. Say the first thing.</div>';
      return;
    }
    sc.innerHTML = vis.map((m, i) => rowHtml(m, vis[i - 1])).join('');
  }

  function appendRow(m) {
    const sc = $('gc-scroll'); if (!sc) return;
    if (sc.querySelector('.gc-empty')) { render(); return; }
    const i = _msgs.indexOf(m);
    sc.insertAdjacentHTML('beforeend', rowHtml(m, i > 0 ? _msgs[i - 1] : null));
  }
  function trimDom() {
    const sc = $('gc-scroll'); if (!sc) return;
    while (sc.children.length > MAX_ROWS + 12) sc.removeChild(sc.firstElementChild);
  }
  function onScroll() {
    const sc = $('gc-scroll'); if (!sc) return;
    _atBottom = (sc.scrollHeight - sc.scrollTop - sc.clientHeight) < 44;
    if (_atBottom) { _newBelow = 0; const j = $('gc-jump'); if (j) j.classList.remove('on'); markRead(); }
  }
  function scrollBottom() {
    const sc = $('gc-scroll'); if (!sc) return;
    sc.scrollTop = sc.scrollHeight;           // never scrollIntoView
    _atBottom = true; _newBelow = 0;
    const j = $('gc-jump'); if (j) j.classList.remove('on');
  }

  function paintCounts() {
    const chip = $('gc-chip'), n = $('gc-chip-n'), cnt = $('gc-count');
    // an unknown count is shown as unknown — never a fabricated number
    const txt = _live && _online > 0 ? String(_online) : '\u2014';
    if (n) n.textContent = txt;
    if (chip) chip.classList.toggle('live', !!_live && _online > 0);
    if (cnt) { cnt.classList.toggle('live', !!_live && _online > 0); cnt.querySelector('b').textContent = _live && _online > 0 ? _online + ' ONLINE' : 'CONNECTING'; }
  }
  function paintChip() {
    const chip = $('gc-chip'); if (!chip) return;
    const g = gated();
    chip.classList.toggle('gated', g);
    if (!_off && !g) chip.classList.add('on');
    const u = _open ? 0 : unreadCount();
    chip.classList.toggle('unread', u > 0);
    const el = $('gc-chip-u'); if (el) el.textContent = u > 99 ? '99+' : String(u);
    paintCounts();
  }
  function unreadCount() {
    const lr = lastRead(), me = myUid(); let n = 0;
    for (const m of _msgs) { if (!m.pending && m.id > lr && m.user_id !== me) n++; }
    return n;
  }

  // THE RULE IS PRINTED, NEVER HOVERED. Half the player base is on touch and can
  // never see a title attribute; the first thing they'd know of a gate is being
  // refused by it.
  function paintNote() {
    const note = $('gc-note'), inp = $('gc-in'), btn = $('gc-send');
    if (!note || !inp || !btn) return;
    const dis = (msg, bad) => { note.className = 'gc-note' + (bad ? ' bad' : ''); note.innerHTML = msg; inp.disabled = true; btn.disabled = true; syncFoot(); };
    if (_off) return dis('Global chat isn\u2019t switched on for this server yet.');
    if (!signedIn()) return dis('<b>A free account</b> is needed to read and post here.');
    const g = _gate;
    if (!g) { note.className = 'gc-note'; note.innerHTML = ''; inp.disabled = false; btn.disabled = _cdLeft > 0; return; }
    if (g.why === 'banned') {
      const until = g.until ? new Date(g.until) : null;
      return dis('You can\u2019t post in global chat' +
        (until ? ' until <b>' + esc(until.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })) + '</b>' : '') +
        (g.reason ? ' \u2014 ' + esc(g.reason) : '') + '. You can still read.', true);
    }
    if (g.why === 'norecord') {
      return dis('Global chat unlocks at <b>Level ' + num(g.min_level) + '</b>. Your pilot record reaches the server after your next battle.');
    }
    if (g.why === 'level') {
      return dis('Global chat unlocks at <b>Level ' + num(g.min_level) + '</b> \u2014 you\u2019re Level ' + num(g.level) + '. Reading is open now.');
    }
    inp.disabled = false;
    btn.disabled = _cdLeft > 0 || _sending;
    note.className = 'gc-note';
    const used = num(g.hour_used), cap = num(g.hour_max), slow = num(g.slow);
    if (cap && used >= cap * 0.8) note.innerHTML = 'You\u2019ve sent <b>' + used + ' of ' + cap + '</b> messages this hour.';
    else if (slow > 0) note.innerHTML = 'Slow mode is on \u2014 <b>one message every ' + slow + 's</b>.';
    else note.innerHTML = '';
    inp.setAttribute('maxlength', String(num(g.max_len) || 180));
    syncFoot();
  }
  function paintLeft() {
    const inp = $('gc-in'), left = $('gc-left'); if (!inp || !left) return;
    const cap = num(inp.getAttribute('maxlength')) || 180;
    const rem = cap - (inp.value || '').length;
    left.textContent = rem <= 40 ? String(rem) : '';
    left.classList.toggle('warn', rem <= 12);
  }
  function startCooldown(sec) {
    _cdLeft = Math.max(0, Math.ceil(Number(sec) || 0));
    const btn = $('gc-send');
    if (_cdIv) { clearInterval(_cdIv); _cdIv = 0; }
    const tick = () => {
      if (!btn) return;
      if (_cdLeft > 0) { btn.disabled = true; btn.textContent = _cdLeft + 's'; }
      else { btn.textContent = 'SEND'; btn.disabled = _sending; clearInterval(_cdIv); _cdIv = 0; paintNote(); }
    };
    tick();
    if (_cdLeft > 0) _cdIv = setInterval(() => { _cdLeft--; tick(); }, 1000);
  }

  // ===========================================================================
  //  SEND
  // ===========================================================================
  async function send(e) {
    if (e) e.preventDefault();
    if (_sending || _cdLeft > 0 || _off || !signedIn()) return;     // fires-twice guard
    const inp = $('gc-in'); if (!inp || inp.disabled) return;
    const raw = (inp.value || '').trim();
    if (!raw) return;

    _sending = true;
    const btn = $('gc-send'); if (btn) btn.disabled = true;
    const tmp = { id: 'p' + (++_pendN), user_id: myUid(), name: 'You', lvl: 0, tag: '',
                  kind: 'chat', txt: raw, created_at: new Date().toISOString(), pending: true };
    _msgs.push(tmp); appendRow(tmp); scrollBottom();
    inp.value = ''; paintLeft();

    try {
      const row = await rpc('chat_post', { p_txt: raw });
      dropPending(tmp);
      if (row) ingest([row]);
      startCooldown(num(_gate && _gate.cool) || 4);
    } catch (err) {
      dropPending(tmp);
      if (isMissing(err)) goOffline('post');
      else {
        // hand the words back — never make the player retype what we refused
        inp.value = raw; paintLeft();
        toast(errText(err), '#ff8f9d');
      }
    }
    _sending = false;
    if (btn && _cdLeft <= 0) btn.disabled = false;
    refreshGate();
  }
  function dropPending(tmp) {
    const i = _msgs.indexOf(tmp); if (i >= 0) _msgs.splice(i, 1);
    const sc = $('gc-scroll'); if (!sc) return;
    const el = sc.querySelector('[data-mid="' + tmp.id + '"]'); if (el) el.remove();
    if (!_msgs.length) render();
  }

  // ===========================================================================
  //  PILOT CARD / REPORT
  // ===========================================================================
  function onListClick(e) {
    const who = e.target.closest('[data-who]');
    if (who) return card(who.getAttribute('data-who'));
    const flag = e.target.closest('[data-flag]');
    if (flag) return reportSheet(num(flag.getAttribute('data-flag')));
  }

  function veil(html) {
    const old = $('gc-card'); if (old) old.remove();
    const app = $('app') || document.body;
    const v = document.createElement('div'); v.id = 'gc-card';
    v.innerHTML = '<div class="gc-cd">' + html + '</div>';
    v.addEventListener('click', (ev) => { if (ev.target === v) v.remove(); });
    app.appendChild(v);
    return v;
  }

  async function card(uid) {
    if (!uid || _off) return;
    let w = null;
    try { w = await rpc('chat_who', { p_uid: uid }); }
    catch (err) { if (isMissing(err)) return goOffline('who'); }
    if (!w) return toast('That pilot has no public record yet', '#ffcf7a');
    const on = w.last_seen && (Date.now() - new Date(w.last_seen).getTime()) < 6e5;
    const fleet = Array.isArray(w.fleet) ? w.fleet : [];
    const ships = fleet.slice(0, 5).map((k) =>
      '<img src="ships/ship-' + esc(k) + '.png" alt="' + esc(shipName(k)) + '" decoding="async" onerror="this.remove()">').join('');
    const v = veil(
      '<h3>' + esc(w.name || 'Pilot') + (w.tag ? '<span class="gc-tag">' + esc(w.tag) + '</span>' : '') +
        (on ? '<span class="gc-cd-on">\u25cf online</span>' : '') + '</h3>' +
      '<div class="gc-cd-ships">' + ships + '</div>' +
      '<div class="gc-cd-stats"><span>LEVEL<b>' + num(w.level) + '</b></span>' +
        '<span>ZONE<b>' + num(w.zone) + '</b></span>' +
        '<span>POWER<b>' + esc(fmt(w.power)) + '</b></span></div>' +
      '<div class="gc-cd-btns">' +
        '<button class="gc-btn gold" data-friend type="button">+ Add friend</button>' +
        '<button class="gc-btn' + (w.muted ? '' : ' bad') + '" data-mute type="button">' + (w.muted ? 'Unmute' : 'Mute') + '</button>' +
        '<button class="gc-btn" data-x type="button">Close</button></div>');
    v.querySelector('[data-x]').addEventListener('click', () => v.remove());
    const fb = v.querySelector('[data-friend]');
    fb.addEventListener('click', async () => {
      fb.disabled = true; fb.textContent = '\u2026';
      try { await rpc('friend_request', { p_target: uid }); toast('Friend request sent', '#7ce0a0'); v.remove(); }
      catch (err) { toast(errText(err), '#ff8f9d'); fb.disabled = false; fb.textContent = '+ Add friend'; }
    });
    const mb = v.querySelector('[data-mute]');
    mb.addEventListener('click', async () => {
      const turnOn = !w.muted;
      mb.disabled = true;
      try {
        await rpc('chat_mute', { p_target: uid, p_on: turnOn });
        if (turnOn) { _mutes.add(uid); _msgs = _msgs.filter((m) => m.user_id !== uid); if (_open) render(); }
        else _mutes.delete(uid);
        toast(turnOn ? 'Muted \u2014 you won\u2019t see their messages' : 'Unmuted', '#7ce0a0');
        v.remove(); paintChip();
      } catch (err) { toast(errText(err), '#ff8f9d'); mb.disabled = false; }
    });
  }

  function reportSheet(id) {
    const m = _msgs.find((x) => x.id === id); if (!m) return;
    const v = veil('<h3>Report message</h3>' +
      '<div class="gc-cd-q">This goes to the moderators with the message attached. Reporting doesn\u2019t mute \u2014 use the pilot\u2019s name for that.' +
        '<em>' + esc(m.name || 'Pilot') + ': ' + esc(m.txt) + '</em></div>' +
      '<div class="gc-cd-btns"><button class="gc-btn bad" data-go type="button">Report</button>' +
        '<button class="gc-btn" data-x type="button">Cancel</button></div>');
    v.querySelector('[data-x]').addEventListener('click', () => v.remove());
    const go = v.querySelector('[data-go]');
    go.addEventListener('click', async () => {
      go.disabled = true; go.textContent = '\u2026';           // and chat_report is idempotent per (message, reporter)
      try { await rpc('chat_report', { p_msg: id, p_note: '' }); toast('Reported \u2014 thank you', '#7ce0a0'); }
      catch (err) { toast(errText(err), '#ff8f9d'); }
      v.remove();
    });
  }

  // ===========================================================================
  //  BOOT
  // ===========================================================================
  async function boot() {
    if (_booted || !signedIn()) return;
    _booted = true;
    if (!mount()) { _booted = false; return; }
    applyGate();                       // routes through the gate, unlike a bare .on
    await loadMutes();
    if (_off) return;
    await pull();
    subscribe();
    refreshGate();
    paintChip();
    if (!_convIv) _convIv = setInterval(() => { if (!document.hidden) pull(); }, CONV_MS);
    // restore a dock the player left open — desktop only; auto-opening a sheet
    // over a phone's arena on load would be an ambush
    try {
      if (localStorage.getItem(LS_OPEN) === '1' && wide()) open();
    } catch (e) {}
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden || _off) return;
    pull();
    if (_chan) { try { _chan.track({ at: Date.now() }); } catch (e) {} }
  });

  // CLOUD/ACCOUNT come up asynchronously; retry until signed in, then stop asking.
  let _tries = 0;
  const bootIv = setInterval(() => {
    if (_booted || _off) { clearInterval(bootIv); return; }
    if (++_tries > 40) { clearInterval(bootIv); return; }     // ~2 min, then give up quietly
    if (signedIn()) { clearInterval(bootIv); boot(); }
  }, 3000);
  if (document.readyState !== 'loading') setTimeout(boot, 1200);
  else document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1200));

  window.CHAT = {
    open: open, close: close, toggle: toggle,
    resize: sizeToNav,
    refresh: () => { pull(); refreshGate(); },
    offline: () => _off,
    online: () => (_live ? _online : null),
    trace: () => ({ open: _open, off: _off, cursor: _cursor, rows: _msgs.length, live: _live, online: _online, mutes: _mutes.size, gate: _gate }),
  };
})();
