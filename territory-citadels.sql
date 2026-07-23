-- =============================================================================
-- saves-guard.sql — STALE-WRITE GUARD for the saves table
-- -----------------------------------------------------------------------------
-- Last line of defense for two sessions pushing the same account's save row
-- (e.g. two browsers where the Realtime kick never arrived). An UPDATE whose
-- payload is meaningfully OLDER than what's stored (lastSave stamp more than
-- 60s behind — grace for clock skew) is silently dropped: the row keeps the
-- newer copy, the stale client's next pull re-merges. Run once in Supabase
-- SQL editor. Safe to re-run.
-- =============================================================================
create or replace function public.saves_reject_stale()
returns trigger language plpgsql as $$
declare
  old_ls numeric; new_ls numeric;
begin
  begin
    old_ls := (old.data->>'lastSave')::numeric;
    new_ls := (new.data->>'lastSave')::numeric;
  exception when others then
    return new;   -- unparseable stamps: never block a write
  end;
  if old_ls is not null and new_ls is not null and new_ls < old_ls - 60000 then
    return old;   -- stale push — keep the newer save, report success
  end if;
  return new;
end $$;

drop trigger if exists saves_reject_stale on public.saves;
create trigger saves_reject_stale
  before update on public.saves
  for each row execute function public.saves_reject_stale();
