// supabase/functions/delete-account/index.ts
// Deletes the CALLING user's auth record + all their rows. Deploy with:
//   supabase functions deploy delete-account
// Requires no extra config: uses the project's service-role key from env.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // identify the caller from their JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "not signed in" }), { status: 401, headers: cors });

    // service-role client: wipe rows, then the auth user itself
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    for (const table of ["saves", "leaderboard", "wallets"]) {
      try { await admin.from(table).delete().eq("user_id", user.id); } catch (_) { /* table may not exist */ }
    }
    await admin.auth.admin.deleteUser(user.id);
    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
