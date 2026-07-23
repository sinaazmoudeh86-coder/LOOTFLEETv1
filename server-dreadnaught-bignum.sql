-- =============================================================================
--  MIGRATION — LEADERBOARD BIG NUMBERS (Jul 2026) · RUN ONCE, safe to re-run
--  Player power crossed the Sp/No/Dc tiers (>9.2e18) and OVERFLOWED bigint:
--  every lb_upsert returned 400 and the global board froze. power/kills
--  become NUMERIC end-to-end (same fix the Voidmaw boards already got).
-- =============================================================================
alter table public.leaderboard
  alter column power type numeric using power::numeric,
  alter column kills type numeric using kills::numeric;

drop function if exists public.lb_upsert(text, bigint, int, int, bigint, jsonb);
drop function if exists public.lb_upsert(text, numeric, int, int, numeric, jsonb);
create or replace function public.lb_upsert(
  p_name text, p_power numeric, p_level int, p_zone int, p_kills numeric, p_fleet jsonb
) returns public.leaderboard
language plpgsql security definer set search_path = public as $$
declare result public.leaderboard;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.leaderboard (user_id, name, power, level, zone, kills, fleet, updated_at)
  values (auth.uid(), coalesce(nullif(p_name,''),'Operator'),
          greatest(0,coalesce(p_power,0)), greatest(1,coalesce(p_level,1)),
          greatest(1,coalesce(p_zone,1)), greatest(0,coalesce(p_kills,0)),
          coalesce(p_fleet,'[]'::jsonb), now())
  on conflict (user_id) do update set
     name=excluded.name, power=excluded.power, level=excluded.level,
     zone=excluded.zone, kills=excluded.kills, fleet=excluded.fleet, updated_at=now()
  returning * into result;
  return result;
end; $$;
grant execute on function public.lb_upsert(text, numeric, int, int, numeric, jsonb) to authenticated;
