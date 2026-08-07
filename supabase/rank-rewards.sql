-- =============================================================================
--  rank-rewards.sql — daily top-100 payouts + the Discord day-reset digest
--  ---------------------------------------------------------------------------
--  At 00:05 UTC every day this snapshots all six Ranks ladders, records an
--  award for each of the top 100, and queues one Discord digest carrying the
--  top 5 of each board.
--
--  WHY AWARDS ARE RECORDED, NOT DELIVERED
--  Mail lives in the player's SAVE (state.mail), not in a table — there is no
--  server-side inbox to write into. So the cron writes `rank_awards` rows and
--  the client drains them into mail on its next login via claim_rank_awards().
--  A player who doesn't log in for a week collects seven days of mail at once,
--  and nothing is lost.
--
--  SIMULATED PILOTS CANNOT WIN
--  Awards are computed from `leaderboard`, which only real accounts write to;
--  sims live in `sim_pilots` and are blended in client-side for display only.
--  So the humans-only guarantee is structural, not a filter that could be
--  forgotten. Note the consequence: your in-game rank (which counts sims) can
--  differ from your award rank (which does not). The mail says "among
--  operators" so the difference reads as intentional.
--
--  Safe to re-run.
-- =============================================================================

-- ---- 1. LEDGER --------------------------------------------------------------
create table if not exists public.rank_awards (
  id         bigserial primary key,
  day        date   not null,
  board      text   not null,          -- power | tiles | voidmaw | ships | missions | badges
  user_id    uuid   not null,
  rank       int    not null,
  value      numeric not null default 0,
  lc         int    not null default 0,
  delivered  boolean not null default false,
  created_at timestamptz not null default now(),
  unique (day, board, user_id)         -- one award per pilot per board per day
);
create index if not exists rank_awards_undelivered
  on public.rank_awards (user_id) where not delivered;

alter table public.rank_awards enable row level security;
revoke all on public.rank_awards from anon, authenticated;

-- ---- 2. THE PRIZE LADDER ----------------------------------------------------
-- Tuning lives here, as data. Daily and repeatable, so deliberately modest —
-- a top-10 finish across several boards should feel like a good day, not a
-- payday that makes playing pointless.
create or replace function public.rank_prize(p_rank int)
returns int language sql immutable as $$
  select case
    when p_rank =  1 then 500
    when p_rank <= 3 then 300
    when p_rank <= 10 then 150
    when p_rank <= 25 then 75
    when p_rank <= 50 then 40
    when p_rank <= 100 then 20
    else 0 end;
$$;

-- ---- 3. THE DAILY RUN -------------------------------------------------------
create or replace function public.daily_ranks_award(p_day date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d date := coalesce(p_day, (now() at time zone 'utc')::date - 1);
  n_awards int := 0;
  digest jsonb := '[]'::jsonb;
  b record;
begin
  -- Already run for this day? Do nothing. The cron can fire twice, a manual
  -- catch-up can overlap it, and neither double-pays.
  if exists (select 1 from rank_awards where day = d) then
    return jsonb_build_object('ok', true, 'skipped', 'already awarded', 'day', d);
  end if;

  -- Each board as (user_id, name, value), ranked desc. Voidmaw comes from
  -- sdread_scores; the rest from leaderboard columns.
  for b in
    select * from (values
      ('power',    'FLEET POWER'),
      ('tiles',    'TERRITORY'),
      ('voidmaw',  'VOIDMAW'),
      ('ships',    'HANGAR'),
      ('missions', 'MISSIONS'),
      ('badges',   'BADGES')
    ) as t(id, label)
  loop
    with src as (
      select user_id, name, value from (
        select l.user_id, l.name,
               case b.id
                 when 'power'    then l.power::numeric
                 when 'tiles'    then l.tile_rev
                 when 'ships'    then l.ships::numeric
                 when 'missions' then l.missions::numeric
                 when 'badges'   then l.badges::numeric
                 else 0 end as value
          from leaderboard l
         where b.id in ('power','tiles','ships','missions','badges')
        union all
        select s.user_id, s.name, s.stage::numeric
          from sdread_scores s
         where b.id = 'voidmaw' and s.user_id is not null
      ) q
      where value > 0
    ),
    ranked as (
      select user_id, name, value,
             row_number() over (order by value desc, user_id) as rk
        from src
    ),
    ins as (
      insert into rank_awards (day, board, user_id, rank, value, lc)
      select d, b.id, user_id, rk, value, rank_prize(rk::int)
        from ranked where rk <= 100 and rank_prize(rk::int) > 0
      on conflict (day, board, user_id) do nothing
      returning 1
    )
    select coalesce((select count(*) from ins), 0) into n_awards;

    -- top 5 for the Discord digest
    digest := digest || jsonb_build_array(jsonb_build_object(
      'id', b.id, 'label', b.label,
      'top', coalesce((
        select jsonb_agg(jsonb_build_object('name', name, 'value', value) order by rk)
          from (select name, value, rk from (
                  select l.name,
                         case b.id
                           when 'power'    then l.power::numeric
                           when 'tiles'    then l.tile_rev
                           when 'ships'    then l.ships::numeric
                           when 'missions' then l.missions::numeric
                           when 'badges'   then l.badges::numeric
                           else 0 end as value,
                         row_number() over (order by case b.id
                           when 'power'    then l.power::numeric
                           when 'tiles'    then l.tile_rev
                           when 'ships'    then l.ships::numeric
                           when 'missions' then l.missions::numeric
                           when 'badges'   then l.badges::numeric
                           else 0 end desc) as rk
                    from leaderboard l
                   where b.id in ('power','tiles','ships','missions','badges')
                  union all
                  select s.name, s.stage::numeric,
                         row_number() over (order by s.stage desc)
                    from sdread_scores s where b.id = 'voidmaw'
                ) z where rk <= 5 and value > 0) y
      ), '[]'::jsonb)
    ));
  end loop;

  -- Queue the digest for the Discord feed to drain on its next 2-minute tick.
  insert into war_events (kind, tile_id, actor_name, meta)
  values ('digest', null, to_char(d, 'YYYY-MM-DD'),
          jsonb_build_object('day', to_char(d, 'YYYY-MM-DD'), 'boards', digest));

  return jsonb_build_object('ok', true, 'day', d,
    'awards', (select count(*) from rank_awards where day = d));
end $$;

revoke all on function public.daily_ranks_award(date) from public;

-- ---- 4. THE CLIENT'S CLAIM --------------------------------------------------
-- Returns everything owed to the caller and marks it delivered in one shot, so
-- a double-tap or a second tab can't mail the same prize twice.
create or replace function public.claim_rank_awards()
returns table (day date, board text, rank int, value numeric, lc int)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  return query
  with taken as (
    update rank_awards a set delivered = true
     where a.user_id = auth.uid() and not a.delivered
     returning a.day, a.board, a.rank, a.value, a.lc
  )
  select * from taken order by day desc, lc desc;
end $$;

grant execute on function public.claim_rank_awards() to authenticated;

-- ---- 5. SCHEDULE ------------------------------------------------------------
-- 00:05 UTC, awarding the day that just ended.
select cron.unschedule('lf-daily-ranks')
  where exists (select 1 from cron.job where jobname = 'lf-daily-ranks');

select cron.schedule('lf-daily-ranks', '5 0 * * *',
  $CRON$ select public.daily_ranks_award() $CRON$);

-- ---- CHECKS -----------------------------------------------------------------
-- Run it now for yesterday (safe — it no-ops if that day is already awarded):
--   select daily_ranks_award();
--
-- Who won what:
--   select board, rank, lc, value, user_id from rank_awards
--    where day = (now() at time zone 'utc')::date - 1 order by board, rank;
--
-- Is it scheduled?
--   select jobname, schedule, active from cron.job where jobname = 'lf-daily-ranks';
--
-- Undo a day (lets it re-run):
--   delete from rank_awards where day = 'YYYY-MM-DD';
