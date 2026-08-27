-- Építkezés törlése bármelyik fél által + 30 napos adatmegőrzés:
--  - delete_site RPC: bárki (nem csak a létrehozó) törölhet; a többi
--    partner értesítést kap, hogy a költségek/bevételek 30 napig még
--    megmaradnak, utána véglegesen törlődnek.
--  - fn_purge_deleted_sites: a 30+ napja törölt építkezések költségeit,
--    számláit és jelenléteit törli (soft delete — a tükrök szinkronnal
--    értesülnek, az audit napló megmarad); pg_cron futtatja naponta.

alter table public.notification_queue drop constraint notification_queue_kind_check;
alter table public.notification_queue add constraint notification_queue_kind_check
  check (kind in ('comment', 'big_expense', 'weekly', 'overdue', 'share_change', 'site_deleted'));

create or replace function public.delete_site(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_name text;
  v_deleter text;
  r record;
begin
  if v_me is null then raise exception 'Bejelentkezés szükséges.'; end if;
  if not exists (select 1 from public.profiles where id = v_me) then
    raise exception 'Nincs jogosultságod.';
  end if;

  select name into v_name from public.sites where id = p_id and deleted_at is null;
  if v_name is null then raise exception 'Az építkezés nem található.'; end if;

  update public.sites set deleted_at = now(), updated_at = now() where id = p_id;

  select display_name into v_deleter from public.profiles where id = v_me;
  for r in select id from public.profiles where not is_admin and id <> v_me loop
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('site_deleted', r.id, 'Építkezés törölve 🗑️',
            coalesce(v_deleter, 'A partnered') || ' törölte a(z) „' || v_name
            || '” építkezést. A hozzá tartozó költségek és bevételek 30 napig még megmaradnak és beleszámítanak az elszámolásba, utána véglegesen törlődnek.',
            jsonb_build_object('site_id', p_id));
  end loop;
end;
$$;

create or replace function public.fn_purge_deleted_sites()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_site record;
  v_count integer := 0;
begin
  -- a lezárt-építkezés-őr (fn_check_site_open) frissítésre ezzel a
  -- jelzéssel átengedi a takarítást lezárt építkezésen is
  perform set_config('app.allow_paid_tick', 'on', true);

  for v_site in
    select id from public.sites
    where deleted_at is not null and deleted_at < now() - interval '30 days'
  loop
    update public.expenses set deleted_at = now(), updated_at = now()
    where site_id = v_site.id and deleted_at is null;
    update public.invoices set deleted_at = now(), updated_at = now()
    where site_id = v_site.id and deleted_at is null;
    update public.attendance set deleted_at = now(), updated_at = now()
    where site_id = v_site.id and deleted_at is null;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- csak a rendszer futtathatja (cron), közvetlen REST-hívás nem
revoke execute on function public.fn_purge_deleted_sites() from public, anon, authenticated;

-- napi futtatás pg_cronnal (ha elérhető)
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('purge-deleted-sites')
  where exists (select 1 from cron.job where jobname = 'purge-deleted-sites');
  perform cron.schedule('purge-deleted-sites', '15 3 * * *',
    'select public.fn_purge_deleted_sites()');
exception when others then
  raise notice 'pg_cron nem elérhető — a takarítást ütemezni kell: select public.fn_purge_deleted_sites();';
end $$;
