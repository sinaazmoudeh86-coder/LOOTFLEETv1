-- =============================================================================
--  MIGRATION — TERRITORY RELEASE ON ACCOUNT DELETION (Jul 2026) · run once
--  Guarantees a deleted account abandons EVERY tile it holds — My Galaxy and
--  Void Zone alike. Two layers:
--    1) purge any already-orphaned rows (owner no longer exists)
--    2) enforce ON DELETE CASCADE going forward (no-op if the original
--       territory.sql FK already exists)
--  The client also releases its rows before deletion (cloud.js), so tiles
--  free up even if this migration hasn't run yet.
-- =============================================================================
delete from public.territory
  where owner_id is not null
    and owner_id not in (select id from auth.users);

do $$ begin
  alter table public.territory
    add constraint territory_owner_fk
    foreign key (owner_id) references auth.users(id) on delete cascade;
exception
  when duplicate_object then null;   -- cascade FK already present
  when others then null;             -- e.g. legacy FK under another name
end $$;
