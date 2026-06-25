/* =============================================================================
   admin.js — Loot Fleet home-page admin dashboard
   ---------------------------------------------------------------------------
   Opens on lootfleet.com/#admin (or the lock affordance in the footer).
   Gated by a password; the SAME password is re-checked server-side inside every
   admin_* RPC (supabase/admin.sql), so the data is protected at the database
   level even though this panel runs in the browser with the public anon key.

   Reads REAL data:
     • Users / signups  ← auth.users + saves (via admin_users / admin_overview)
     • Purchases / revenue ← purchases table written by the stripe-webhook
     • Traffic           ← page_views table written by js/analytics.js
   ============================================================================= */
(function () {
  'use strict';

  var ADMIN_PW = '20042004';            // panel unlock — also enforced in SQL
  var SS_KEY = 'lf_admin_pw';           // remembers the password for the session
  var cfg = window.LOOTFLEET || {};
  var $ = function (id) { return document.getElementById(id); };

  // ---- tiny REST helper (no supabase-js needed) -----------------------------
  async function rpc(fn, args) {
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      var e = new Error('no-config'); e.kind = 'no-config'; throw e;
    }
    var res = await fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': cfg.supabaseAnonKey,
        'Authorization': 'Bearer ' + cfg.supabaseAnonKey,
      },
      body: JSON.stringify(args || {}),
    });
    var txt = await res.text();
    var data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
    if (!res.ok) {
      var msg = (data && (data.message || data.hint)) || txt || ('HTTP ' + res.status);
      var err = new Error(msg);
      err.status = res.status;
      err.code = data && data.code;
      if (res.status === 404 || (err.code && /^PGRST20/.test(err.code)) || /could not find the function/i.test(msg))
        err.kind = 'not-deployed';
      else if (/unauthorized/i.test(msg) || res.status === 401 || err.code === '28000')
        err.kind = 'unauthorized';
      throw err;
    }
    return data;
  }

  // ---- formatters -----------------------------------------------------------
  var money = function (cents) {
    return '$' + ((cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  };
  var num = function (n) { return (n == null ? 0 : n).toLocaleString(); };
  function ago(ts) {
    if (!ts) return '—';
    var d = (Date.now() - new Date(ts).getTime()) / 1000;
    if (d < 60) return 'just now';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    if (d < 604800) return Math.floor(d / 86400) + 'd ago';
    return new Date(ts).toLocaleDateString();
  }
  function shortDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  // ===========================================================================
  // OPEN / CLOSE + GATE
  // ===========================================================================
  function open() {
    var app = $('adminApp'); if (!app) return;
    app.classList.add('open');
    document.body.style.overflow = 'hidden';
    var remembered = '';
    try { remembered = sessionStorage.getItem(SS_KEY) || ''; } catch (e) {}
    if (remembered === ADMIN_PW) { enter(remembered); }
    else { showGate(); setTimeout(function () { var i = $('admPw'); if (i) i.focus(); }, 80); }
  }
  function close() {
    var app = $('adminApp'); if (!app) return;
    app.classList.remove('open');
    document.body.style.overflow = '';
    if (location.hash === '#admin') history.replaceState(null, '', location.pathname + location.search);
  }
  function showGate() { $('admGate').style.display = 'flex'; $('admMain').style.display = 'none'; }
  function showMain() { $('admGate').style.display = 'none'; $('admMain').style.display = 'block'; }

  function submitGate(e) {
    if (e) e.preventDefault();
    var v = ($('admPw').value || '').trim();
    var errEl = $('admPwErr');
    if (v !== ADMIN_PW) { errEl.textContent = 'Incorrect password.'; errEl.style.display = 'block'; return; }
    errEl.style.display = 'none';
    try { sessionStorage.setItem(SS_KEY, v); } catch (e2) {}
    enter(v);
  }

  function enter(pw) {
    showMain();
    loadAll(pw);
  }

  function lockOut(msg) {
    try { sessionStorage.removeItem(SS_KEY); } catch (e) {}
    showGate();
    var errEl = $('admPwErr');
    errEl.textContent = msg || 'Session expired — sign in again.';
    errEl.style.display = 'block';
    var i = $('admPw'); if (i) { i.value = ''; i.focus(); }
  }

  // ===========================================================================
  // SETUP STATE  (RPCs not yet created in Supabase)
  // ===========================================================================
  function showSetup() {
    $('admSetup').style.display = 'block';
    $('admDash').style.display = 'none';
  }
  function showDash() {
    $('admSetup').style.display = 'none';
    $('admDash').style.display = 'block';
  }

  // ===========================================================================
  // DATA LOAD
  // ===========================================================================
  async function loadAll(pw) {
    showDash();
    setStatus('Loading live data…');
    var ov;
    try {
      ov = await rpc('admin_overview', { p_pw: pw });
    } catch (err) {
      if (err.kind === 'unauthorized') { lockOut('Password rejected by the server.'); return; }
      if (err.kind === 'not-deployed') { showSetup(); setStatus(''); return; }
      if (err.kind === 'no-config') { showSetup(true); setStatus(''); return; }
      setStatus('Could not reach the backend: ' + err.message, true);
      return;
    }
    renderOverview(ov);
    setStatus('Live · ' + new Date().toLocaleTimeString());

    // the rest load independently — a failure in one doesn't blank the others
    rpc('admin_traffic', { p_pw: pw, p_days: 30 }).then(renderTraffic).catch(function () {});
    rpc('admin_users', { p_pw: pw, p_limit: 200, p_offset: 0 }).then(renderUsers).catch(function () {});
    rpc('admin_purchases', { p_pw: pw, p_limit: 100 }).then(renderPurchases).catch(function () {});
  }

  function setStatus(msg, isErr) {
    var el = $('admStatus'); if (!el) return;
    el.textContent = msg;
    el.style.color = isErr ? 'var(--c-mythic)' : 'var(--muted-2)';
  }

  // ---- KPI cards ------------------------------------------------------------
  function renderOverview(o) {
    o = o || {};
    var cards = [
      { k: 'Total revenue', v: money(o.revenue_total_cents), sub: num(o.orders_total) + ' orders · ' + num(o.paying_users) + ' paying', accent: 'gold' },
      { k: 'Revenue · 30d', v: money(o.revenue_30d_cents), sub: money(o.revenue_today_cents) + ' today', accent: 'gold' },
      { k: 'Total players', v: num(o.total_users), sub: '+' + num(o.users_7d) + ' this week', accent: 'cyan' },
      { k: 'Active · 7d', v: num(o.active_7d), sub: num(o.active_24h) + ' in last 24h', accent: 'cyan' },
      { k: 'Pageviews · 7d', v: num(o.views_7d), sub: num(o.views_today) + ' today', accent: 'green' },
      { k: 'Visitors · 7d', v: num(o.visitors_7d), sub: num(o.visitors_today) + ' today', accent: 'green' },
      { k: 'Pro subscribers', v: num(o.pro_active), sub: 'active subscriptions', accent: 'purple' },
      { k: 'Cloud saves', v: num(o.total_saves), sub: num(o.users_30d) + ' joined · 30d', accent: 'purple' },
    ];
    $('admKpis').innerHTML = cards.map(function (c) {
      return '<div class="adm-kpi adm-' + c.accent + '"><div class="adm-kpi-k">' + c.k + '</div>'
        + '<div class="adm-kpi-v">' + c.v + '</div>'
        + '<div class="adm-kpi-sub">' + c.sub + '</div></div>';
    }).join('');
  }

  // ---- traffic --------------------------------------------------------------
  var _trafficData = null;
  function renderTraffic(t) {
    t = t || {};
    _trafficData = t.daily || [];
    drawChart(_trafficData);
    var paths = t.top_paths || [];
    var refs = t.top_referrers || [];
    var maxP = Math.max.apply(null, paths.map(function (p) { return p.views; }).concat([1]));
    $('admPaths').innerHTML = paths.length ? paths.map(function (p) {
      return '<div class="adm-bar-row"><span class="adm-bar-label">' + esc(p.path) + '</span>'
        + '<span class="adm-bar-track"><i style="width:' + (p.views / maxP * 100) + '%"></i></span>'
        + '<span class="adm-bar-val">' + num(p.views) + '</span></div>';
    }).join('') : '<div class="adm-empty">No page views recorded yet.</div>';
    var maxR = Math.max.apply(null, refs.map(function (r) { return r.views; }).concat([1]));
    $('admRefs').innerHTML = refs.length ? refs.map(function (r) {
      return '<div class="adm-bar-row"><span class="adm-bar-label">' + esc(r.source) + '</span>'
        + '<span class="adm-bar-track"><i class="cyan" style="width:' + (r.views / maxR * 100) + '%"></i></span>'
        + '<span class="adm-bar-val">' + num(r.views) + '</span></div>';
    }).join('') : '<div class="adm-empty">No referrers yet.</div>';
  }

  function drawChart(daily) {
    var cv = $('admChart'); if (!cv) return;
    var wrap = cv.parentElement;
    var dpr = window.devicePixelRatio || 1;
    var W = wrap.clientWidth, H = 220;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var pad = { l: 8, r: 8, t: 14, b: 22 };
    if (!daily || !daily.length) {
      ctx.fillStyle = '#647189'; ctx.font = '13px Rajdhani, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('No traffic recorded yet — page views appear here once visitors arrive.', W / 2, H / 2);
      return;
    }
    var max = Math.max.apply(null, daily.map(function (d) { return d.views; }).concat([1]));
    var n = daily.length;
    var plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
    var x = function (i) { return pad.l + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW); };
    var y = function (v) { return pad.t + plotH - (v / max) * plotH; };

    // gridlines
    ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
    for (var g = 0; g <= 3; g++) { var gy = pad.t + (g / 3) * plotH; ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(W - pad.r, gy); ctx.stroke(); }

    // area fill
    var grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
    grad.addColorStop(0, 'rgba(242,178,75,.28)'); grad.addColorStop(1, 'rgba(242,178,75,0)');
    ctx.beginPath(); ctx.moveTo(x(0), y(daily[0].views));
    daily.forEach(function (d, i) { ctx.lineTo(x(i), y(d.views)); });
    ctx.lineTo(x(n - 1), pad.t + plotH); ctx.lineTo(x(0), pad.t + plotH); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // views line
    ctx.beginPath(); daily.forEach(function (d, i) { i ? ctx.lineTo(x(i), y(d.views)) : ctx.moveTo(x(i), y(d.views)); });
    ctx.strokeStyle = '#f2b24b'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();

    // visitors line
    ctx.beginPath(); daily.forEach(function (d, i) { i ? ctx.lineTo(x(i), y(d.visitors)) : ctx.moveTo(x(i), y(d.visitors)); });
    ctx.strokeStyle = '#5fd1ff'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);

    // points + peak label
    daily.forEach(function (d, i) { ctx.beginPath(); ctx.arc(x(i), y(d.views), 2.5, 0, 7); ctx.fillStyle = '#ffd07a'; ctx.fill(); });

    // x labels (first, mid, last)
    ctx.fillStyle = '#647189'; ctx.font = '11px Rajdhani, sans-serif'; ctx.textAlign = 'center';
    [0, Math.floor((n - 1) / 2), n - 1].forEach(function (i) { if (daily[i]) ctx.fillText(shortDate(daily[i].day), x(i), H - 6); });
  }

  // ---- users ----------------------------------------------------------------
  var _users = [];
  function renderUsers(rows) {
    _users = rows || [];
    $('admUserCount').textContent = num(_users.length) + (_users.length === 200 ? '+ (showing latest 200)' : '');
    paintUsers(_users);
  }
  function paintUsers(rows) {
    if (!rows.length) { $('admUsersBody').innerHTML = '<tr><td colspan="8" class="adm-empty">No players yet.</td></tr>'; return; }
    $('admUsersBody').innerHTML = rows.map(function (u) {
      var pro = u.pro_until && new Date(u.pro_until) > new Date();
      return '<tr>'
        + '<td><div class="adm-u-name">' + esc(u.name || '—') + (pro ? ' <span class="adm-pill gold">PRO</span>' : '') + '</div>'
        + '<div class="adm-u-email">' + esc(u.email || 'guest') + '</div></td>'
        + '<td>' + esc(u.provider || 'email') + '</td>'
        + '<td>' + (u.level != null ? num(u.level) : '—') + '</td>'
        + '<td>' + (u.zone != null ? num(u.zone) : '—') + '</td>'
        + '<td>' + (u.kills != null ? num(u.kills) : '—') + '</td>'
        + '<td class="adm-num">' + (u.spent_cents ? '<b class="gold">' + money(u.spent_cents) + '</b>' : '<span class="dim">—</span>') + '</td>'
        + '<td>' + shortDate(u.joined) + '</td>'
        + '<td>' + ago(u.last_seen) + '</td>'
        + '</tr>';
    }).join('');
  }
  function filterUsers() {
    var q = ($('admUserSearch').value || '').toLowerCase().trim();
    if (!q) return paintUsers(_users);
    paintUsers(_users.filter(function (u) {
      return (u.email || '').toLowerCase().indexOf(q) >= 0 || (u.name || '').toLowerCase().indexOf(q) >= 0;
    }));
  }

  // ---- purchases ------------------------------------------------------------
  function renderPurchases(rows) {
    rows = rows || [];
    if (!rows.length) { $('admOrdersBody').innerHTML = '<tr><td colspan="5" class="adm-empty">No purchases yet — orders appear here the moment a Stripe checkout completes.</td></tr>'; return; }
    var kindLabel = { pack: 'LootCoins', pro: 'Pro · new', pro_renewal: 'Pro · renewal' };
    $('admOrdersBody').innerHTML = rows.map(function (p) {
      return '<tr>'
        + '<td>' + new Date(p.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</td>'
        + '<td>' + esc(p.email || '—') + '</td>'
        + '<td><span class="adm-pill ' + (p.kind === 'pack' ? 'cyan' : 'purple') + '">' + (kindLabel[p.kind] || p.kind) + '</span></td>'
        + '<td>' + (p.credits ? num(p.credits) + ' ◎' : '—') + '</td>'
        + '<td class="adm-num"><b class="gold">' + money(p.amount_cents) + '</b></td>'
        + '</tr>';
    }).join('');
  }

  // ===========================================================================
  // WIRE-UP
  // ===========================================================================
  function wire() {
    if (!$('adminApp')) return;
    $('admGateForm').addEventListener('submit', submitGate);
    $('admClose').addEventListener('click', close);
    $('admGateClose').addEventListener('click', close);
    var trig = $('admTrigger'); if (trig) trig.addEventListener('click', function (e) { e.preventDefault(); open(); });
    $('admRefresh').addEventListener('click', function () {
      var pw = ''; try { pw = sessionStorage.getItem(SS_KEY) || ''; } catch (e) {}
      if (pw) loadAll(pw);
    });
    $('admUserSearch').addEventListener('input', filterUsers);
    var copyBtn = $('admCopySql');
    // load the real setup SQL into the panel (kept in sync with the file on disk)
    var sqlEl = $('admSqlText');
    if (sqlEl) {
      fetch('supabase/admin.sql').then(function (r) { return r.ok ? r.text() : Promise.reject(); })
        .then(function (txt) { sqlEl.textContent = txt; })
        .catch(function () { sqlEl.textContent = '-- Open the file supabase/admin.sql in this project and run it in your Supabase SQL Editor.'; });
    }
    if (copyBtn) copyBtn.addEventListener('click', function () {
      var sql = sqlEl ? sqlEl.textContent : '';
      navigator.clipboard.writeText(sql).then(function () { copyBtn.textContent = 'Copied ✓'; setTimeout(function () { copyBtn.textContent = 'Copy setup SQL'; }, 1600); });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('adminApp').classList.contains('open')) close();
    });
    window.addEventListener('hashchange', function () { if (location.hash === '#admin') open(); });
    window.addEventListener('resize', function () { if (_trafficData) drawChart(_trafficData); });

    if (location.hash === '#admin') open();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();

  window.ADMIN = { open: open, close: close };
})();
