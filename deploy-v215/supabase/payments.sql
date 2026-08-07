-- =============================================================================
--  Loot Fleet — PAYMENTS fulfilment (run AFTER schema.sql)
--  Dashboard → SQL Editor → New query → paste → Run.
--
--  Creates:
--    wallets           pending LootCoins + Pro expiry per player
--    stripe_customers  maps Stripe customer ids → players (Pro renewals)
--    grant_credits / grant_pro   called by the stripe-webhook Edge Function
--    claim_wallet      called by the GAME on login — atomically moves pending
--                      coins into the player's session and zeroes the wallet
-- =============================================================================

create table if not exists public.wallets (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  credits    integer not null default 0,
  pro_until  timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.wallets enable row level security;
drop policy if exists "wallets_select_own" on public.wallets;
create policy "wallets_select_own" on public.wallets
  for select using (auth.uid() = user_id);
-- NOTE: no insert/update policies — only the service role (webhook) writes.

create table if not exists public.stripe_customers (
  customer_id text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.stripe_customers enable row level security;
-- no policies at all: service-role-only table.

-- ---- webhook write paths (service role calls these) -------------------------
create or replace function public.grant_credits(p_user uuid, p_credits integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.wallets (user_id, credits, updated_at)
  values (p_user, p_credits, now())
  on conflict (user_id) do update
    set credits = wallets.credits + excluded.credits, updated_at = now();
end $$;

create or replace function public.grant_pro(p_user uuid, p_days integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.wallets (user_id, pro_until, updated_at)
  values (p_user, now() + make_interval(days => p_days), now())
  on conflict (user_id) do update
    set pro_until = greatest(coalesce(wallets.pro_until, now()), now())
                    + make_interval(days => p_days),
        updated_at = now();
end $$;

-- lock the grant fns away from clients
revoke execute on function public.grant_credits(uuid, integer) from public, anon, authenticated;
revoke execute on function public.grant_pro(uuid, integer) from public, anon, authenticated;

-- ---- client claim path -------------------------------------------------------
-- Atomically returns pending coins (zeroing them) + current pro_until.
create or replace function public.claim_wallet()
returns table (credits integer, pro_until timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_credits integer; v_pro timestamptz;
begin
  select w.credits, w.pro_until into v_credits, v_pro
    from public.wallets w where w.user_id = auth.uid() for update;
  if not found then
    return query select 0, null::timestamptz; return;
  end if;
  if v_credits > 0 then
    update public.wallets set credits = 0, updated_at = now()
      where user_id = auth.uid();
  end if;
  return query select coalesce(v_credits, 0), v_pro;
end $$;
grant execute on function public.claim_wallet() to authenticated;
