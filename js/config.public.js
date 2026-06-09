/* =============================================================================
   config.public.js — Loot Fleet public configuration
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
};
