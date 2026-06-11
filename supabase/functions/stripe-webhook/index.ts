// =============================================================================
//  stripe-webhook — Supabase Edge Function (Deno)
//  Receives Stripe events and credits player wallets automatically.
//
//  DEPLOY (Supabase Dashboard, no CLI needed):
//    1. Dashboard → Edge Functions → Deploy a new function
//       Name: stripe-webhook  ·  paste this file as index.ts
//       IMPORTANT: turn OFF "Verify JWT" (Stripe calls it unauthenticated;
//       security comes from the Stripe signature check below).
//    2. Edge Functions → stripe-webhook → Secrets, add:
//         STRIPE_SECRET_KEY      sk_live_...   (Stripe → Developers → API keys)
//         STRIPE_WEBHOOK_SECRET  whsec_...     (created in step 3)
//       (SUPABASE_URL / SERVICE_ROLE_KEY are injected automatically.)
//    3. Stripe → Developers → Webhooks → Add endpoint
//         URL:    https://<project-ref>.supabase.co/functions/v1/stripe-webhook
//         Events: checkout.session.completed, invoice.paid
//       Copy the signing secret → save as STRIPE_WEBHOOK_SECRET (step 2).
//    4. Buy a pack with Stripe's test card (test-mode link) or a real one —
//       coins appear in-game within seconds of the purchase.
// =============================================================================
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// amount paid (cents) → LootCoins  — keep in sync with PACKS in js/payments.js
const PACKS: Record<number, number> = {
  2500: 25000,    // $25
  5000: 52500,    // $50
  7500: 82500,    // $75
  10000: 115000,  // $100
};
const PRO_DAYS = 31;

Deno.serve(async (req) => {
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, sig!, Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
    );
  } catch {
    return new Response("bad signature", { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      const uid = s.client_reference_id; // set by the game's buy() call
      if (!uid) return new Response("no user ref", { status: 200 });

      if (s.mode === "subscription") {
        // LootFleet Pro signup: first month + remember the customer for renewals
        if (s.customer) {
          await supa.from("stripe_customers").upsert({
            customer_id: String(s.customer), user_id: uid,
          });
        }
        await supa.rpc("grant_pro", { p_user: uid, p_days: PRO_DAYS });
      } else {
        const credits = PACKS[s.amount_total ?? 0] ?? 0;
        if (credits > 0) {
          await supa.rpc("grant_credits", { p_user: uid, p_credits: credits });
        }
      }
    }

    if (event.type === "invoice.paid") {
      const inv = event.data.object as Stripe.Invoice;
      // ONLY renewals — the first invoice is covered by checkout.session.completed
      if (inv.billing_reason === "subscription_cycle" && inv.customer) {
        const { data } = await supa.from("stripe_customers")
          .select("user_id").eq("customer_id", String(inv.customer)).maybeSingle();
        if (data?.user_id) {
          await supa.rpc("grant_pro", { p_user: data.user_id, p_days: PRO_DAYS });
        }
      }
    }
  } catch (e) {
    // let Stripe retry on transient failures
    return new Response("error: " + (e as Error).message, { status: 500 });
  }
  return new Response("ok", { status: 200 });
});
