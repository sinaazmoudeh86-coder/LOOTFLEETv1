-- =============================================================================
--  iap.sql — native IAP fulfilment (run AFTER payments.sql in the SQL Editor)
--
--  Creates iap_transactions: one row per validated Apple/Google transaction.
--  The iap-validate Edge Function INSERTs here BEFORE granting; the primary
--  key makes replaying the same receipt a harmless no-op, so a transaction
--  can never credit twice (dedupe requirement).
-- =============================================================================
create table if not exists public.iap_transactions (
  id          text primary key,          -- 'apple:<transaction_id>' | 'google:<orderId|token>'
  user_id     uuid not null references auth.users(id) on delete cascade,
  platform    text not null,             -- 'ios' | 'android'
  product_id  text not null,             -- store product id as validated
  credits     integer,                   -- coins granted (null for pro)
  pro_days    integer,                   -- pro days granted (null for coins)
  created_at  timestamptz not null default now()
);
alter table public.iap_transactions enable row level security;
-- no policies: service-role-only table (the Edge Function writes with the
-- service key; clients never read or write it directly)
