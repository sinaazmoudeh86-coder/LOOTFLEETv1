-- =============================================================================
--  casino-citadels.sql — THE THREE HOUSE CITADELS
--  ---------------------------------------------------------------------------
--  Three holds sit above the Space Casino. Hold one and you take 1% of EVERY
--  player's net losses to the house that day — server-wide, all five currencies,
--  LootCoins included. Three citadels = 3% of the day's take leaves the house.
--
--  WHY THE POOL IS SERVER-SIDE: the client is authoritative for its own save, so
--  a client-computed "1% of everyone's losses" would be trivially forged and
--  couldn't see other players at all. Each client reports only its OWN net
--  losses; the server sums them into a day row and pays from that.
--
--  DELIVERY: mail lives in the player's save, so the server cannot write it
--  directly. Instead the payout writes a row here, and the client claims it on
--  next load and posts its own mail with a claimable prize. casino_payouts.paid
--  makes that exactly-once.
-- =============================================================================

-- ---- the three holds --------------------------------------------------------
create table if not exists public.casino_citadels (
  id            int primary key check (id between 1 and 3),
  name          text not null,
  -- SHARE OF THE DAILY POOL, in percent. Deliberately unequal: 1 / 2 / 3 so the
  -- three holds are not interchangeable and the Craps Bastion is the one worth
  -- starting a war over. 6% of the day's losses leaves the house in total.
  share_pct     numeric not null default 1,
  -- LEVEL GATE, same shape as the Void Zone's tiered spires. Paired with the
  -- share ladder so the richest hold is also the deepest: 1%@100, 2%@300, 3%@500.
  req_lv        int not null default 100,
  owner         uuid references auth.users(id) on delete set null,
  owner_name    text,
  shield_until  timestamptz,          -- 24h attack shield, same rule as void spires
  claimed_at    timestamptz,
  last_paid_day date
);
insert into public.casino_citadels (id, name, share_pct, req_lv) values
  (1, 'The Blackjack Hold', 1, 100), (2, 'The Roulette Spire', 2, 300), (3, 'The Craps Bastion', 3, 500)
on conflict (id) do nothing;
-- existing installs: add the columns and backfill both ladders
alter table public.casino_citadels add column if not exists share_pct numeric not null default 1;
alter table public.casino_citadels add column if not exists req_lv int not null default 100;
update public.casino_citadels set share_pct = id where share_pct is distinct from id;
update public.casino_citadels set req_lv = (case id when 1 then 100 when 2 then 300 else 500 end)
 where req_lv is distinct from (case id when 1 then 100 when 2 then 300 else 500 end);

alter table public.casino_citadels enable row level security;
drop policy if exists casino_citadels_read on public.casino_citadels;
create policy casino_citadels_read on public.casino_citadels for select using (true);

-- ---- the daily loss pool ----------------------------------------------------
-- One row per UTC day. Clients add their own net losses; nobody can read another
-- player's individual figures, only the pooled total.
create table if not exists public.casino_day_losses (
  day      date primary key default (now() at time zone 'utc')::date,
  gold     numeric not null default 0,
  credits  numeric not null default 0,
  fuel     numeric not null default 0,
  iron     numeric not null default 0,
  plasma   numeric not null default 0,
  hands    bigint  not null default 0,
  players  int     not null default 0
);
alter table public.casino_day_losses enable row level security;
drop policy if exists casino_day_read on public.casino_day_losses;
create policy casino_day_read on public.casino_day_losses for select using (true);

-- who has already contributed today (so `players` is a real count, not a sum of ticks)
create table if not exists public.casino_day_players (
  day date not null, user_id uuid not null, primary key (day, user_id)
);
alter table public.casino_day_players enable row level security;

-- ---- payouts owed -----------------------------------------------------------
create table if not exists public.casino_payouts (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  citadel    int  not null,
  citadel_nm text not null,
  share_pct  numeric not null default 1,
  gold       numeric not null default 0,
  credits    numeric not null default 0,
  fuel       numeric not null default 0,
  iron       numeric not null default 0,
  plasma     numeric not null default 0,
  pool_hands bigint  not null default 0,
  paid       boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, day, citadel)
);
alter table public.casino_payouts enable row level security;
drop policy if exists casino_payouts_own on public.casino_payouts;
create policy casino_payouts_own on public.casino_payouts for select using (auth.uid() = user_id);
alter table public.casino_payouts add column if not exists share_pct numeric not null default 1;

-- ---- report my losses -------------------------------------------------------
-- Called by the client with the DELTA it has not yet reported. Values are
-- clamped non-negative; a client cannot subtract from the pool.
create or replace function public.casino_report_loss(
  p_gold numeric default 0, p_credits numeric default 0, p_fuel numeric default 0,
  p_iron numeric default 0, p_plasma numeric default 0, p_hands int default 0)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); d date := (now() at time zone 'utc')::date; fresh boolean;
begin
  if me is null then raise exception 'not authenticated'; end if;
  insert into public.casino_day_players(day, user_id) values (d, me)
    on conflict do nothing;
  fresh := found;
  insert into public.casino_day_losses(day) values (d) on conflict (day) do nothing;
  update public.casino_day_losses set
    gold    = gold    + greatest(0, coalesce(p_gold,0)),
    credits = credits + greatest(0, coalesce(p_credits,0)),
    fuel    = fuel    + greatest(0, coalesce(p_fuel,0)),
    iron    = iron    + greatest(0, coalesce(p_iron,0)),
    plasma  = plasma  + greatest(0, coalesce(p_plasma,0)),
    hands   = hands   + greatest(0, coalesce(p_hands,0)),
    players = players + (case when fresh then 1 else 0 end)
  where day = d;
end; $$;
grant execute on function public.casino_report_loss(numeric,numeric,numeric,numeric,numeric,int) to authenticated;

-- ---- board state ------------------------------------------------------------
create or replace function public.casino_citadel_state()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cits jsonb; pool jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'share_pct', share_pct, 'req_lv', req_lv,
    'owner_name', owner_name,
    'mine', (owner is not null and owner = me),
    'held', owner is not null,
    'shield_left', greatest(0, floor(extract(epoch from (shield_until - now()))))::int
  ) order by id), '[]'::jsonb) into cits from public.casino_citadels;
  select to_jsonb(t) into pool from (
    select gold, credits, fuel, iron, plasma, hands, players
    from public.casino_day_losses where day = (now() at time zone 'utc')::date) t;
  return jsonb_build_object('citadels', cits, 'pool', coalesce(pool, '{}'::jsonb),
                            'total_pct', (select sum(share_pct) from public.casino_citadels));
end; $$;
grant execute on function public.casino_citadel_state() to authenticated;

-- ---- claim / take a hold ----------------------------------------------------
-- Unowned: claim it. Held by someone else: only once their 24h shield has run
-- out. Taking one always re-arms the shield for the new holder.
create or replace function public.casino_citadel_claim(p_id int, p_name text, p_level int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); row public.casino_citadels; held int;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into row from public.casino_citadels where id = p_id for update;
  if row.id is null then raise exception 'no such citadel'; end if;
  if coalesce(p_level,0) < row.req_lv then
    raise exception 'requires level %', row.req_lv; end if;
  if row.owner = me then raise exception 'you already hold this citadel'; end if;
  if row.owner is not null and row.shield_until is not null and row.shield_until > now()
    then raise exception 'shielded'; end if;
  -- one hold per pilot: three citadels in one pair of hands is not a turf war
  select count(*) into held from public.casino_citadels where owner = me;
  if held >= 1 then raise exception 'you already hold a house citadel'; end if;
  update public.casino_citadels
     set owner = me, owner_name = left(coalesce(p_name,'Operator'),24),
         shield_until = now() + interval '24 hours', claimed_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'name', row.name);
end; $$;
grant execute on function public.casino_citadel_claim(int, text, int) to authenticated;
drop function if exists public.casino_citadel_claim(int, text);

create or replace function public.casino_citadel_abandon(p_id int)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  update public.casino_citadels set owner = null, owner_name = null, shield_until = null, claimed_at = null
   where id = p_id and owner = me;
end; $$;
grant execute on function public.casino_citadel_abandon(int) to authenticated;

-- ---- the daily payout -------------------------------------------------------
-- Run once a day after midnight UTC (pg_cron). Pays each holder 1% of the
-- PREVIOUS day's pooled losses. Whoever holds the citadel when this runs takes
-- the day — deliberately not pro-rated, because pro-rating rewards sniping the
-- hold seconds before reset.
create or replace function public.casino_daily_payout()
returns int language plpgsql security definer set search_path = public as $$
declare d date := ((now() at time zone 'utc')::date - 1); p record; c record; n int := 0; pct numeric;
begin
  select * into p from public.casino_day_losses where day = d;
  if p.day is null then return 0; end if;
  for c in select * from public.casino_citadels where owner is not null and coalesce(last_paid_day, '1970-01-01') < d loop
    pct := coalesce(c.share_pct, 1) / 100.0;    -- 1%, 2% or 3% depending on the hold
    insert into public.casino_payouts(user_id, day, citadel, citadel_nm, share_pct, gold, credits, fuel, iron, plasma, pool_hands)
    values (c.owner, d, c.id, c.name, coalesce(c.share_pct, 1),
            floor(p.gold * pct), floor(p.credits * pct), floor(p.fuel * pct),
            floor(p.iron * pct), floor(p.plasma * pct), p.hands)
    on conflict (user_id, day, citadel) do nothing;
    update public.casino_citadels set last_paid_day = d where id = c.id;
    -- announce it in the war feed so the Discord report picks it up
    insert into public.war_events(kind, meta) values ('casino', jsonb_build_object(
      'citadel', c.name, 'owner', c.owner_name, 'day', d, 'share_pct', coalesce(c.share_pct, 1),
      'gold', floor(p.gold * pct), 'credits', floor(p.credits * pct),
      'fuel', floor(p.fuel * pct), 'iron', floor(p.iron * pct), 'plasma', floor(p.plasma * pct),
      'pool_gold', p.gold, 'pool_credits', p.credits, 'hands', p.hands, 'players', p.players));
    n := n + 1;
  end loop;
  return n;
end; $$;
grant execute on function public.casino_daily_payout() to authenticated;

-- ---- claim the mail ---------------------------------------------------------
create or replace function public.casino_payouts_pending()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(to_jsonb(t) order by (t->>'id')::bigint)
    from (select id, day, citadel, citadel_nm, share_pct, gold, credits, fuel, iron, plasma, pool_hands
          from public.casino_payouts where user_id = me and not paid) t), '[]'::jsonb);
end; $$;
grant execute on function public.casino_payouts_pending() to authenticated;

create or replace function public.casino_payout_ack(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.casino_payouts set paid = true where id = p_id and user_id = auth.uid();
end; $$;
grant execute on function public.casino_payout_ack(bigint) to authenticated;

-- ---- schedule ---------------------------------------------------------------
-- 00:10 UTC, after daily_ranks_award() at 00:05.
select cron.schedule('casino-daily-payout', '10 0 * * *', $$select public.casino_daily_payout();$$)
where not exists (select 1 from cron.job where jobname = 'casino-daily-payout');


-- =============================================================================
--  BIG BETS — immediate Discord callouts
--  ---------------------------------------------------------------------------
--  A notable round is announced the moment it settles. RATE LIMITED server-side:
--  one post per pilot per 90 seconds, UNLESS the new round is at least double the
--  last one posted. Without that a whale grinding 10k-a-hand blackjack would
--  bury the channel in a minute, and the callout would stop meaning anything.
-- =============================================================================
create table if not exists public.casino_big_last (
  user_id uuid primary key references auth.users(id) on delete cascade,
  at      timestamptz not null default now(),
  score   numeric not null default 0        -- the significance score last posted
);
alter table public.casino_big_last enable row level security;

create or replace function public.casino_big_bet(
  p_game text, p_cur text, p_stake numeric, p_net numeric, p_tier text, p_score numeric, p_name text)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); prev public.casino_big_last;
begin
  if me is null then return false; end if;
  if coalesce(p_score,0) <= 0 then return false; end if;
  select * into prev from public.casino_big_last where user_id = me;
  if prev.user_id is not null
     and prev.at > now() - interval '90 seconds'
     and coalesce(p_score,0) < prev.score * 2
    then return false; end if;
  insert into public.casino_big_last(user_id, at, score) values (me, now(), coalesce(p_score,0))
    on conflict (user_id) do update set at = now(), score = coalesce(p_score,0);
  insert into public.war_events(kind, actor_name, meta) values ('bigbet',
    left(coalesce(p_name,'A pilot'),24),
    jsonb_build_object('game', p_game, 'cur', p_cur, 'stake', p_stake,
                       'net', p_net, 'tier', p_tier, 'score', p_score));
  return true;
end; $$;
grant execute on function public.casino_big_bet(text,text,numeric,numeric,text,numeric,text) to authenticated;
