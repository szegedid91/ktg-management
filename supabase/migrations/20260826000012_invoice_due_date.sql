-- Fizetési határidő a számlákon + alapértelmezett fizetési határidő
-- (számlázástól számított napok) a beállításokban.

alter table public.invoices add column if not exists due_date date;

alter table public.app_settings
  add column if not exists default_payment_days integer not null default 8;
