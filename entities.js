/* =============================================================================
   config.live.js — Loot Fleet public configuration (renamed from config.public.js so stale service workers can never serve an old copy)
   ---------------------------------------------------------------------------
   Paste your Supabase project credentials here to turn on REAL accounts +
   cloud saves (email/password + Google/Apple/Facebook OAuth, synced across
   devices). Find these in your Supabase dashboard → Project Settings → API.

   The anon/public key is SAFE to ship in the browser (that's what it's for) —
   row-level security on the `saves` table keeps each player's data private.

   Leave both strings empty to run fully local (per-browser accounts).
   ============================================================================= */
window.LOOTFLEET = {
  supabaseUrl:     'https://emldvvlaanyivpmxyylr.supabase.co',
  supabaseAnonKey: 'sb_publishable_IQWzW1tsUf-Rsg9Q55sJrA_RkdNIe6R',
  // Stripe Payment Links (LIVE). Buy buttons activate per-pack the moment a
  // link is present; missing packs politely say "coming soon".
  stripeLinks: {
    lc_25:       'https://buy.stripe.com/7sYdR99C4a7J0ALc0KabK06',
    lc_50:       'https://buy.stripe.com/9B628reWo3JlgzJ9SCabK04',
    lc_75:       'https://buy.stripe.com/5kQaEXeWo6Vx83d2qaabK03',
    lc_100:      'https://buy.stripe.com/dRm3cveWo93F83d5CmabK02',
    pro_monthly: 'https://buy.stripe.com/4gM00jg0s5Rt3MXaWGabK01',
  },
  // Stripe customer portal — subscribers manage/cancel LootFleet Pro here
  stripePortal: 'https://billing.stripe.com/p/login/3cIeVd29CcfR4R14yiabK00',
};
