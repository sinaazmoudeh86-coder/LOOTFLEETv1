-- =============================================================================
--  payments-dedupe.sql — webhook idempotency (run once in SQL Editor)
--  Each Stripe event id is recorded the first time it's processed; retries and
--  manual resends of the same event become harmless no-ops.
-- =============================================================================
create table if not exists public.stripe_events (
  id           text primary key,
  type         text,
  processed_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
-- no policies: service-role-only table
