// =============================================================================
// digest-build — hourly daily-brief builder  (EMAIL ONLY)
//
// Runs every hour from pg_cron. For each player whose LOCAL send hour is now:
//   1. read their save + yesterday's snapshot
//   2. diff the numbers  → "your fleet"
//   3. drain notify_events → "while you were away"
//   4. attach shared galaxy stats → "the galaxy"
//   5. apply the send-gating rules (§5 of the architecture doc)
//   6. write today's snapshot, then log the outcome
//
// DRY RUN IS THE DEFAULT. With RESEND_API_KEY unset it sends nothing and writes
// status='dryrun' plus the full payload into notify_log — so you can read
// exactly who would have been mailed and what it would have said, at zero cost.
// Set RESEND_API_KEY (and SEND_LIVE=true) to actually deliver.
//
// Deploy:  supabase functions deploy digest-build --no-verify-jwt
// Secrets: supabase secrets set RESEND_API_KEY=... SEND_LIVE=true
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY   = Deno.env.get('RESEND_API_KEY') || '';
const SEND_LIVE    = (Deno.env.get('SEND_LIVE') || '') === 'true' && !!RESEND_KEY;
const FROM         = Deno.env.get('MAIL_FROM') || 'Loot Fleet <brief@mail.lootfleet.com>';
const SITE         = Deno.env.get('SITE_URL') || 'https://lootfleet.com';
const FN_BASE      = `${SUPABASE_URL}/functions/v1`;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ---- the ~12 numbers worth reporting ----------------------------------------
const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);
function snapshot(save: Record<string, any>) {
  const res = save?.resources || {};
  const owned = save?.ownedSystems || {};
  return {
    level:    n(save?.level) || 1,
    gold:     n(save?.gold),
    kills:    n(save?.totalKills),
    zone:     Math.max(n(save?.highestDungeonReached), n(save?.highestUnlocked), 1),
    playTime: n(save?.playTime),
    items:    n(save?.itemsFound),
    fuel:     n(res.fuel), iron: n(res.iron), plasma: n(res.plasma),
    tiles:    Object.keys(owned).length,
    badges:   n(save?.badgeRanks ?? save?.achClaimed),
    vip:      n(save?.vipPts),
  };
}
type Snap = ReturnType<typeof snapshot>;

// ---- what changed, and is any of it worth an email? -------------------------
const KEYS: (keyof Snap)[] = ['level','gold','kills','zone','playTime','items','fuel','iron','plasma','tiles','badges','vip'];
function diff(now: Snap, prev: Snap | null) {
  const d: Record<string, number> = {};
  for (const k of KEYS) {
    const delta = n(now[k]) - n(prev?.[k]);
    if (delta !== 0) d[k] = delta;
  }
  return d;
}
// RULE 3 of the gating list, and the single most important line in this file:
// an empty brief teaches people to ignore the next one.
function worthSending(d: Record<string, number>, events: number) {
  if (events > 0) return true;
  if (n(d.level) > 0 || n(d.zone) > 0 || n(d.tiles) !== 0 || n(d.badges) > 0) return true;
  return n(d.kills) >= 250 || n(d.playTime) >= 900;   // 250 kills or 15 min played
}

async function log(user_id: string, day: string, status: string, reason?: string, payload?: unknown, provider_id?: string) {
  await db.from('notify_log').upsert({
    user_id, kind: 'digest', channel: 'email', day, status,
    reason: reason ?? null, payload: payload ?? null, provider_id: provider_id ?? null,
    at: new Date().toISOString(),
  }, { onConflict: 'user_id,kind,day,channel' });
}

Deno.serve(async (req) => {
  const started = Date.now();
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';   // ignore the hour, for testing
  const only  = url.searchParams.get('user') || '';      // single-user test run

  // shared galaxy block — one query for the whole batch
  let galaxy: unknown = null;
  try { const { data } = await db.rpc('notify_galaxy_stats'); galaxy = data; } catch { /* non-fatal */ }

  const { data: due, error } = await db.rpc('notify_due', { p_limit: force ? 50 : 500 });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const rows = (due || []).filter((r: any) => !only || r.user_id === only);
  const out = { due: rows.length, sent: 0, skipped: 0, failed: 0, dryrun: 0, live: SEND_LIVE };

  for (const r of rows) {
    // "today" is the PLAYER's today, not UTC — the log key must match notify_due
    const localDay = new Date(new Date().toLocaleString('en-US', { timeZone: r.tz || 'UTC' }))
      .toISOString().slice(0, 10);
    try {
      const now = snapshot(r.save || {});
      const prev = (r.prev || null) as Snap | null;

      // snapshot FIRST so tomorrow has a baseline even if this send is skipped
      await db.from('notify_snapshots').upsert(
        { user_id: r.user_id, day: localDay, stats: now }, { onConflict: 'user_id,day' });

      // RULE 2 — played recently? they don't need a recap of right now
      const idleH = (Date.now() - new Date(r.save_at).getTime()) / 3.6e6;
      if (!force && idleH < 4) { out.skipped++; await log(r.user_id, localDay, 'skipped', 'active_recently'); continue; }

      // RULE 4 — long-dormant addresses wreck sender reputation for everyone
      if (idleH > 24 * 60) { out.skipped++; await log(r.user_id, localDay, 'skipped', 'dormant_60d'); continue; }

      const { data: evs } = await db.from('notify_events')
        .select('id,kind,payload,at').eq('user_id', r.user_id).eq('sent', false)
        .order('at', { ascending: true }).limit(20);
      const events = evs || [];

      const d = diff(now, prev);
      if (!force && !worthSending(d, events.length)) {
        out.skipped++; await log(r.user_id, localDay, 'skipped', 'nothing_happened', { diff: d }); continue;
      }

      const brief = {
        day: localDay,
        first: !prev,                       // no baseline yet → welcome-shaped brief
        span_h: prev ? Math.round((Date.now() - new Date(r.prev_day + 'T00:00:00Z').getTime()) / 3.6e6) : 0,
        now, diff: d, events, galaxy,
        unsub: `${FN_BASE}/notify-unsub?t=${r.unsub_token}`,
        play: `${SITE}/game.html`,
      };

      if (!SEND_LIVE) { out.dryrun++; await log(r.user_id, localDay, 'dryrun', null, brief); continue; }

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM, to: r.email,
          subject: subjectFor(brief),
          html: render(brief),
          text: renderText(brief),
          // RFC 8058 one-click unsubscribe — required by Gmail/Yahoo for bulk mail
          headers: {
            'List-Unsubscribe': `<${brief.unsub}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { out.failed++; await log(r.user_id, localDay, 'failed', body?.message || String(res.status), brief); continue; }

      out.sent++;
      await log(r.user_id, localDay, 'sent', null, brief, body?.id);
      if (events.length) {
        await db.from('notify_events').update({ sent: true }).in('id', events.map((e: any) => e.id));
      }
    } catch (e) {
      out.failed++;
      await log(r.user_id, localDay, 'failed', String(e));
    }
  }

  return Response.json({ ok: true, ms: Date.now() - started, ...out });
});

// =============================================================================
// PRESENTATION — placeholder. Copy, tone and layout are the next conversation;
// this is deliberately plain so the plumbing can be verified on its own.
// =============================================================================
const fmt = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(1) + 'T';
  if (a >= 1e9)  return (v / 1e9).toFixed(1) + 'B';
  if (a >= 1e6)  return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e3)  return (v / 1e3).toFixed(1) + 'K';
  return String(Math.round(v));
};
const LABEL: Record<string, string> = {
  level: 'Levels gained', gold: 'Gold earned', kills: 'Ships destroyed', zone: 'Zones unlocked',
  playTime: 'Time flown', items: 'Items found', fuel: 'Fuel', iron: 'Iron', plasma: 'Plasma',
  tiles: 'Systems held', badges: 'Badge ranks', vip: 'VIP points',
};

function subjectFor(b: any) {
  if (b.first) return 'Your fleet report starts today';
  if (b.diff.level) return `Commander — you reached Level ${b.now.level}`;
  if (b.events?.length) return `Fleet report — ${b.events.length} incident${b.events.length > 1 ? 's' : ''} to review`;
  return `Fleet report — ${fmt(b.diff.kills || 0)} kills, ${fmt(b.diff.gold || 0)} gold`;
}

function render(b: any) {
  const rows = Object.entries(b.diff)
    .filter(([k]) => LABEL[k])
    .map(([k, v]) => `<tr><td style="padding:6px 0;color:#9fb1c4;font:14px system-ui">${LABEL[k]}</td>
      <td style="padding:6px 0;text-align:right;font:700 14px system-ui;color:${(v as number) > 0 ? '#2f9e63' : '#c0392b'}">
      ${(v as number) > 0 ? '+' : ''}${k === 'playTime' ? ((v as number) / 3600).toFixed(1) + 'h' : fmt(v as number)}</td></tr>`)
    .join('');
  const evs = (b.events || []).map((e: any) =>
    `<li style="margin:4px 0;color:#3d4a5c;font:14px system-ui">${e.kind}</li>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f4f6f9;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:26px;font-family:system-ui,sans-serif">
  <h1 style="margin:0 0 4px;font-size:19px;color:#131a26">Fleet report</h1>
  <p style="margin:0 0 18px;font-size:13px;color:#7a8798">${b.day}</p>
  ${rows ? `<table style="width:100%;border-collapse:collapse">${rows}</table>` : ''}
  ${evs ? `<h2 style="font-size:14px;margin:20px 0 6px;color:#131a26">While you were away</h2><ul style="padding-left:18px;margin:0">${evs}</ul>` : ''}
  <p style="margin:24px 0 0"><a href="${b.play}" style="display:inline-block;background:#f2b24b;color:#1c1206;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;font-size:14px">Resume command</a></p>
  <p style="margin:22px 0 0;font-size:11px;color:#98a4b4;line-height:1.6">
    You're getting this because you turned on the daily brief in Loot Fleet.<br>
    <a href="${b.unsub}" style="color:#98a4b4">Unsubscribe</a> · Loot Fleet
  </p>
</div></body></html>`;
}

function renderText(b: any) {
  const lines = Object.entries(b.diff).filter(([k]) => LABEL[k])
    .map(([k, v]) => `  ${LABEL[k]}: ${(v as number) > 0 ? '+' : ''}${fmt(v as number)}`);
  return [`FLEET REPORT — ${b.day}`, '', ...lines, '',
    `Resume command: ${b.play}`, `Unsubscribe: ${b.unsub}`].join('\n');
}
