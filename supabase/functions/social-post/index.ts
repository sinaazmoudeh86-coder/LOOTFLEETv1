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
  const key = Deno.env.get("BUFFER_API_KEY") || "";
  const db = createClient(
    Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SB_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  );

  // ---- discovery mode: list channels so BUFFER_CHANNEL_IDS can be filled ----
  if (new URL(req.url).searchParams.get("channels")) {
    const data = await buffer(key, `query { channels { id service name displayName } }`)
      .catch((e) => ({ error: String(e) }));
    return Response.json(data);
  }

  const channels = (Deno.env.get("BUFFER_CHANNEL_IDS") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!key || !channels.length) return Response.json({ error: "BUFFER_API_KEY / BUFFER_CHANNEL_IDS not configured" }, { status: 500 });

  // ---- due rows, oldest first, small batch ----------------------------------
  const { data: rows, error } = await db.from("social_queue")
    .select("id,slug,caption,image_url,buffer_ids")
    .eq("status", "queued").lte("due_at", new Date().toISOString())
    .order("due_at", { ascending: true }).limit(4);
  if (error) return Response.json({ error: error.message }, { status: 500 });

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
    // Post ~3 minutes out: far enough for Buffer to fetch the image, near
    // enough that the queue's minute is the visible posting minute.
    const dueAt = new Date(Date.now() + 3 * 60 * 1000).toISOString();
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
            assets: [{ image: { url: ${gq(row.image_url)} } }]
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
    report.push({ slug: row.slug, ok, channels: Object.keys(done).length, errs });
  }

  return Response.json({ due: rows?.length ?? 0, report });
});
