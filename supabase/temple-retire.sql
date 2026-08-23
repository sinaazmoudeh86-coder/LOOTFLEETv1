-- =============================================================================
--  temple-retire.sql — REMOVE THE TEMPLE'S SERVER FUNCTIONS       (run once)
-- -----------------------------------------------------------------------------
--  WHY. The Temple was removed from the client in build 711, but only from the
--  CLIENT. Its RPCs are still installed, and `temple_claim()` on this server is
--  the pre-fix version — the one whose UPDATE ... FROM self-join with RETURNING
--  bound a bare `record` instead of a typed jsonb column, so the next
--  `v_item->>'rarity'` raised:
--
--      42883  operator does not exist: record ->> unknown
--
--  That is the error filling the Postgres log several times a minute. The caller
--  is not the live game: nothing in 711+ references the Temple. It is players on
--  a stale cached build, and browsers holding an old service-worker bundle, still
--  polling an arena that no longer exists in the product.
--
--  WHAT THIS DOES. Drops the Temple's FUNCTIONS only. A stale client then gets a
--  clean "function does not exist" (PGRST202), which cloud.js already treats as a
--  degraded rung and stops asking about — instead of a hard error on every call.
--
--  WHAT THIS DELIBERATELY DOES NOT DO. It does not touch a single TABLE.
--  `temple_altar`, `temple_presence` and `temple_claims` hold a record of what
--  players actually did in that arena while it was live, and no code reads them,
--  so there is nothing to gain by deleting them and a real history to lose. Data
--  outlives the feature that wrote it. Drop code freely; never drop the record.
--
--  Safe to re-run.
-- =============================================================================

-- Catalogue lookup rather than a list of signatures: these accumulated overloads
-- over the Temple's life and a `drop function name(args)` that names the wrong
-- argument types silently leaves the broken copy in place — which is exactly how
-- an old definition survived a rewrite and kept throwing.
do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname like 'temple%'
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
    n := n + 1;
    raise notice 'temple-retire: dropped %', r.sig;
  end loop;
  raise notice 'temple-retire: % function(s) removed', n;
end $$;

-- Any trigger that referenced them went with `cascade` above. Confirm nothing
-- named temple* survives in the function catalogue — this must return no rows.
select p.oid::regprocedure as still_present
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
 where ns.nspname = 'public' and p.proname like 'temple%';

-- The tables are intentionally left alone. To confirm they are inert, this shows
-- what is still stored without touching it:
--   select 'temple_claims' t, count(*) from public.temple_claims
--   union all select 'temple_presence', count(*) from public.temple_presence
--   union all select 'temple_altar',    count(*) from public.temple_altar;
