/* =============================================================================
   alliance.js — ALLIANCES (Hangar ▸ Social ▸ Alliance) · unlocks at Level 40
   ---------------------------------------------------------------------------
   • FOUND (1B gold) or JOIN an open alliance. Ranks: leader / co-leader /
     elder / member. Elder: kick members + accept requests. Co-Leader: also
     kick elders, promote/demote member↔elder, event signup. Leader: all.
   • DAILY LOOP: one donation (gold or LootCoins → Alliance XP + ⬡ Coins) and
     2 boss attacks (3 with VIP) against the shared, forever-scaling
     HOLLOW ARMADA — ONE mark at a time; each kill pays ⬡ 300 to EVERY member.
   • WEEKLY OPS: 3 seeded missions per member; points stack into one alliance
     score on the server-wide weekly board. Completions also pay personal ◈.
   • FEED: chat + system events (joins, kicks, boss kills, major donations).
   • ALLIANCE STORE: ⬡ Coins → LootCoins, gold, cores, prism (weekly caps).
   Backend: supabase/social.sql · shared helpers from js/social.js (SOCIAL).
   ============================================================================= */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const G = () => window.GAME;
  const S = () => window.SOCIAL;
  const fmt = (n) => { try { return G().formatNum(Math.floor(Number(n))); } catch (e) { return String(n); } };
  const UNLOCK_LEVEL = 40, CREATE_GOLD = 1e9;
  // ASCENDED PILOTS SKIP THE GATE. An ascension drops you to Level 1, and an
  // alliance is a social commitment — locking a veteran out of their own
  // alliance for 40 levels every prestige is the wrong side of the trade.
  const ascended = () => { try { return ((G().state.pasc && G().state.pasc.stars) | 0) > 0; } catch (e) { return false; } };
  const allianceOpen = () => ascended() || (G().state.level | 0) >= UNLOCK_LEVEL;
  const esc = (s) => S().esc(s);

  // ---- alliance level math (mirror of the SQL) --------------------------------
  function lvOf(xp) { let lv = 1, tot = 0; while (lv < 50) { const need = Math.floor(400 * Math.pow(lv, 1.7)); if (tot + need > xp) break; tot += need; lv++; } return lv; }
  function lvProgress(xp) { let lv = 1, tot = 0; while (lv < 50) { const need = Math.floor(400 * Math.pow(lv, 1.7)); if (tot + need > xp) return { lv, cur: xp - tot, need }; tot += need; lv++; } return { lv: 50, cur: 1, need: 1 }; }
  const slotsOf = (lv) => Math.min(50, 28 + 2 * (lv - 1));

  const DON = [
    { t: 1, ic: '$', name: 'Supply Run',      cost: () => ({ gold: 5e7 }),  axp: 20,  ac: 60 },
    { t: 2, ic: '$', name: 'War Chest',       cost: () => ({ gold: 25e7 }), axp: 60,  ac: 200 },
    { t: 3, ic: '◈', name: 'Major Donation',  cost: () => ({ lc: 200 }),    axp: 150, ac: 500 },
  ];
  const AC_ITEMS = [
    { id: 'lc',    ic: '◈', name: '150 LootCoins',  cost: 600, wk: 4, col: '#ffd66a', grant: (s) => { s.credits = (s.credits || 0) + 150; return '+150 ◈ LootCoins'; } },
    { id: 'core',  ic: '◇', name: 'Dread Core',     cost: 250, wk: 3, col: '#ff5a68', grant: (s) => { s.dreadCores = (s.dreadCores || 0) + 1; return '+1 ◇ Dread Core'; } },
    { id: 'prism', ic: '◭', name: '5 Prism Ingots', cost: 900, wk: 1, col: '#1fe3b2', minLv: 5, need: (s) => !!s.prism, grant: (s) => { s.prism.ingots = (s.prism.ingots || 0) + 5; return '+5 ◭ Prism Ingots'; } },
  ];

  // MONOLITH SHIPYARD — alliance-exclusive hull line (sequential unlock)
  const MONO_SHIPS = [
    { key: 'monolith1', cost: 500 },
    { key: 'monolith2', cost: 4500 },
    { key: 'monolith3', cost: 9000 },
    { key: 'monolith4', cost: 15000 },
  ];
  // ---- weekly ops: 3 seeded missions from live save counters ------------------
  const OPS = [
    { id: 'k1', r: 'common', ic: '☠', txt: 'Destroy {N} enemies',            n: 1200,  m: 'kills',  pts: 10, lc: 10 },
    { id: 'k2', r: 'rare',   ic: '☠', txt: 'Destroy {N} enemies',            n: 6000,  m: 'kills',  pts: 25, lc: 25 },
    { id: 'k3', r: 'epic',   ic: '☠', txt: 'Destroy {N} enemies',            n: 18000, m: 'kills',  pts: 60, lc: 60 },
    { id: 'w1', r: 'common', ic: '🏰', txt: 'Clear {N} Home Citadel waves',   n: 2,     m: 'waves',  pts: 10, lc: 10 },
    { id: 'w2', r: 'rare',   ic: '🏰', txt: 'Clear {N} Home Citadel waves',   n: 6,     m: 'waves',  pts: 25, lc: 25 },
    { id: 'c1', r: 'rare',   ic: '⛏', txt: 'Add {N} colony structure levels', n: 4,    m: 'colony', pts: 25, lc: 25 },
    { id: 'z1', r: 'epic',   ic: '▲', txt: 'Unlock {N} new zones',           n: 2,     m: 'zones',  pts: 60, lc: 60 },
  ];
  const wkKey = () => { const d = new Date(); const t = new Date(d.getFullYear(), 0, 1); return d.getFullYear() + '-' + Math.ceil(((d - t) / 864e5 + t.getDay() + 1) / 7); };
  // RANK LADDER — 'officer' is the legacy name for elder (pre-migration rows)
  const normRole = (r) => (r === 'officer' ? 'elder' : (r || 'member'));
  const RANK = { leader: 3, coleader: 2, elder: 1, member: 0 };
  const ROLE_NM = { leader: 'LEADER', coleader: 'CO-LEADER', elder: 'ELDER', member: 'MEMBER' };
  const ROLE_T = { coleader: 'Co-Leader', elder: 'Elder', member: 'Member' };
  function counters() {
    const s = G().state; let colony = 0;
    try { (s.moon.moons || []).forEach((m) => { for (const k in (m.b || {})) colony += (m.b[k].lv | 0); }); } catch (e) {}
    return { kills: s.totalKills | 0, waves: (s.homecit && s.homecit.wave) | 0, colony, zones: s.highestUnlocked | 0 };
  }
  function ensureOps() {
    const so = S().ensure();
    if (!so.ops || so.ops.wk !== wkKey()) {
      // seeded weekly draw: 1 common + 1 rare + 1 epic-or-rare
      let seed = 0; const uid = ((window.ACCOUNT && ACCOUNT.session() || {}).id || 'x') + wkKey();
      for (let i = 0; i < uid.length; i++) seed = (seed * 31 + uid.charCodeAt(i)) >>> 0;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const pick = (r) => { const p = OPS.filter((o) => o.r === r); return p[Math.floor(rnd() * p.length)].id; };
      so.ops = { wk: wkKey(), base: counters(), ids: [pick('common'), pick('rare'), pick(rnd() < 0.5 ? 'epic' : 'rare')], done: {} };
      G().save();
    }
    return so.ops;
  }

  // ---- state ------------------------------------------------------------------
  let _st = null, _view = 'main', _browse = null, _board = null, _pollT = 0, _myReq = null;
  async function load() { try { _st = await S().rpc('alliance_state'); } catch (e) { _st = null; } syncAllies(); }
  // ally set — read by the galaxy map (green tiles, attack-blocked)
  let _allySet = null;
  function syncAllies() { _allySet = _st && _st.alliance ? new Set((_st.members || []).map((m) => m.user_id)) : null; }
  function isAlly(uid) { return !!(_allySet && uid && _allySet.has(uid)); }
  // prefetch membership shortly after boot so the map is ally-aware without
  // the Social screen ever being opened
  setTimeout(() => { try { if (S() && S().signedIn && S().signedIn() && !_st) load(); } catch (e) {} }, 4000);
  const me = () => _st && _st.me;
  const myRow = () => _st && (_st.members || []).find((m) => m.user_id === me());
  const today = () => { const d = new Date(); return d.toISOString().slice(0, 10); };
  function attacksLeft(m) {
    const max = (window.VIP && VIP.level && VIP.level() >= 1) ? 3 : 2;
    const used = (m && m.day_key === today()) ? (m.attacks | 0) : 0;
    return { left: Math.max(0, max - used), max };
  }
  const donatedToday = (m) => !!(m && m.day_key === today() && m.donated);

  // ---- render -----------------------------------------------------------------
  async function renderInto(host) {
    if (!host) return;
    const lvl = (G().state.level | 0);
    if (!allianceOpen()) {
      host.innerHTML = '<div class="sc-veil"><div class="sc-veil-ic">⬡</div><h3>Alliances</h3>' +
        '<p>Found or join an alliance: one shared boss, daily donations, weekly ops against every other alliance on the server.</p>' +
        '<div class="al-lock">Unlocks at <b>Level ' + UNLOCK_LEVEL + '</b> · you\u2019re Level ' + lvl + '</div></div>';
      return;
    }
    host.innerHTML = '<div class="sc-empty">Contacting alliance network…</div>';
    if (!_st) await load();
    if (!_st) { host.innerHTML = '<div class="sc-empty">Alliance network unreachable — check your connection.</div>'; return; }
    if (!_st.alliance) return renderJoin(host);
    renderMain(host);
  }

  // ---- no alliance: browse / create / request --------------------------------
  async function renderJoin(host) {
    if (!_browse) {
      try { const r = await Promise.all([S().rpc('alliance_browse', { p_q: '' }), S().rpc('alliance_my_request')]); _browse = r[0] || []; _myReq = r[1] || null; }
      catch (e) { _browse = _browse || []; }
    }
    const gold = G().state.gold || 0;
    const pending = _myReq ? (_browse.find((x) => x.id === _myReq) || null) : null;
    host.innerHTML =
      '<div class="al-hero"><div class="al-hero-t">⬡ JOIN THE WAR EFFORT</div>' +
      '<div class="al-hero-s"><b style="color:#dfe9f6">1 · Search</b> an alliance below · <b style="color:#dfe9f6">2 · Join</b> instantly (open) or <b style="color:#dfe9f6">send a request</b> (✋ approval) · or <b style="color:#dfe9f6">found your own</b>.</div>' +
      '<button class="sc-btn gold" id="al-create-btn">⚔ Found an alliance · $ ' + fmt(CREATE_GOLD) + '</button></div>' +
      (_myReq ? '<div class="al-pending">✋ Request pending' + (pending ? ' — <b>' + esc(pending.name) + '</b>' : '') + ' · the officers will review it<button class="sc-btn sm ghost" id="al-req-cancel">Cancel</button></div>' : '') +
      '<div class="sc-search"><input id="al-q" placeholder="Search alliances by name or tag…" maxlength="24"><button class="sc-btn" id="al-go">Search</button></div>' +
      '<div class="sc-sec">' + (_lastQ ? 'RESULTS FOR “' + esc(_lastQ) + '” · ' + _browse.length : 'TOP ALLIANCES') + '</div>' +
      (_browse.length ? _browse.map((a) => {
        const lv = lvOf(Number(a.xp)), cap = slotsOf(lv), full = Number(a.members) >= cap;
        const reqMode = a.join_mode === 'request';
        const isMine = _myReq === a.id;
        const btn = full ? '<button class="sc-btn sm ghost" disabled>FULL</button>'
          : isMine ? '<button class="sc-btn sm ghost" disabled>✋ Requested</button>'
          : reqMode ? '<button class="sc-btn sm" data-req="' + a.id + '" data-nm="' + esc(a.name) + '">✋ Request</button>'
          : '<button class="sc-btn sm gold" data-join="' + a.id + '">Join</button>';
        return '<div class="sc-row"><span class="al-tag">' + esc(a.tag) + '</span>' +
          '<div class="sc-r-m"><b>' + esc(a.name) + (reqMode ? ' <em class="al-mode">✋ APPROVAL</em>' : ' <em class="al-mode open">OPEN</em>') + '</b><span>Lv ' + lv + ' · ' + a.members + '/' + cap + ' pilots · Boss ' + a.boss_n + (a.blurb ? ' · ' + esc(a.blurb) : '') + '</span></div>' + btn + '</div>';
      }).join('') : '<div class="sc-empty">' + (_lastQ ? 'No alliance matches “' + esc(_lastQ) + '” — check the tag spelling or found your own.' : 'No alliances yet — found the first one on the server.') + '</div>');
    $('al-create-btn').addEventListener('click', () => createSheet(gold));
    const rc = $('al-req-cancel');
    if (rc) rc.addEventListener('click', async () => {
      rc.disabled = true;
      try { await S().rpc('alliance_request_cancel'); _myReq = null; S().toast('Request withdrawn', '#ffcf7a'); } catch (e) {}
      renderJoin(host);
    });
    const q = $('al-q'), go = $('al-go');
    if (_lastQ) q.value = _lastQ;
    const doSearch = async () => {
      _lastQ = (q.value || '').trim();
      go.textContent = '…';
      try { _browse = (await S().rpc('alliance_browse', { p_q: _lastQ })) || []; } catch (e) { S().toast('Search failed — try again', '#e23b4e'); }
      renderJoin(host);
    };
    go.addEventListener('click', doSearch);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
    host.querySelectorAll('[data-join]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = '…';
      try { await S().rpc('alliance_join', { p_id: b.dataset.join }); _st = null; _browse = null; _myReq = null; await load(); S().toast('⬡ Welcome to the alliance', '#7ce0a0'); }
      catch (e) { S().toast(e.message || 'Could not join', '#e23b4e'); _browse = null; }
      renderInto(host.closest('#sc-pane') || host);
    }));
    host.querySelectorAll('[data-req]').forEach((b) => b.addEventListener('click', () => requestSheet(b.dataset.req, b.dataset.nm, host)));
  }
  let _lastQ = '';
  function requestSheet(aid, nm, host) {
    const v = S().sheet('<h3>✋ Request to join ' + esc(nm) + '</h3>' +
      '<p>This alliance approves members manually. Your request goes to the leader and officers — you can only have one pending request at a time.</p>' +
      '<input id="al-req-note" class="al-in" placeholder="Note to the officers (optional, 80 chars)" maxlength="80">' +
      '<div class="sc-sheet-btns"><button class="sc-btn gold" data-ok>✋ Send request</button><button class="sc-btn ghost" data-x>Cancel</button></div>');
    v.querySelector('[data-x]').addEventListener('click', () => v.remove());
    v.querySelector('[data-ok]').addEventListener('click', async () => {
      v.querySelector('[data-ok]').disabled = true;
      try {
        await S().rpc('alliance_request_join', { p_id: aid, p_note: v.querySelector('#al-req-note').value.trim() });
        _myReq = aid; v.remove(); S().toast('✋ Request sent — you\u2019ll join the moment an officer approves', '#7ce0a0');
      } catch (e) { v.querySelector('[data-ok]').disabled = false; S().toast(e.message || 'Failed', '#e23b4e'); }
      renderJoin(host);
    });
  }
  function createSheet(gold) {
    const can = gold >= CREATE_GOLD;
    const v = S().sheet('<h3>⚔ Found an alliance</h3>' +
      '<p>Costs <b style="color:#ffd24d">$ ' + fmt(CREATE_GOLD) + '</b>' + (can ? '' : ' — you have $ ' + fmt(gold)) + '. You become Leader.</p>' +
      '<input id="al-nm" class="al-in" placeholder="Alliance name (3–24 chars)" maxlength="24">' +
      '<input id="al-tg" class="al-in" placeholder="Tag (2–4 chars, e.g. VOID)" maxlength="4" style="text-transform:uppercase">' +
      '<input id="al-bl" class="al-in" placeholder="Recruiting blurb (optional)" maxlength="120">' +
      '<div class="al-mode-pick"><b>Who can join?</b>' +
      '<label><input type="radio" name="al-jm" value="open" checked> <span>OPEN — anyone joins instantly</span></label>' +
      '<label><input type="radio" name="al-jm" value="request"> <span>✋ APPROVAL — pilots request, officers approve</span></label></div>' +
      '<div class="al-form-err" id="al-form-err"></div>' +
      '<div class="sc-sheet-btns"><button class="sc-btn gold" data-ok ' + (can ? '' : 'disabled') + '>Found · $ ' + fmt(CREATE_GOLD) + '</button><button class="sc-btn ghost" data-x>Cancel</button></div>');
    v.querySelector('[data-x]').addEventListener('click', () => v.remove());
    const showErr = (m) => { const e2 = v.querySelector('#al-form-err'); if (e2) { e2.textContent = m; e2.style.display = 'block'; } };
    v.querySelector('[data-ok]').addEventListener('click', async () => {
      const nm = v.querySelector('#al-nm').value.trim(), tg = v.querySelector('#al-tg').value.trim().toUpperCase();
      if (nm.length < 3) return showErr('Name must be at least 3 characters.');
      if (tg.length < 2) return showErr('Tag must be 2–4 characters.');
      if ((G().state.gold || 0) < CREATE_GOLD) return showErr('Not enough gold — $ ' + fmt(CREATE_GOLD) + ' needed.');
      const open = (v.querySelector('input[name="al-jm"]:checked') || {}).value !== 'request';
      v.querySelector('[data-ok]').disabled = true;
      try {
        await S().rpc('alliance_create', { p_name: nm, p_tag: tg, p_blurb: v.querySelector('#al-bl').value.trim(), p_open: open });
        G().state.gold -= CREATE_GOLD; G().save();
        v.remove(); _st = null; _myReq = null; await load();
        S().toast('⬡ ' + nm + ' founded — recruit your fleet', '#ffd24d');
        const pane = $('sc-pane'); if (pane) renderInto(pane);
      } catch (e) { v.querySelector('[data-ok]').disabled = false; showErr(e.message || 'Could not found the alliance — try another name.'); }
    });
  }

  // ---- main alliance screen -----------------------------------------------------
  function renderMain(host) {
    const a = _st.alliance, mem = _st.members || [], mine = myRow() || {};
    const p = lvProgress(Number(a.xp)), cap = slotsOf(p.lv);
    const bossPct = Math.max(0, Math.min(100, Number(a.boss_hp) / Math.max(1, Number(a.boss_max)) * 100));
    const atk = attacksLeft(mine);
    const ops = ensureOps(), cnt = counters();
    const wallet = S().wallet();
    const opRows = ops.ids.map((id) => {
      const o = OPS.find((x) => x.id === id);
      const prog = Math.max(0, (cnt[o.m] | 0) - (ops.base[o.m] | 0));
      const done = !!ops.done[id], ready = !done && prog >= o.n;
      return '<div class="al-op ' + o.r + (done ? ' done' : '') + '"><span class="al-op-ic">' + o.ic + '</span>' +
        '<div class="al-op-m"><b>' + o.txt.replace('{N}', fmt(o.n)) + ' <em class="al-r ' + o.r + '">' + o.r.toUpperCase() + '</em></b>' +
        '<span>' + (done ? '✓ complete' : fmt(Math.min(prog, o.n)) + ' / ' + fmt(o.n)) + ' · +' + o.pts + ' pts · +' + o.lc + ' ◈</span></div>' +
        (done ? '<span class="al-op-done">✓</span>' : '<button class="sc-btn sm ' + (ready ? 'gold' : 'ghost') + '" data-op="' + id + '" ' + (ready ? '' : 'disabled') + '>Claim</button>') + '</div>';
    }).join('');
    const feed = (_st.feed || []).map((f) => f.kind === 'sys'
      ? '<div class="al-msg sys">' + esc(f.txt) + '</div>'
      : '<div class="al-msg"><b>' + esc(f.name) + '</b> ' + esc(f.txt) + '</div>').join('');
    const myR = RANK[normRole(mine.role)] || 0, isLead = myR === 3, isCo = myR === 2;
    const reqs = myR >= 1 ? (_st.requests || []) : []; // elder+ handle requests
    const reqBlock = reqs.length ?
      '<div class="sc-sec">✋ JOIN REQUESTS · ' + reqs.length + '</div>' + reqs.map((r) =>
        '<div class="sc-row req"><div class="sc-r-m"><b>' + esc(r.name || 'Operator') + '</b><span>Lv ' + (r.level || '?') + ' · ⚡ ' + fmt(r.power || 0) + (r.note ? ' · “' + esc(r.note) + '”' : '') + '</span></div>' +
        '<button class="sc-btn sm gold" data-appr="' + r.user_id + '">Accept</button><button class="sc-btn sm ghost" data-deny="' + r.user_id + '">✕</button></div>').join('')
      : '';
    host.innerHTML =
      '<div class="al-head"><span class="al-tag big">' + esc(a.tag) + '</span>' +
        '<div class="al-h-m"><b>' + esc(a.name) + '</b>' +
        '<span>Alliance Lv ' + p.lv + ' · ' + mem.length + '/' + cap + ' pilots · Weekly ' + fmt(a.week_key === curWeekSql() ? a.week_score : 0) + ' pts</span>' +
        '<div class="al-xp"><i style="width:' + Math.round(p.cur / p.need * 100) + '%"></i></div></div>' +
        (isLead ? '<button class="sc-btn sm ghost" id="al-rename" title="Rename alliance">✎</button>' : '') +
        '<button class="sc-btn sm ghost" id="al-leave">Leave</button></div>' +
      // WALLET — the alliance-coin balance, front and center
      '<div class="al-wallet"><span class="al-w-ic">⬡</span>' +
        '<div class="al-w-m"><b>' + fmt(wallet.ac) + '</b><span>ALLIANCE COINS</span></div>' +
        '<span class="al-w-hint">Earn from donations, weekly ops & Armada kills — spend in the store below</span></div>' +
      reqBlock +
      // BOSS — live raid
      '<div class="al-boss"><div class="al-b-top"><span class="al-b-t">☠ THE HOLLOW ARMADA · Mk-' + a.boss_n + '</span><span class="al-b-hp">' + fmt(a.boss_hp) + ' HP</span></div>' +
        '<div class="al-b-bar"><i style="width:' + bossPct + '%"></i></div>' +
        '<div class="al-b-row"><span class="al-b-s"><b>LIVE RAID</b> — fly your REAL flagship in the arena — dodge the collapse zones; the hull bar you burn down <b>is</b> this shared pool. One Armada at a time: burn it to 0 and <b>every member is paid ⬡ 300</b>, then it rebuilds at the next mark, ×1.55 harder. Resets Sundays.</span>' +
        '<button class="sc-btn heart" id="al-attack" ' + (atk.left ? '' : 'disabled') + '>⚔ Raid · ' + atk.left + '/' + atk.max + '</button></div></div>' +
      // DONATE
      '<div class="sc-sec">DAILY DONATION ' + (donatedToday(mine) ? '<b style="color:#7ce0a0">✓ done today</b>' : '') + '</div>' +
      '<div class="al-don">' + DON.map((d) => {
        const c = d.cost(), afford = c.gold ? (G().state.gold || 0) >= c.gold : (G().state.credits || 0) >= c.lc;
        return '<button class="al-don-b" data-don="' + d.t + '" ' + (donatedToday(mine) || !afford ? 'disabled' : '') + '>' +
          '<b>' + d.name + '</b><span>' + (c.gold ? '$ ' + fmt(c.gold) : '◈ ' + c.lc) + '</span><em>+' + d.axp + ' XP · +' + d.ac + ' ⬡</em></button>';
      }).join('') + '</div>' +
      // WEEKLY OPS
      '<div class="sc-sec">WEEKLY OPS · resets Monday</div>' + opRows +
      '<button class="al-board-link" id="al-board">🏆 Weekly alliance leaderboard →</button>' +
      // FEED
      '<div class="sc-sec">ALLIANCE FEED</div>' +
      '<div class="al-feed" id="al-feed">' + (feed || '<div class="al-msg sys">Quiet in here — say hello.</div>') + '</div>' +
      '<div class="al-chat"><input id="al-txt" placeholder="Message your alliance…" maxlength="120"><button class="sc-btn" id="al-send">Send</button></div>' +
      // MONOLITH SHIPYARD — alliance-exclusive hulls
      '<div class="sc-sec">⬡ MONOLITH SHIPYARD · exclusive siege hulls</div>' +
      '<div class="al-mono-blurb">Hulls carved from Hollow Armada wreckage — bonus damage to <b>Zone Bosses, Citadels, Event Bosses</b> and the <b>Armada</b> itself. Alliance Coins only, in order.</div>' +
      MONO_SHIPS.map((m, i) => {
        const sh2 = window.CONFIG.SHIP_BY_KEY[m.key]; if (!sh2) return '';
        const owned = !!(G().state.ownedShips && G().state.ownedShips[m.key]);
        const prevOk = i === 0 || !!(G().state.ownedShips && G().state.ownedShips[MONO_SHIPS[i - 1].key]);
        const canBuy = !owned && prevOk && wallet.ac >= m.cost;
        const sub = owned ? '✓ In your hangar — switch to it in Hangar ▸ Ships'
          : !prevOk ? '🔒 Requires the ' + window.CONFIG.SHIP_BY_KEY[MONO_SHIPS[i - 1].key].name
          : '⚔ ' + sh2.weapons + ' weapons · ⛨ hull ' + sh2.hull + ' · ' + sh2.tag;
        return '<div class="al-mrow' + (owned ? ' owned' : '') + (!prevOk && !owned ? ' locked' : '') + '">' +
          '<img src="ships/ship-' + m.key + '.png" alt="" onerror="this.remove()">' +
          '<div class="al-m-m"><b>' + sh2.name + ' <em>+' + Math.round(sh2.siegeBonus * 100) + '% SIEGE</em></b><span>' + sub + '</span></div>' +
          (owned ? '<span class="al-m-owned">✓</span>'
            : '<button class="sc-btn sm ' + (canBuy ? 'gold' : 'ghost') + '" data-mono="' + m.key + '" ' + (canBuy ? '' : 'disabled') + '>⬡ ' + m.cost.toLocaleString() + '</button>') + '</div>';
      }).join('') +
      // STORE
      '<div class="sc-sec">ALLIANCE STORE · consumables</div><div class="sc-store">' +
      AC_ITEMS.filter((it) => !it.need || it.need(G().state)).map((it) => {
        const so = S().ensure(), used = so.acShop.n[it.id] | 0, capd = used >= it.wk;
        const lock = it.minLv && p.lv < it.minLv;
        return '<div class="sc-item"><span class="sc-i-ic" style="color:' + it.col + '">' + it.ic + '</span>' +
          '<div class="sc-i-m"><b>' + it.name + (lock ? ' <em class="al-lockchip">Alliance Lv ' + it.minLv + '</em>' : '') + '</b><span>' + used + '/' + it.wk + ' this week</span></div>' +
          '<button class="sc-btn sm ' + (capd ? 'ghost' : 'gold') + '" data-acbuy="' + it.id + '" ' + (capd || lock || wallet.ac < it.cost ? 'disabled' : '') + '>' + (capd ? 'MAX' : '⬡ ' + it.cost) + '</button></div>';
      }).join('') + '</div>' +
      // ROSTER
      '<div class="sc-sec">ROSTER · weekly contribution</div>' +
      mem.map((m) => {
        const on = S().online(m.last_seen);
        const r = normRole(m.role), tr = RANK[r] || 0, self = m.user_id === me();
        const up = r === 'member' ? 'elder' : r === 'elder' ? 'coleader' : null;   // next rank up
        const dn = r === 'coleader' ? 'elder' : r === 'elder' ? 'member' : null;   // next rank down
        const canUp = up && !self && (isLead || (isCo && up === 'elder'));
        const canDn = dn && !self && (isLead || (isCo && r === 'elder'));
        const canKick = !self && myR >= 1 && myR > tr;
        return '<div class="sc-row"><i class="sc-dot ' + (on ? 'on' : '') + '"></i>' +
          '<div class="sc-r-m"><b>' + esc(m.name || 'Operator') + ' <em class="al-role ' + r + '">' + ROLE_NM[r] + '</em></b>' +
          '<span>Lv ' + (m.level || '?') + ' · ⚡ ' + fmt(m.power || 0) + ' · ' + fmt(m.week_key === curWeekSql() ? m.contrib : 0) + ' contrib</span></div>' +
          (canUp ? '<button class="sc-btn sm ghost" title="Promote to ' + ROLE_T[up] + '" data-role="' + m.user_id + '" data-to="' + up + '">▴</button>' : '') +
          (canDn ? '<button class="sc-btn sm ghost" title="Demote to ' + ROLE_T[dn] + '" data-role="' + m.user_id + '" data-to="' + dn + '">▾</button>' : '') +
          (canKick ? '<button class="sc-btn sm ghost" data-kick="' + m.user_id + '">✕</button>' : '') + '</div>';
      }).join('');
    wireMain(host);
  }
  // SQL week key (IYYY-IW) — approximate match for display gating
  function curWeekSql() { const a = _st && _st.alliance; return a ? a.week_key : ''; }

  const RENAME_LC = 1000;
  // Rename the alliance for ◈ 1000 LootCoins. LEADER ONLY — a co-leader renaming
  // the alliance out from under the leader is the kind of thing that ends one.
  // The TAG is not editable here on purpose: it is what members recognise each
  // other by on the galaxy map and in war, and a silent tag change breaks that.
  function renameSheet(host) {
    const a = _st.alliance;
    const lc = (G().state.credits || 0);
    const can = lc >= RENAME_LC;
    const v = S().sheet('<h3>✎ Rename alliance</h3>' +
      '<p>Costs <b style="color:#ffd66a">◈ ' + fmt(RENAME_LC) + ' LootCoins</b>' + (can ? '' : ' — you have ◈ ' + fmt(lc)) + '. ' +
        'Your tag <b>' + esc(a.tag) + '</b> stays the same, so members still recognise you in war.</p>' +
      '<input id="al-rn" class="al-in" placeholder="New alliance name (3–24 chars)" maxlength="24" value="' + esc(a.name) + '">' +
      '<div class="al-form-err" id="al-rn-err"></div>' +
      '<div class="sc-sheet-btns"><button class="sc-btn gold" data-ok ' + (can ? '' : 'disabled') + '>Rename · ◈ ' + fmt(RENAME_LC) + '</button>' +
      '<button class="sc-btn ghost" data-x>Cancel</button></div>');
    v.querySelector('[data-x]').addEventListener('click', () => v.remove());
    const err = (m) => { const e = v.querySelector('#al-rn-err'); e.textContent = m; e.style.display = 'block'; };
    v.querySelector('[data-ok]').addEventListener('click', async () => {
      const nm = (v.querySelector('#al-rn').value || '').trim();
      if (nm.length < 3 || nm.length > 24) return err('Name must be 3–24 characters.');
      if (nm === a.name) return err('That is already the name.');
      if ((G().state.credits || 0) < RENAME_LC) return err('Not enough LootCoins.');
      const ok = v.querySelector('[data-ok]'); ok.disabled = true; ok.textContent = '…';
      try {
        await S().rpc('alliance_rename', { p_name: nm });
        // charge only after the server accepts, so a rejected name is never billed
        G().state.credits = (G().state.credits || 0) - RENAME_LC; G().save();
        v.remove(); _st = null; _browse = null; await load();
        S().toast('✎ Alliance renamed to ' + nm, '#7ce0a0');
        renderInto($('sc-pane'));
      } catch (e) {
        ok.disabled = false; ok.textContent = 'Rename · ◈ ' + fmt(RENAME_LC);
        err(e && e.message ? e.message : 'Rename failed — that name may be taken.');
      }
    });
  }
  function wireMain(host) {
    const a = _st.alliance;
    { const rb = $('al-rename'); if (rb) rb.addEventListener('click', () => renameSheet(host)); }
    $('al-leave').addEventListener('click', () => {
      S().confirmSheet('Leave ' + a.name + '?',
      (myRow() || {}).role === 'leader' ? 'Leadership passes to your senior member. If you\u2019re the last pilot, the alliance disbands. 24-hour cooldown before you can join or found another alliance.' : 'Leaving starts a 24-hour cooldown before you can join or found another alliance.',
      async () => { try { await S().rpc('alliance_leave'); _st = null; _browse = null; } catch (e) {} renderInto($('sc-pane')); });
    });
    $('al-attack').addEventListener('click', () => {
      const b = $('al-attack'); b.disabled = true; b.textContent = '⚔ …';
      if (!window.ALBOSS) { S().toast('Combat systems offline', '#e23b4e'); renderMain(host); return; }
      const a2 = _st.alliance;
      try { window.ALBOSS.start({
        bossN: a2.boss_n | 0, bossHp: Number(a2.boss_hp), bossMax: Number(a2.boss_max),
        onDone: async (res) => {
          // REAL damage from the arena run (Monolith bonus already applied). There is
          // NO server cap any more — the arena boss hull IS the mark's remaining hull
          // and raw combat damage is what lands, so the ⚔ meter the player watched
          // fill is exactly what transmits. The SERVER still owns the mark and the
          // kill; the client never advances Mk on its own.
          const dmg = Math.max(1, Math.round(res.dmg || 1));
          try {
            const r = await S().rpc('alliance_attack', { p_dmg: dmg, p_vip: !!(window.VIP && VIP.level && VIP.level() >= 1), p_pow: Math.max(0, Math.round((G().score && G().score()) || 0)) });
            // pocket reward scales with raid performance
            G().state.gold = (G().state.gold || 0) + Math.round(res.frac * 2e6 * Math.pow(window.CONFIG.dungeonScale(Math.max(1, G().state.highestUnlocked || 1)), 0.7)); G().save();
            S().toast(r && (r.kills | 0) > 0 ? '☠ ARMADA DOWN — ⬡ ' + ((r.coins | 0) || 300) + ' paid to every member · now Mk-' + (r.boss_n || '?')
              : res.died ? '✝ Fleet lost — partial damage logged: ' + fmt((r && r.dmg) || dmg)
              : '⚔ Damage transmitted: ' + fmt((r && r.dmg) || dmg),
              r && (r.kills | 0) > 0 ? '#ffd24d' : res.died ? '#ff8a96' : '#7ce0a0');
            await Promise.all([load(), S().refreshWallet()]);
          } catch (e) { S().toast(e.message || 'Attack failed', '#e23b4e'); await load(); }
          renderMain(host);
        },
      }); } catch (e) { S().toast(e.message || 'Raid failed to launch', '#e23b4e'); renderMain(host); }
    });
    host.querySelectorAll('[data-don]').forEach((b) => b.addEventListener('click', async () => {
      const d = DON.find((x) => x.t === +b.dataset.don), c = d.cost(), s = G().state;
      if (c.gold && (s.gold || 0) < c.gold) return;
      if (c.lc && (s.credits || 0) < c.lc) return;
      b.disabled = true;
      try {
        await S().rpc('alliance_donate', { p_tier: d.t });
        if (c.gold) s.gold -= c.gold; if (c.lc) s.credits -= c.lc;
        G().save();
        S().toast('⬡ Donation logged — +' + d.axp + ' Alliance XP · +' + d.ac + ' ⬡', '#7ce0a0');
        await Promise.all([load(), S().refreshWallet()]);
      } catch (e) { S().toast(e.message || 'Donation failed', '#e23b4e'); await load(); }
      renderMain(host);
    }));
    host.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.op, o = OPS.find((x) => x.id === id), ops = ensureOps();
      if (ops.done[id]) return;
      b.disabled = true;
      try {
        await S().rpc('alliance_week_add', { p_pts: o.pts });
        ops.done[id] = 1;
        G().state.credits = (G().state.credits || 0) + o.lc;
        G().save();
        S().toast('✓ Op complete — +' + o.pts + ' alliance pts · +' + o.lc + ' ◈', '#ffd24d');
        await load();
      } catch (e) { S().toast(e.message || 'Failed', '#e23b4e'); }
      renderMain(host);
    }));
    const send = async () => {
      const inp = $('al-txt'), t = (inp.value || '').trim(); if (!t) return;
      inp.value = '';
      try { await S().rpc('alliance_chat', { p_txt: t }); await load(); renderMain(host); }
      catch (e) { S().toast(e.message || 'Message failed', '#e23b4e'); }
    };
    $('al-send').addEventListener('click', send);
    $('al-txt').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    host.querySelectorAll('[data-acbuy]').forEach((b) => b.addEventListener('click', async () => {
      const it = AC_ITEMS.find((x) => x.id === b.dataset.acbuy);
      if (it && await S().buyAC(it)) renderMain(host);
    }));
    // Monolith Shipyard — one-time hull purchases
    host.querySelectorAll('[data-mono]').forEach((b) => b.addEventListener('click', async () => {
      const m = MONO_SHIPS.find((x) => x.key === b.dataset.mono); if (!m) return;
      const sh2 = window.CONFIG.SHIP_BY_KEY[m.key];
      // HARD one-time guards — never charge for a hull already in the hangar,
      // never skip the sequential chain (stale pane / double-tap safe)
      const ow = G().state.ownedShips || {};
      if (ow[m.key]) { S().toast('✓ Already in your hangar — switch to it in Hangar ▸ Ships', '#7ce0a0'); renderMain(host); return; }
      const prev = MONO_SHIPS[MONO_SHIPS.indexOf(m) - 1];
      if (prev && !ow[prev.key]) { S().toast('🔒 Build the ' + window.CONFIG.SHIP_BY_KEY[prev.key].name + ' first', '#e23b4e'); renderMain(host); return; }
      b.disabled = true; b.textContent = '⬡ …';
      try {
        await S().rpc('social_spend', { p_kind: 'ac', p_amount: m.cost });
        await S().refreshWallet();
        G().grantShip(m.key); G().save();
        S().toast('⬡ ' + sh2.name + ' joins your fleet — switch to it in Hangar ▸ Ships', '#7ff2e0');
        try { if (window.MAIL) MAIL.push({ ic: '⬡', title: sh2.name + ' delivered', body: 'The Monolith Shipyard has completed your <b>' + sh2.name + '</b>. It deals <b>+' + Math.round(sh2.siegeBonus * 100) + '%</b> damage to Zone Bosses, Citadels, Event Bosses and the Hollow Armada. Switch to it in <b>Hangar ▸ Ships</b>.' }); } catch (e) {}
      } catch (e) { S().toast(e.message || 'Purchase failed', '#e23b4e'); }
      renderMain(host);
    }));
    host.querySelectorAll('[data-appr]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await S().rpc('alliance_request_respond', { p_uid: b.dataset.appr, p_accept: true }); S().toast('✓ Request approved', '#7ce0a0'); await load(); }
      catch (e) { S().toast(e.message || 'Failed', '#e23b4e'); await load(); }
      renderMain(host);
    }));
    host.querySelectorAll('[data-deny]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await S().rpc('alliance_request_respond', { p_uid: b.dataset.deny, p_accept: false }); await load(); } catch (e) {}
      renderMain(host);
    }));
    host.querySelectorAll('[data-kick]').forEach((b) => b.addEventListener('click', () => {
      S().confirmSheet('Remove this pilot?', 'They can rejoin unless the alliance is full.', async () => {
      try { await S().rpc('alliance_kick', { p_uid: b.dataset.kick }); await load(); } catch (e) { S().toast(e.message || 'Failed', '#e23b4e'); }
      renderMain(host);
    });
    }));
    host.querySelectorAll('[data-role]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await S().rpc('alliance_role', { p_uid: b.dataset.role, p_role: b.dataset.to });
        S().toast((b.textContent === '▾' ? '▾ Demoted to ' : '▴ Promoted to ') + ROLE_T[b.dataset.to], '#7ce0a0');
        await load();
      } catch (e) { S().toast(e.message || 'Rank change failed', '#e23b4e'); }
      renderMain(host);
    }));
    $('al-board').addEventListener('click', async () => {
      let rows = []; try { rows = (await S().rpc('alliance_weekly_board')) || []; } catch (e) {}
      const my = _st.alliance.id;
      S().sheet('<h3>🏆 Weekly Alliance Board</h3>' +
        (rows.length ? '<div class="al-lb">' + rows.map((r, i) =>
          '<div class="al-lb-row ' + (r.id === my ? 'me' : '') + '"><b>#' + (i + 1) + '</b><span class="al-tag">' + esc(r.tag) + '</span><em>' + esc(r.name) + '</em><b>' + fmt(r.week_score) + '</b></div>').join('') + '</div>'
          : '<p>No alliance has scored this week yet — complete Weekly Ops to put yours on the board.</p>') +
        '<p style="margin-top:10px;font-size:11px;color:#6f8199">Board resets Monday. Season titles for top alliances are coming.</p>' +
        '<div class="sc-sheet-btns"><button class="sc-btn ghost" data-x>Close</button></div>')
        .querySelector('[data-x]').addEventListener('click', (e) => e.target.closest('.sc-sheet-veil').remove());
    });
    const fd = $('al-feed'); if (fd) fd.scrollTop = fd.scrollHeight;
    // feed poll while the pane is visible
    clearInterval(_pollT);
    _pollT = setInterval(async () => {
      const pane = $('al-feed');
      const scr = document.getElementById('screen-social');
      if (!pane || !scr || !scr.classList.contains('active')) { clearInterval(_pollT); return; }
      const before = (_st.feed || []).length && _st.feed[_st.feed.length - 1].id;
      await load();
      if (!_st || !_st.alliance) { clearInterval(_pollT); return; }
      const after = (_st.feed || []).length && _st.feed[_st.feed.length - 1].id;
      if (after !== before) renderMain($('sc-pane'));
    }, 15000);
  }

  window.ALLIANCE = { renderInto, isAlly, reload: async () => { _st = null; await load(); } };

  const CSS = `
  .al-lock{ display:inline-block; font-size:12px; color:#ffcf7a; border:1px solid #5a4420; border-radius:10px; padding:7px 14px; }
  .al-wallet{ display:flex; align-items:center; gap:11px; background:linear-gradient(130deg,#0d2a24,#0a1a18); border:1px solid #1e5a50; border-radius:14px; padding:11px 14px; margin-bottom:10px; box-shadow:inset 0 0 30px rgba(46,230,201,.05); }
  .al-w-ic{ font-size:24px; color:#2ee6c9; text-shadow:0 0 14px rgba(46,230,201,.6); flex:none; }
  .al-w-m{ flex:none; }
  .al-w-m b{ display:block; font-family:'Orbitron',sans-serif; font-size:19px; font-weight:900; color:#8ff2e0; line-height:1.05; font-variant-numeric:tabular-nums; }
  .al-w-m span{ font-size:8.5px; font-weight:800; letter-spacing:.18em; color:#3f9e8e; }
  .al-w-hint{ font-size:10.5px; color:#6f9a91; line-height:1.45; text-align:right; flex:1; }
  .al-mono-blurb{ font-size:11.5px; color:#8fa3bd; line-height:1.5; background:#0e1622; border:1px solid #1c2a3e; border-radius:11px; padding:9px 12px; margin-bottom:7px; }
  .al-mrow{ display:flex; align-items:center; gap:10px; background:linear-gradient(130deg,#0f1d24,#0c141f); border:1px solid #1e3a44; border-radius:13px; padding:9px 11px; margin-bottom:6px; }
  .al-mrow.owned{ border-color:#1e5a50; }
  .al-mrow.locked{ opacity:.62; }
  .al-mrow img{ width:62px; height:42px; object-fit:contain; flex:none; filter:drop-shadow(0 0 8px rgba(46,230,201,.35)); }
  .al-m-m{ flex:1; min-width:0; }
  .al-m-m b{ display:block; color:#e7f0fb; font-size:13px; font-weight:700; }
  .al-m-m b em{ font-style:normal; font-family:'Orbitron',sans-serif; font-size:8.5px; letter-spacing:.08em; color:#7ff2e0; border:1px solid #1e5a50; border-radius:5px; padding:1px 5px; vertical-align:1px; margin-left:5px; }
  .al-m-m span{ font-size:10.5px; color:#7e91a9; }
  .al-m-owned{ font-size:16px; color:#2ee6c9; flex:none; padding:0 8px; }
  .al-pending{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:12px; color:#ffcf7a; background:linear-gradient(130deg,#241c08,#171106); border:1px solid #5a4420; border-radius:12px; padding:10px 12px; margin-bottom:10px; }
  .al-pending .sc-btn{ margin-left:auto; }
  .al-mode{ font-style:normal; font-size:8.5px; letter-spacing:.06em; border-radius:5px; padding:1px 5px; vertical-align:1px; margin-left:5px; background:#3a2a10; color:#ffcf7a; }
  .al-mode.open{ background:#123a26; color:#7ce0a0; }
  .al-mode-pick{ margin-top:12px; display:grid; gap:7px; font-size:12px; color:#9fb1c4; }
  .al-mode-pick b{ color:#dfe9f6; font-size:11px; letter-spacing:.08em; }
  .al-mode-pick label{ display:flex; align-items:center; gap:8px; background:#0e141f; border:1px solid #26324a; border-radius:10px; padding:9px 11px; cursor:pointer; }
  .al-mode-pick input{ accent-color:#f2b24b; }
  .al-form-err{ display:none; margin-top:10px; font-size:12px; color:#ff8a96; background:rgba(226,59,78,.1); border:1px solid rgba(226,59,78,.35); border-radius:9px; padding:8px 11px; }
  .al-hero{ background:linear-gradient(130deg,#101c2e,#0b1220); border:1px solid #24405e; border-radius:14px; padding:15px; margin-bottom:12px; }
  .al-hero-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:12px; letter-spacing:.12em; color:#7fc4ff; }
  .al-hero-s{ font-size:12px; color:#8ea3bd; line-height:1.55; margin:6px 0 12px; }
  .al-tag{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:10px; letter-spacing:.06em; color:#7fc4ff; background:#0e1a2c; border:1px solid #2a4560; border-radius:7px; padding:4px 7px; flex:none; }
  .al-tag.big{ font-size:13px; padding:8px 10px; }
  .al-in{ display:block; width:100%; margin-top:8px; background:#0e141f; border:1px solid #26324a; border-radius:10px; color:#e7f0fb; font-family:'Rajdhani',sans-serif; font-size:14px; padding:9px 12px; outline:none; }
  .al-head{ display:flex; align-items:center; gap:10px; background:#101826; border:1px solid #1e2a3c; border-radius:14px; padding:12px; margin-bottom:10px; }
  .al-h-m{ flex:1; min-width:0; }
  .al-h-m b{ display:block; color:#fff; font-family:'Orbitron',sans-serif; font-size:14px; }
  .al-h-m>span{ font-size:11px; color:#7e91a9; }
  .al-xp{ height:5px; background:#0a0f18; border-radius:3px; margin-top:6px; overflow:hidden; }
  .al-xp i{ display:block; height:100%; background:linear-gradient(90deg,#4a9dff,#7fc4ff); border-radius:3px; }
  .al-boss{ background:linear-gradient(130deg,#22101c,#130a12); border:1px solid #57243f; border-radius:14px; padding:13px; margin-bottom:4px; }
  .al-b-top{ display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
  .al-b-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:11px; letter-spacing:.1em; color:#ff8fa8; }
  .al-b-hp{ font-size:11px; color:#c78a9d; font-variant-numeric:tabular-nums; }
  .al-b-bar{ height:10px; background:#0a0710; border:1px solid #3d1f30; border-radius:6px; overflow:hidden; margin:8px 0; }
  .al-b-bar i{ display:block; height:100%; background:linear-gradient(90deg,#ff2d55,#ff7a4a); }
  .al-b-row{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
  .al-b-s{ font-size:11px; color:#c7a3b2; line-height:1.4; }
  .al-b-s b{ color:#ffd24d; }
  .al-don{ display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
  .al-don-b{ background:#101826; border:1px solid #1e2a3c; border-radius:12px; padding:10px 6px; cursor:pointer; text-align:center; }
  .al-don-b:disabled{ opacity:.45; pointer-events:none; }
  .al-don-b b{ display:block; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:12px; color:#e7f0fb; }
  .al-don-b span{ display:block; font-size:11.5px; color:#ffd24d; margin:3px 0; }
  .al-don-b em{ display:block; font-style:normal; font-size:9.5px; color:#6f8199; }
  .al-op{ display:flex; align-items:center; gap:10px; background:#101826; border:1px solid #1e2a3c; border-radius:12px; padding:9px 11px; margin-bottom:6px; }
  .al-op.done{ opacity:.55; }
  .al-op-ic{ font-size:17px; flex:none; }
  .al-op-m{ flex:1; min-width:0; }
  .al-op-m b{ display:block; color:#e7f0fb; font-size:12.5px; font-weight:700; }
  .al-op-m span{ font-size:10.5px; color:#7e91a9; }
  .al-r{ font-style:normal; font-size:8.5px; letter-spacing:.08em; border-radius:5px; padding:1px 5px; vertical-align:1px; margin-left:4px; }
  .al-r.common{ background:#26324a; color:#9fb0c4; }
  .al-r.rare{ background:#123553; color:#5db9ff; }
  .al-r.epic{ background:#2c1a4a; color:#c08bff; }
  .al-op-done{ color:#46d27a; font-size:16px; }
  .al-board-link{ width:100%; background:none; border:1px dashed #2a3a54; border-radius:12px; color:#7fc4ff; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12.5px; padding:9px; cursor:pointer; margin:2px 0 4px; }
  .al-feed{ background:#0b111c; border:1px solid #1c2736; border-radius:12px; padding:10px 12px; max-height:190px; overflow-y:auto; display:flex; flex-direction:column; gap:6px; }
  .al-msg{ font-size:12.5px; color:#c9d6e6; line-height:1.4; word-break:break-word; }
  .al-msg b{ color:#7fc4ff; margin-right:4px; }
  .al-msg.sys{ color:#8d9db3; font-size:11.5px; }
  .al-chat{ display:flex; gap:6px; margin-top:6px; }
  .al-chat input{ flex:1; min-width:0; background:#0e141f; border:1px solid #26324a; border-radius:10px; color:#e7f0fb; font-family:'Rajdhani',sans-serif; font-size:13.5px; padding:9px 12px; outline:none; }
  .al-role{ font-style:normal; font-size:8.5px; letter-spacing:.08em; border-radius:5px; padding:1px 5px; vertical-align:1px; margin-left:4px; background:#26324a; color:#9fb0c4; }
  .al-role.leader{ background:#4a3410; color:#ffd24d; }
  .al-role.coleader{ background:#3a1d4d; color:#c99aff; }
  .al-role.elder{ background:#123553; color:#5db9ff; }
  .al-lockchip{ font-style:normal; font-size:9px; color:#ffcf7a; border:1px solid #5a4420; border-radius:5px; padding:1px 5px; margin-left:5px; }
  .al-lb{ display:flex; flex-direction:column; gap:5px; max-height:300px; overflow-y:auto; }
  .al-lb-row{ display:flex; align-items:center; gap:9px; background:#101826; border:1px solid #1e2a3c; border-radius:10px; padding:8px 10px; font-size:12.5px; }
  .al-lb-row.me{ border-color:#4a6a94; background:#12203a; }
  .al-lb-row em{ flex:1; font-style:normal; color:#dfe9f6; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .al-lb-row b{ color:#ffd24d; font-variant-numeric:tabular-nums; }
  `;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
})();
