-- =============================================================================
--  Loot Fleet — SERVER DREADNAUGHT: BIG-NUMBER FIX (run once, safe to re-run)
--  Supabase → SQL Editor → New query → paste → Run.
--
--  Endgame damage exceeds bigint (max ≈9.2e18) — players past ~9 quintillion
--  damage failed to publish with "invalid input syntax for type bigint", so
--  their rows never appeared / stopped updating on the event leaderboards.
--  numeric has no such ceiling.
-- =============================================================================

alter table public.sdread_scores
  alter column best_day type numeric using best_day::numeric,
  alter column total    type numeric using total::numeric;

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
