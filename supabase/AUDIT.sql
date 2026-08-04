-- =============================================================================
--  AUDIT.sql — what is actually live?                        (read-only, safe)
--  ---------------------------------------------------------------------------
--  Changes nothing. Run it in the Supabase SQL Editor and send back the result.
--
--  There are 37 migration files in supabase/ and no record of which ones ran.
--  This lists every table, function, column, trigger and scheduled job the game
--  expects, and marks each OK or MISSING.
--
--  Read the STATUS column. Anything that says MISSING or DUPLICATE is a feature
--  that is silently broken in production right now.
-- =============================================================================

with
-- ---- TABLES ----------------------------------------------------------------
want_tables(item) as (values
  ('saves'),('save_conflicts'),('leaderboard'),('wallets'),('territory'),
  ('sdread_scores'),('sim_config'),('sim_pilots'),('purchases'),
  ('alliances'),('alliance_members'),('alliance_chat'),
  ('notify_prefs'),('rank_awards'),('war_events'),('sessions')
),
t as (
  select 'TABLE' as area, w.item,
         case when c.oid is null then 'MISSING' else 'OK' end as status,
         coalesce(c.reltuples::bigint::text || ' rows (est)', '') as detail
  from want_tables w
  left join pg_class c
         on c.relname = w.item
        and c.relnamespace = 'public'::regnamespace
        and c.relkind = 'r'
),

-- ---- FUNCTIONS -------------------------------------------------------------
-- Count matters: TWO copies of the same function is as broken as none, because
-- PostgREST refuses to choose between them. That is the live lb_upsert bug.
want_fns(item) as (values
  ('lb_upsert'),('save_pull'),('save_push'),('claim_session'),('touch_session'),
  ('claim_tile'),('release_tile'),('log_repelled'),
  ('alliance_state'),('alliance_browse'),('alliance_create'),('alliance_join'),
  ('alliance_leave'),('alliance_attack'),('alliance_chat'),('alliance_donate'),
  ('alliance_kick'),('alliance_role'),('alliance_week_add'),('alliance_weekly_board'),
  ('alliance_request_join'),('alliance_request_cancel'),('alliance_request_respond'),
  ('alliance_my_request'),
  ('claim_wallet'),('claim_rank_awards'),('notify_get_prefs'),('notify_save_prefs'),
  ('sim_board'),('sim_tick'),('social_spend'),
  ('admin_users'),('admin_overview'),('lf_clamp_power')
),
f as (
  select 'FUNCTION' as area, w.item,
         case count(p.oid)
           when 0 then 'MISSING'
           when 1 then 'OK'
           else 'DUPLICATE — ' || count(p.oid) || ' overloads, calls will fail'
         end as status,
         coalesce(string_agg(pg_get_function_identity_arguments(p.oid), '  ||  '), '') as detail
  from want_fns w
  left join pg_proc p
         on p.proname = w.item
        and p.pronamespace = 'public'::regnamespace
  group by w.item
),

-- ---- COLUMNS ---------------------------------------------------------------
want_cols(tbl, col) as (values
  ('leaderboard','asc_stars'),('leaderboard','tiles'),('leaderboard','citadels'),
  ('leaderboard','tile_rev'),('leaderboard','ships'),('leaderboard','missions'),
  ('leaderboard','badges'),
  ('territory','citadel'),('territory','citadel_lv'),('territory','fleet_score'),
  ('territory','defense'),('territory','owner_id'),('territory','cooldown_until'),
  ('sdread_scores','season'),('sdread_scores','stage'),('sdread_scores','total'),
  ('sim_config','target_population'),('sim_config','enabled')
),
c as (
  select 'COLUMN' as area, w.tbl || '.' || w.col as item,
         case when a.attname is null then 'MISSING' else 'OK' end as status,
         coalesce(format_type(a.atttypid, a.atttypmod), '') as detail
  from want_cols w
  left join pg_attribute a
         on a.attrelid = to_regclass('public.' || w.tbl)
        and a.attname = w.col
        and a.attnum > 0
        and not a.attisdropped
),

-- ---- TRIGGERS --------------------------------------------------------------
want_trg(item) as (values
  ('trg_lb_seed_territory'),('trg_lb_seed_sdread')
),
g as (
  select 'TRIGGER' as area, w.item,
         case when tg.oid is null then 'MISSING' else 'OK' end as status, '' as detail
  from want_trg w
  left join pg_trigger tg on tg.tgname = w.item and not tg.tgisinternal
),

-- ---- EXTENSIONS + SCHEDULED JOBS ------------------------------------------
e as (
  select 'EXTENSION' as area, w.item,
         case when x.extname is null then 'MISSING' else 'OK' end as status, '' as detail
  from (values ('pg_cron'),('pg_net')) w(item)
  left join pg_extension x on x.extname = w.item
)

-- The sort key is computed INSIDE the union (Postgres will not order a UNION by
-- an expression), then the wrapper orders by that plain column name.
select area, item, status, detail
from (
  select area, item, status, detail,
         case when status like 'MISSING%' then 0
              when status like 'DUPLICATE%' then 1
              else 2 end as sort_rank
  from (
    select area, item, status, detail from t
    union all select area, item, status, detail from f
    union all select area, item, status, detail from c
    union all select area, item, status, detail from g
    union all select area, item, status, detail from e
  ) all_rows
) ranked
order by sort_rank, area, item;

-- =============================================================================
--  RUN THIS SECOND — scheduled jobs live in a different schema and only exist
--  if pg_cron is installed, so they cannot be joined into the query above.
-- =============================================================================
-- select jobname, schedule, active from cron.job order by jobname;
