// =============================================================================
//  social-post — cron-driven auto-poster (Supabase Edge Function)
// -----------------------------------------------------------------------------
//  Drains due rows from public.social_queue and creates the posts in Buffer via
//  its GraphQL API (https://api.buffer.com, createPost). One Buffer post per
//  configured channel per row. Our queue owns the CALENDAR (due_at); Buffer is
//  handed a dueAt a few minutes out, so posts land at the queued minute without
//  depending on Buffer-side queue slots.
//
//  ENV (Edge Function secrets):
//    SB_URL                — the project URL (auto-present as SUPABASE_URL too)
//    SB_SERVICE_KEY        — service role key (queue table is service-only)
//    BUFFER_API_KEY        — from publish.buffer.com/settings/api
//    BUFFER_CHANNEL_IDS    — comma-separated Buffer channel ids to post to
//
//  Invoke ?channels=1 to LIST your Buffer channels (id, service, name) through
//  the same auth — that is how you find the ids for BUFFER_CHANNEL_IDS.
//
//  Schedule: every 15 minutes is plenty (posts are minute-precise via dueAt).
//    select cron.schedule('social-post', '*/15 * * * *', $$
//      select net.http_post(
//        url  := 'https://YOUR-PROJECT.functions.supabase.co/social-post',
//        headers := '{"Authorization": "Bearer YOUR_SERVICE_KEY"}'::jsonb) $$);
//
//  SAFETY RAILS
//  · Row is CLAIMED (status flipped) before Buffer is called — a crashed run
//    can never double-post; it leaves a 'failed' row with the error instead.
//  · At most 4 rows per invocation; our cadence is 2/day, so a backlog drains
//    gently and can never trip Buffer's rate window.
//  · Every channel result is kept in buffer_ids; a partial failure marks the
//    row 'failed' with the per-channel detail but keeps the successes listed,
//    so a retry (flip status back to 'queued') only re-posts what's missing —
//    channels already in buffer_ids are skipped.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const BUFFER_URL = "https://api.buffer.com";
// CORS — lets the local admin helper (social/admin.html) call this from a browser.
// Auth is still required on every call; this only permits the browser to ASK.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

async function buffer(key: string, query: string): Promise<any> {
  const res = await fetch(BUFFER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Buffer HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  if (body.errors?.length) throw new Error(`Buffer GraphQL: ${body.errors[0]?.message || "unknown"}`);
  return body.data;
}

const gq = (s: string) => JSON.stringify(String(s ?? "")); // safe GraphQL string literal

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
  const key = Deno.env.get("BUFFER_API_KEY") || "";

  // ---- discovery mode: list channels so BUFFER_CHANNEL_IDS can be filled ----
  // (needs only the Buffer key — runs even if the DB env is missing/mistyped)
  // Buffer's schema scopes channels to an organization, so: orgs first, then
  // channels per org (shapes from developers.buffer.com examples).
  if (new URL(req.url).searchParams.get("channels")) {
    try {
      const acc = await buffer(key, `query { account { organizations { id name } } }`);
      const orgs = acc?.account?.organizations ?? [];
      const channels: any[] = [];
      for (const o of orgs) {
        const d = await buffer(key, `query { channels(input: { organizationId: ${gq(o.id)} }) { id service name displayName isQueuePaused } }`);
        for (const c of d?.channels ?? []) channels.push({ ...c, organization: o.name });
      }
      return json({ channels });
    } catch (e) { return json({ error: String(e).slice(0, 400) }, 500); }
  }

  // Supabase injects SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY into every Edge
  // Function automatically — validated here so a typo'd name yields a readable
  // error instead of an opaque crash.
  const sbUrl = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL") || "";
  const sbKey = Deno.env.get("SB_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!sbUrl || !sbKey) return json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not available to this function" }, 500);
  const db = createClient(sbUrl, sbKey);

  const channels = (Deno.env.get("BUFFER_CHANNEL_IDS") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!key || !channels.length) return json({ error: "BUFFER_API_KEY / BUFFER_CHANNEL_IDS not configured" }, 500);

  // ---- channel id → service map ---------------------------------------------
  // Facebook REQUIRES a post type in per-network metadata (FacebookPostMetadataInput.type
  // is non-null — the "Facebook posts require a type" error), and Instagram accepts
  // one. The right metadata depends on which network a channel id belongs to, so
  // resolve services fresh each run — no extra secret, and reconnecting a channel
  // in Buffer can never leave a stale mapping.
  const svc: Record<string, string> = {};
  try {
    const acc = await buffer(key, `query { account { organizations { id } } }`);
    for (const o of acc?.account?.organizations ?? []) {
      const d = await buffer(key, `query { channels(input: { organizationId: ${gq(o.id)} }) { id service } }`);
      for (const c of d?.channels ?? []) svc[String(c.id)] = String(c.service || "").toLowerCase();
    }
  } catch (e) { /* metadata falls back to none; Buffer's error will say so */ }
  // enum literals (unquoted). Only networks that need/accept a type are named;
  // everything else posts with no metadata block, exactly as before.
  // A REEL IS NOT A PHOTO POST WITH A MOVING PICTURE IN IT. Facebook and
  // Instagram both route video through a different post type, and sending
  // `type: post` with a video asset is accepted and then published as the wrong
  // surface — a feed video where a reel was intended, with none of the reach.
  // So the type depends on the ROW, not just the channel.
  const metaFor = (ch: string, isVideo: boolean) => {
    const s = svc[ch] || "";
    if (s.startsWith("facebook")) return `metadata: { facebook: { type: ${isVideo ? "reel" : "post"} } }`;
    if (s.startsWith("instagram")) return `metadata: { instagram: { type: ${isVideo ? "reel" : "post"} } }`;
    return "";
  };
  // Buffer's asset union. A video asset carries its own poster frame: without
  // one the network picks a frame itself, and on a cold open — which is the
  // whole point of these cuts — the frame it picks is a dark starfield.
  const assetFor = (row: any) => row.video_url
    ? `assets: [{ video: { url: ${gq(row.video_url)}${row.thumb_url ? `, thumbnail: { url: ${gq(row.thumb_url)} }` : ""} } }]`
    : `assets: [{ image: { url: ${gq(row.image_url)} } }]`;

  // ---- due rows, oldest first, small batch ----------------------------------
  const { data: rows, error } = await db.from("social_queue")
    .select("id,slug,caption,image_url,video_url,thumb_url,buffer_ids")
    .eq("status", "queued").lte("due_at", new Date().toISOString())
    .order("due_at", { ascending: true }).limit(4);
  if (error) return json({ error: error.message }, 500);

  const report: any[] = [];
  for (const row of rows ?? []) {
    // CLAIM FIRST — flip out of 'queued' before any network call so a crash
    // mid-row can never replay it on the next cron tick.
    const claim = await db.from("social_queue")
      .update({ status: "failed", error: "claimed — in flight" })
      .eq("id", row.id).eq("status", "queued").select("id");
    if (claim.error || !claim.data?.length) continue;   // raced another run

    const done: Record<string, string> = (row.buffer_ids as any) || {};
    const errs: string[] = [];
    // Post far enough out for Buffer to FETCH AND TRANSCODE the asset, near
    // enough that the queue's minute is the visible posting minute. Three
    // minutes is ample for a 200KB PNG and not remotely enough for a 15s 1080p
    // video — Buffer downloads it, transcodes per network, and only then
    // schedules. A video that is not ready at dueAt is silently dropped by the
    // network, which looks exactly like a post that never existed.
    const isVideo = !!row.video_url;
    const dueAt = new Date(Date.now() + (isVideo ? 12 : 3) * 60 * 1000).toISOString();
    for (const ch of channels) {
      if (done[ch]) continue;                            // already posted on a prior attempt
      try {
        const data = await buffer(key, `mutation {
          createPost(input: {
            text: ${gq(row.caption)}
            channelId: ${gq(ch)}
            schedulingType: automatic
            mode: customScheduled
            dueAt: ${gq(dueAt)}
            ${assetFor(row)}
            ${metaFor(ch, isVideo)}
          }) {
            ... on PostActionSuccess { post { id } }
            ... on MutationError { message }
          }
        }`);
        const out = data?.createPost;
        if (out?.post?.id) done[ch] = out.post.id;
        else errs.push(`${ch}: ${out?.message || "no post id returned"}`);
      } catch (e) { errs.push(`${ch}: ${String(e).slice(0, 200)}`); }
    }

    const ok = !errs.length;
    await db.from("social_queue").update({
      status: ok ? "posted" : "failed",
      posted_at: ok ? new Date().toISOString() : null,
      buffer_ids: done,
      error: ok ? null : errs.join(" | ").slice(0, 900),
    }).eq("id", row.id);
    report.push({ slug: row.slug, kind: isVideo ? "video" : "image", ok, channels: Object.keys(done).length, errs });
  }

  return json({ due: rows?.length ?? 0, report });
  } catch (e) {
    // NEVER an opaque crash: every failure comes back as JSON with CORS intact,
    // so the setup helper can display it instead of "Failed to fetch".
    return json({ error: String(e).slice(0, 400) }, 500);
  }
});
