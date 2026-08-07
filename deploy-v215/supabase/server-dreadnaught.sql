-- =============================================================================
--  Loot Fleet — SERVER DREADNAUGHT (Season leaderboards, real cross-account)
--  Run in Supabase: Dashboard → SQL Editor → New query → Run. Safe to re-run.
--
--  One row per operator per season. The client publishes after every event run
--  via sdread_upsert (identity is always auth.uid()); the two boards read:
--    DAILY  — where season+day match, ranked by best_day (best single run)
--    SEASON — where season matches,   ranked by total (cumulative damage)
--  Same self-reported trust model as `leaderboard`/`saves`.
-- =============================================================================

create table if not exists public.sdread_scores (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text   not null default 'Operator',
  season     int    not null default 1,
  day        int    not null default 0,          -- UTC day index of best_day
  best_day   numeric not null default 0,         -- best single run that day
  total      numeric not null default 0,         -- season cumulative damage
  stage      int    not null default 1,
  updated_at timestamptz not null default now()
);
create index if not exists sdread_daily_idx  on public.sdread_scores (season, day, best_day desc);
create index if not exists sdread_season_idx on public.sdread_scores (season, total desc);

alter table public.sdread_scores enable row level security;

-- Everyone can READ the boards …
drop policy if exists "sdread_read" on public.sdread_scores;
create policy "sdread_read" on public.sdread_scores for select using (true);

-- … writes only via the function below (owner is always auth.uid()).
-- Server-side guards: best_day resets when the day changes, otherwise only
-- climbs; total and stage only climb (a stale client can never wipe progress).
drop function if exists public.sdread_upsert(text, int, int, bigint, bigint, int);
drop function if exists public.sdread_upsert(text, int, int, numeric, numeric, int);
create or replace function public.sdread_upsert(
  p_name text, p_season int, p_day int, p_best numeric, p_total numeric, p_stage int
) returns public.sdread_scores
language plpgsql security definer set search_path = public as $$
declare result public.sdread_scores;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.sdread_scores (user_id, name, season, day, best_day, total, stage, updated_at)
  values (auth.uid(), coalesce(nullif(p_name,''),'Operator'),
          greatest(1,coalesce(p_season,1)), greatest(0,coalesce(p_day,0)),
          greatest(0,coalesce(p_best,0)), greatest(0,coalesce(p_total,0)),
          greatest(1,coalesce(p_stage,1)), now())
  on conflict (user_id) do update set
     name   = excluded.name,
     season = excluded.season,
     best_day = case
        when sdread_scores.season <> excluded.season then excluded.best_day
        when sdread_scores.day = excluded.day then greatest(sdread_scores.best_day, excluded.best_day)
        else excluded.best_day end,
     day    = excluded.day,
     total  = case when sdread_scores.season <> excluded.season
                   then excluded.total
                   else greatest(sdread_scores.total, excluded.total) end,
     stage  = case when sdread_scores.season <> excluded.season
                   then excluded.stage
                   else greatest(sdread_scores.stage, excluded.stage) end,
     updated_at = now()
  returning * into result;
  return result;
end; $$;
grant execute on function public.sdread_upsert(text, int, int, numeric, numeric, int) to authenticated;
