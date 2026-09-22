-- Díjmódosítás visszamenőleg (2026-09-22, Daniel kérése): ha a munkavállaló
-- kiszállási díja / órabére / napi díja / projektdíja / jutaléka, vagy a
-- Beállítások alapértelmezett díjai változnak, a KI NEM FIZETETT, munkaidőből
-- képzett napok újraszámolódnak az új díjjal. A kifizetett napok nem változnak,
-- a kézzel rögzített napok sem.

create or replace function public.fn_recalc_worker_unpaid(p_worker uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if p_worker is null then return; end if;
  perform set_config('app.allow_paid_tick', 'on', true);
  -- a díj-pillanatkép törlődik, hogy az aktuális díj oldódjon fel újra
  update public.attendance set applied_rate = null
  where worker_id = p_worker and source = 'session' and paid_at is null and deleted_at is null and pay_basis <> 'presence';
  for r in select distinct a.site_id, a.work_date from public.attendance a
           where a.worker_id = p_worker and a.source = 'session' and a.paid_at is null and a.deleted_at is null
  loop
    perform public.fn_recalc_session_wage(p_worker, r.site_id, r.work_date);
  end loop;
end $$;
revoke all on function public.fn_recalc_worker_unpaid(uuid) from public, anon, authenticated;

create or replace function public.fn_workers_rate_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.callout_fee is distinct from old.callout_fee
     or new.hourly_rate is distinct from old.hourly_rate
     or new.daily_rate is distinct from old.daily_rate
     or new.project_rate is distinct from old.project_rate
     or new.default_pay_basis is distinct from old.default_pay_basis
     or new.worker_type is distinct from old.worker_type
     or new.commission_mode is distinct from old.commission_mode
     or new.commission_value is distinct from old.commission_value
     or new.commission_unit is distinct from old.commission_unit then
    perform public.fn_recalc_worker_unpaid(new.id);
  end if;
  return null;
end $$;
revoke all on function public.fn_workers_rate_change() from public, anon, authenticated;
drop trigger if exists trg_workers_rate_change on public.workers;
create trigger trg_workers_rate_change after update on public.workers
  for each row execute function public.fn_workers_rate_change();

create or replace function public.fn_app_settings_rate_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.company_callout_fee is distinct from old.company_callout_fee
     or new.individual_callout_fee is distinct from old.individual_callout_fee
     or new.company_hourly_rate is distinct from old.company_hourly_rate
     or new.individual_hourly_rate is distinct from old.individual_hourly_rate
     or new.company_daily_rate is distinct from old.company_daily_rate
     or new.individual_daily_rate is distinct from old.individual_daily_rate
     or new.company_project_rate is distinct from old.company_project_rate
     or new.individual_project_rate is distinct from old.individual_project_rate then
    for r in select distinct a.worker_id from public.attendance a
             where a.source = 'session' and a.paid_at is null and a.deleted_at is null
    loop
      perform public.fn_recalc_worker_unpaid(r.worker_id);
    end loop;
  end if;
  return null;
end $$;
revoke all on function public.fn_app_settings_rate_change() from public, anon, authenticated;
drop trigger if exists trg_app_settings_rate_change on public.app_settings;
create trigger trg_app_settings_rate_change after update on public.app_settings
  for each row execute function public.fn_app_settings_rate_change();
