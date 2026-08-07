-- =============================================================================
--  SIM KILL COUNTS — sanity ceiling                              (run once)
--  ---------------------------------------------------------------------------
--  sim_tick() added kills every hour with no ceiling, so long-lived rows drifted
--  to 10^11 — a number no human account can reach. That single column was what
--  made simulated pilots identifiable at a glance on the Ranks board.
--
--  Kills are now a CAREER stat: 900 per level flown, with each ascension star
--  worth a full 500-level career. A Level 500 pilot tops out near 450k; a
--  three-star veteran near 1.4M — inside the range real players actually hold.
--
--  Enforced by a trigger, so sim_tick / sim_spawn need no edits and can keep
--  adding kills freely; the ceiling is applied on every write.
-- =============================================================================

create or replace function sim_kill_ceiling(p_level int, p_asc int)
returns numeric language sql immutable as $$
  select greatest(1200::numeric,
                  900::numeric * (greatest(1, coalesce(p_level, 1))::numeric
                                  + 500::numeric * greatest(0, coalesce(p_asc, 0))::numeric));
$$;

create or replace function sim_kills_sane() returns trigger
language plpgsql as $$
begin
  new.kills := least(greatest(0::numeric, coalesce(new.kills, 0)::numeric),
                     sim_kill_ceiling(new.level, new.asc_stars));
  return new;
end $$;

drop trigger if exists sim_kills_sane_trg on sim_pilots;
create trigger sim_kills_sane_trg before insert or update on sim_pilots
for each row execute function sim_kills_sane();

-- ---- bring every existing row inside the ceiling ---------------------------
update sim_pilots
   set kills = least(coalesce(kills, 0)::numeric, sim_kill_ceiling(level, asc_stars));

revoke all on function sim_kill_ceiling(int, int) from public;
revoke all on function sim_kills_sane() from public;
