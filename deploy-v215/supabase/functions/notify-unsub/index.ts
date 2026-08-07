// =============================================================================
// notify-unsub — one-click unsubscribe endpoint
//
// Two callers, both unauthenticated by design:
//   • GET  ?t=<token>  — a human clicking the footer link → HTML confirmation
//   • POST ?t=<token>  — Gmail/Yahoo one-click (RFC 8058) → 200, no body
//
// Deploy: supabase functions deploy notify-unsub --no-verify-jwt
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const SITE = Deno.env.get('SITE_URL') || 'https://lootfleet.com';

const page = (title: string, body: string) => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#0d1220;color:#eaf0fa;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px">
<div style="max-width:420px;text-align:center">
  <div style="font-size:34px">☄</div>
  <h1 style="font-size:20px;margin:10px 0 8px">${title}</h1>
  <p style="font-size:14px;line-height:1.6;color:#9fb1c4;margin:0 0 20px">${body}</p>
  <a href="${SITE}/game.html" style="display:inline-block;background:#f2b24b;color:#1c1206;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;font-size:14px">Back to Loot Fleet</a>
</div></body></html>`;

Deno.serve(async (req) => {
  const t = new URL(req.url).searchParams.get('t') || '';
  const ok = t ? (await db.rpc('notify_unsub', { p_token: t })).data?.ok === true : false;

  // one-click clients only care about the status code
  if (req.method === 'POST') return new Response(null, { status: ok ? 200 : 400 });

  return new Response(
    ok ? page('Unsubscribed', 'You won\'t get the fleet report any more. You can switch it back on any time in <b>Account &amp; Settings</b> — your progress is untouched.')
       : page('Link expired', 'That unsubscribe link is no longer valid. You can turn the fleet report off directly in <b>Account &amp; Settings</b>.'),
    { status: ok ? 200 : 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
});
