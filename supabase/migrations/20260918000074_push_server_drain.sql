-- Értesítés-küldés szerver oldalról (2026-09-18): az átvilágítás óta a
-- push-dispatch „drain” csak a bejelentkezett felhasználó SAJÁT sorait küldte
-- ki, így aki nem nyitotta meg az appot, nem kapott értesítést. Mostantól:
--  - új sor beszúrásakor trigger hívja a push-dispatch funkciót (pg_net, aszinkron)
--  - 2 percenként pg_cron is meghívja (biztonsági háló)
--  - a hívást a Vaultban tárolt titok (push_cron_secret) azonosítja; a funkció
--    ezt az fn_push_cron_secret() RPC-vel (csak service_role) olvassa ki
create extension if not exists pg_net with schema extensions;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'push_cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'push_cron_secret', 'push-dispatch cron/trigger hívás titka');
  end if;
end $$;

create or replace function public.fn_push_cron_secret()
returns text language sql stable security definer set search_path to 'public' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret';
$$;
revoke all on function public.fn_push_cron_secret() from public, anon, authenticated;
grant execute on function public.fn_push_cron_secret() to service_role;

-- a push-dispatch meghívása (aszinkron; hiba esetén csendben, a cron újrapróbálja)
create or replace function public.fn_push_dispatch_call()
returns void language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_secret text; v_url text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_cron_secret';
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_dispatch_url';
  if v_secret is null or v_url is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{"job":"drain"}'::jsonb,
    timeout_milliseconds := 15000);
exception when others then null;
end $$;
revoke all on function public.fn_push_dispatch_call() from public, anon, authenticated;

create or replace function public.fn_push_dispatch_on_insert()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.fn_push_dispatch_call();
  return null;
end $$;
revoke all on function public.fn_push_dispatch_on_insert() from public, anon, authenticated;
drop trigger if exists trg_push_dispatch_on_insert on public.notification_queue;
create trigger trg_push_dispatch_on_insert after insert on public.notification_queue
  for each statement execute function public.fn_push_dispatch_on_insert();

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'push-drain';
    perform cron.schedule('push-drain', '*/2 * * * *', 'select public.fn_push_dispatch_call()');
  end if;
end $$;
