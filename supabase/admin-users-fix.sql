-- =============================================================================
--  admin-users-fix.sql — the Users tab has been blank since it shipped
--  ---------------------------------------------------------------------------
--  ERROR: column reference "user_id" is ambiguous
--
--  CAUSE: admin_users() declares `returns table (user_id uuid, ...)`. In plpgsql
--  every output column becomes a VARIABLE in scope for the whole function body,
--  so the purchases subquery's `group by user_id` is ambiguous between that
--  variable and purchases.user_id. Postgres refuses rather than guessing, and
--  the RPC 500s on every call — which is why the panel showed nothing at all
--  rather than an empty list.
--
--  Two fixes applied together:
--    1. #variable_conflict use_column — inside this function, a bare name means
--       the COLUMN. Safe here: the body is one `return query` and never reads an
--       output parameter as a value.
--    2. The subquery is aliased and fully qualified anyway, so the intent is
--       explicit and doesn't depend on the pragma.
--
--  Also fixed while here: `limit greatest(p_limit, 1)` ignored a caller asking
--  for 0, and there was no cap, so a client could pull every user in one call.
--  Now clamped to 1..500.
--
--  Safe to re-run.
-- =============================================================================

create or replace function public.admin_users(p_pw text, p_limit int default 200, p_offset int default 0)
returns table (
  user_id uuid, email text, joined timestamptz, last_seen timestamptz,
  provider text, name text, level int, zone int, kills bigint,
  credits int, pro_until timestamptz, spent_cents bigint, orders bigint
) language plpgsql security definer set search_path = public, auth as $$
#variable_conflict use_column
begin
  if not admin_ok(p_pw) then raise exception 'unauthorized' using errcode = '28000'; end if;
  return query
  select
    u.id,
    u.email,
    u.created_at,
    u.last_sign_in_at,
    coalesce(u.raw_app_meta_data->>'provider', 'email'),
    coalesce(nullif(s.data->>'name',''), split_part(coalesce(u.email,'operator'),'@',1)),
    nullif(s.data->>'level','')::int,
    nullif(s.data->>'highestDungeonReached','')::int,
    nullif(s.data->>'totalKills','')::bigint,
    w.credits,
    w.pro_until,
    coalesce(p.spent, 0),
    coalesce(p.orders, 0)
  from auth.users u
  left join public.saves   s on s.user_id = u.id
  left join public.wallets w on w.user_id = u.id
  left join (
    select pu.user_id as uid,
           sum(pu.amount_cents) as spent,
           count(*)             as orders
      from public.purchases pu
     where pu.user_id is not null
     group by pu.user_id
  ) p on p.uid = u.id
  order by u.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
end $$;

grant execute on function public.admin_users(text, int, int) to authenticated;

-- ---- CHECK ------------------------------------------------------------------
-- Replace the password with your admin one. Expect one row per registered
-- account, newest first — including anyone with no save yet (nulls, not missing).
--
--   select user_id, email, provider, name, level, spent_cents
--     from admin_users('YOUR_ADMIN_PW', 500, 0);
