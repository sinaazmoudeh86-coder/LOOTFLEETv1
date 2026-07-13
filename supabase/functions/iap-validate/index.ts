// =============================================================================
//  iap-validate — Supabase Edge Function (Deno)
//  Verifies native in-app purchases with Apple / Google, dedupes them, and
//  credits the player's wallet (grant_credits / grant_pro). The game then
//  collects via claim_wallet — the same fulfilment path Stripe uses.
//
//  CALLER: js/payments-v91.js posts
//    { platform:'ios'|'android', productId, transactionId,
//      purchaseToken (google), receipt (apple base64 app receipt) }
//  with the player's Supabase JWT in the Authorization header — that JWT is
//  how the backend knows WHICH player to credit. Never trust a uid in the body.
//
//  DEPLOY (Dashboard → Edge Functions → Deploy new function):
//    Name: iap-validate · paste this file · keep "Verify JWT" ON.
//  SECRETS (Edge Functions → iap-validate → Secrets):
//    APPLE_SHARED_SECRET     App Store Connect → App → In-App Purchases →
//                            App-Specific Shared Secret
//    GOOGLE_SERVICE_ACCOUNT  full JSON key of a service account that has
//                            "View financial data" on the Play app
//    ANDROID_PACKAGE_NAME    e.g. com.lootfleet.app
//  RESPONSES: {ok:true,...} granted · {duplicate:true} already granted ·
//             {invalid:true} bad receipt · 4xx/5xx retryable errors
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// store product id → what it grants. BOTH platforms' ids listed.
const PRODUCTS: Record<string, { credits?: number; proDays?: number }> = {
  // iOS (App Store Connect)
  "com.lootfleet.lc_25":          { credits: 25000 },
  "com.lootfleet.lc_50":          { credits: 50000 },
  "com.lootfleet.lc_75":          { credits: 75000 },
  "com.lootfleet.lc_100_v2":      { credits: 100000 },
  "com.lootfleet.pro_monthly_v2": { proDays: 31 },
  // Android (Play Console)
  "lc_25":       { credits: 25000 },
  "lc_50":       { credits: 50000 },
  "lc_75":       { credits: 75000 },
  "lc_100":      { credits: 100000 },
  "pro_monthly": { proDays: 31 },
};

// ---------- Apple: verifyReceipt (prod first, sandbox on 21007) --------------
async function verifyApple(receipt: string, productId: string, transactionId: string | null) {
  const body = JSON.stringify({
    "receipt-data": receipt,
    password: Deno.env.get("APPLE_SHARED_SECRET") ?? "",
    "exclude-old-transactions": true,
  });
  const post = (url: string) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body })
      .then((r) => r.json());
  let res = await post("https://buy.itunes.apple.com/verifyReceipt");
  if (res.status === 21007) res = await post("https://sandbox.itunes.apple.com/verifyReceipt");
  if (res.status !== 0) return { invalid: true as const };
  const txs = [
    ...(res.latest_receipt_info ?? []),
    ...((res.receipt && res.receipt.in_app) ?? []),
  ].filter((t: any) => t.product_id === productId);
  if (!txs.length) return { invalid: true as const };
  // prefer the exact transaction the client saw; else the newest
  const tx =
    txs.find((t: any) => t.transaction_id === transactionId) ??
    txs.sort((a: any, b: any) => (+b.purchase_date_ms || 0) - (+a.purchase_date_ms || 0))[0];
  const expiresMs = tx.expires_date_ms ? +tx.expires_date_ms : null;
  if (expiresMs && expiresMs < Date.now()) return { invalid: true as const }; // lapsed sub
  return { dedupeId: `apple:${tx.transaction_id}`, expiresMs };
}

// ---------- Google: androidpublisher with service-account OAuth --------------
function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function googleAccessToken(): Promise<string | null> {
  try {
    const sa = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT") ?? "{}");
    if (!sa.client_email || !sa.private_key) return null;
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      iat: now, exp: now + 3600,
    }));
    const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
    const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
    );
    const sig = new Uint8Array(await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`),
    ));
    const jwt = `${header}.${claims}.${b64url(sig)}`;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });
    const j = await res.json();
    return j.access_token ?? null;
  } catch { return null; }
}
async function verifyGoogle(productId: string, purchaseToken: string, isSub: boolean) {
  const token = await googleAccessToken();
  if (!token) return { error: true as const };
  const pkg = Deno.env.get("ANDROID_PACKAGE_NAME") ?? "";
  const kind = isSub ? "subscriptions" : "products";
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/purchases/${kind}/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404 || res.status === 400) return { invalid: true as const };
  if (!res.ok) return { error: true as const };
  const j = await res.json();
  if (isSub) {
    const expiresMs = j.expiryTimeMillis ? +j.expiryTimeMillis : null;
    if (!expiresMs || expiresMs < Date.now()) return { invalid: true as const };
    return { dedupeId: `google:${j.orderId ?? purchaseToken}`, expiresMs };
  }
  if (j.purchaseState !== 0) return { invalid: true as const }; // 0 = purchased
  return { dedupeId: `google:${j.orderId ?? purchaseToken}`, expiresMs: null };
}

// ------------------------------- handler -------------------------------------
Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405 });

  // WHO to credit — from the caller's verified Supabase JWT, never the body
  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userData, error: userErr } = await supa.auth.getUser(
    authHeader.replace(/^Bearer\s+/i, ""),
  );
  const uid = userData?.user?.id;
  if (userErr || !uid) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const { platform, productId, transactionId, purchaseToken, receipt } = body ?? {};
  const grant = PRODUCTS[productId as string];
  if (!grant || (platform !== "ios" && platform !== "android")) {
    return Response.json({ invalid: true, error: "unknown product" }, { status: 200 });
  }

  // verify with the store
  let v: { dedupeId?: string; expiresMs?: number | null; invalid?: true; error?: true };
  if (platform === "ios") {
    if (!receipt) return Response.json({ invalid: true, error: "no receipt" }, { status: 200 });
    v = await verifyApple(receipt, productId, transactionId ?? null);
  } else {
    if (!purchaseToken) return Response.json({ invalid: true, error: "no purchaseToken" }, { status: 200 });
    v = await verifyGoogle(productId, purchaseToken, !!grant.proDays);
  }
  if (v.error) return Response.json({ error: "store verification unavailable" }, { status: 502 });
  if (v.invalid || !v.dedupeId) return Response.json({ invalid: true }, { status: 200 });

  // DEDUPE — insert first; a replayed receipt hits the primary key and grants nothing
  const proDays = grant.proDays
    ? (v.expiresMs ? Math.max(1, Math.ceil((v.expiresMs - Date.now()) / 864e5)) : grant.proDays)
    : null;
  const { data: row, error: insErr } = await supa
    .from("iap_transactions")
    .insert({
      id: v.dedupeId, user_id: uid, platform,
      product_id: productId, credits: grant.credits ?? null, pro_days: proDays,
    })
    .select("id")
    .maybeSingle();
  if (insErr || !row) return Response.json({ ok: false, duplicate: true }, { status: 200 });

  // GRANT
  if (grant.credits) {
    const { error } = await supa.rpc("grant_credits", { p_user: uid, p_credits: grant.credits });
    if (error) return Response.json({ error: "grant failed" }, { status: 500 });
    return Response.json({ ok: true, credits: grant.credits });
  }
  const { error } = await supa.rpc("grant_pro", { p_user: uid, p_days: proDays });
  if (error) return Response.json({ error: "grant failed" }, { status: 500 });
  return Response.json({ ok: true, proDays });
});
