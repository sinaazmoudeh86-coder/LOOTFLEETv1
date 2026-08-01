-- =============================================================================
--  MIGRATION — ASCENSION STARS: BACKFILL + KEEP IN SYNC FROM THE SAVE
--  (Jul 2026) · RUN ONCE, safe to re-run, no flag day.
--
--  SYMPTOM: the #1 pilot (FrostSkull) has multiple ascensions but the Ranks
--  board shows no stars next to him, while simulated pilots below him show
--  theirs correctly.
--
--  CAUSE: `leaderboard.asc_stars` was only ever written by that player's OWN
--  client, via the optional p_asc argument on lb_upsert. Two ways that silently
--  leaves a real pilot at 0 forever:
--    • While both lb_upsert overloads existed (6-arg from leaderboard.sql,
--      7-arg from pilot-ascension.sql) the client's p_asc call could fail, and
--      cloud.js then latches `_lbNoAsc` and publishes the 6-arg row — which
--      does not touch asc_stars — for the next 6 hours.
--    • A pilot who ascended on a build older than the p_asc publish never sent
--      the value at all.
--  Either way NOTHING backfills it: the row keeps 0 until that specific client
--  happens to publish a successful 7-arg call. Sims were unaffected because
--  sim_board() reads sim_pilots.asc_stars, which the server itself maintains.
--
--  FIX: stop trusting the client for this. `saves.data->'pasc'->>'stars'` is the
--  authoritative count (game-v93.js pilotAscend() increments it), so:
--    1. backfill every existing leaderboard row from its save, and
--    2. add a trigger on `saves` so every future save keeps asc_stars current
--       even if the client never sends p_asc.
--  Stars still never regress — both paths use greatest().
--
--  Run AFTER lb-upsert-canonical.sql.
-- =============================================================================

alter table leaderboard add column if not exists asc_stars smallint not null default 0;

-- ---- 1. one-off backfill from every existing save --------------------------
update public.leaderboard l
   set asc_stars = greatest(
         l.asc_stars,
         least(32767, greatest(0, coalesce(
           nullif(s.data #>> '{pasc,stars}', '')::numeric, 0)))::smallint)
  from public.saves s
 where s.user_id = l.user_id
   and coalesce(nullif(s.data #>> '{pasc,stars}', '')::numeric, 0) > l.asc_stars;

-- ---- 2. keep it in sync on every save --------------------------------------
create or replace function public._lb_sync_asc()
returns trigger language plpgsql security definer set search_path = public as $$
declare n smallint;
begin
  n := least(32767, greatest(0, coalesce(
         nullif(new.data #>> '{pasc,stars}', '')::numeric, 0)))::smallint;
  if n > 0 then
    update public.leaderboard
       set asc_stars = greatest(asc_stars, n)
     where user_id = new.user_id and asc_stars < n;
  end if;
  return new;
exception when others then return new;   -- never let a bad save blob block a save
end $$;

drop trigger if exists trg_lb_sync_asc on public.saves;
create trigger trg_lb_sync_asc
  after insert or update of data on public.saves
  for each row execute function public._lb_sync_asc();

revoke all on function public._lb_sync_asc() from public;

-- ---- verify -----------------------------------------------------------------
-- Top 10 with the stars the SAVE claims, so a mismatch is obvious at a glance:
--
--   select l.name, l.power, l.asc_stars,
--          (s.data #>> '{pasc,stars}') as stars_in_save
--     from public.leaderboard l
--     left join public.saves s on s.user_id = l.user_id
--    order by l.power desc limit 10;
--
-- After this migration those two columns must agree for every human row.
