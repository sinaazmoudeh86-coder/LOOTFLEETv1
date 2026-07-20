-- LOOT FLEET — territory release (run ONCE, idempotent). Lets a player ABANDON
-- a tile they own: the row is deleted so the zone goes neutral for everyone.
create or replace function public.release_tile(p_tile_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.territory where tile_id = p_tile_id and owner_id = auth.uid();
end; $$;
grant execute on function public.release_tile(text) to authenticated;
-- fallback path used by older clients: allow direct owner deletes
do $$ begin
  create policy territory_owner_delete on public.territory for delete using (owner_id = auth.uid());
exception when duplicate_object then null; end $$;
