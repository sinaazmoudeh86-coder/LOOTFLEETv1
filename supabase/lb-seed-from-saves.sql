-- =============================================================================
--  lb-seed-from-saves.sql — the last 15 invisible players          (run once)
--  ---------------------------------------------------------------------------
--  MEASURED, Aug 2026:   saves = 36 rows   ·   leaderboard = 21 rows
--
--  Fifteen accounts have a save file and no board row. lb-onefunction.sql's
--  backfill seeds from `territory` and `sdread_scores` — a player who has never
--  claimed a tile or pushed the Voidmaw is missed by both, so someone who only
--  grinds zones stayed invisible no matter how long they played.
--
--  It is worse than a missing board row. alliance_chat() reads the speaker's
--  name FROM the leaderboard:
--      select name into nm from public.leaderboard where user_id = me;
--  so those fifteen also appear in alliance chat as "Operator".
--
--  This seeds a row for every save, insert-only. power starts at 0 and the row
--  self-corrects within 90 seconds of that player's next login, when their own
--  client publishes real figures over it.
--
--  NAMES: taken from the save's own pilotName first. Only then from Google's
--  profile metadata — the same value the client would publish anyway. It never
--  falls back to the email address; writing email prefixes onto the board is
--  the bug that put "jonathangregg103" and "aytris.tekis" there.
--
--  Safe to re-run.
-- =============================================================================

insert into public.leaderboard (user_id, name, power, level, zone, kills, fleet, updated_at)
select
  s.user_id,
  left(coalesce(
    nullif(btrim(s.data->>'pilotName'), ''),
    nullif(btrim(u.raw_user_meta_data->>'lf_name'), ''),
    nullif(btrim(u.raw_user_meta_data->>'name'), ''),
    nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
    'Operator'
  ), 24),
  0,
  greatest(1, coalesce((s.data->>'level')::int, 1)),
  greatest(1, coalesce((s.data->>'highestUnlocked')::int, 1)),
  0,
  '[]'::jsonb,
  now()
from public.saves s
join auth.users u on u.id = s.user_id
where s.user_id is not null
  -- a save that never got past level 1 is an abandoned first load, not a player
  and coalesce((s.data->>'level')::int, 1) > 1
on conflict (user_id) do nothing;

-- ---- VERIFY -----------------------------------------------------------------
-- Board size — was 21, expect roughly 36:
--   select count(*) from public.leaderboard;
--
-- Anyone with a real save still unlisted (expect zero rows):
--   select s.user_id, s.data->>'level' as lvl
--     from public.saves s
--     left join public.leaderboard l using (user_id)
--    where l.user_id is null
--      and coalesce((s.data->>'level')::int, 1) > 1;
--
-- Nobody should be named after an email address:
--   select name from public.leaderboard where name ~ '^[a-z0-9._%+-]+$' and name ~ '[0-9]{3}';
