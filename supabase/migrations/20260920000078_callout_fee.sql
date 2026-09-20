-- Kiszállási díj (2026-09-20, Daniel kérése): minden helyszínre történő
-- bejelentkezés (munkavállaló × helyszín × nap) kiszállási díjat ér.
--  - munkavállalónként állítható (workers.callout_fee, Ft)
--  - alapértelmezés a díjazási beállításokban (cég / magánszemély)
--  - ha sehol nincs megadva: 1 óra bére (az érvényes órabér)
--  - 2026-09-20-tól érvényes; a korábbi napok bére nem változik
--  - a közvetítői díj a kiszállási díjra nem vonatkozik
alter table public.workers add column if not exists callout_fee numeric(14,2) check (callout_fee is null or callout_fee >= 0);
alter table public.app_settings add column if not exists company_callout_fee numeric(14,2) check (company_callout_fee is null or company_callout_fee >= 0);
alter table public.app_settings add column if not exists individual_callout_fee numeric(14,2) check (individual_callout_fee is null or individual_callout_fee >= 0);
alter table public.attendance add column if not exists callout_fee numeric(14,2) not null default 0 check (callout_fee >= 0);

-- a munkavállalói nézet (workers_v) bővítése az új oszloppal (csak a teljes jogú olvasónak)
do $$ declare d text; begin
  d := pg_get_viewdef('public.workers_v'::regclass);
  if position('callout_fee' in d) = 0 then
    d := replace(d, E'    w.contractor_id\n   FROM', E'    w.contractor_id,\n        CASE WHEN f."full" THEN w.callout_fee ELSE NULL::numeric END AS callout_fee\n   FROM');
    if position('callout_fee' in d) = 0 then raise exception 'workers_v: beszúrási pont nem található'; end if;
    execute 'create or replace view public.workers_v with (security_barrier=true, security_invoker=false) as ' || d;
  end if;
end $$;

create or replace function public.fn_worker_callout_fee(p_worker uuid)
returns numeric language plpgsql stable security definer set search_path to 'public' as $$
declare w public.workers%rowtype; s public.app_settings%rowtype; v numeric;
begin
  select * into w from public.workers where id = p_worker;
  select * into s from public.app_settings where id = 1;
  v := coalesce(w.callout_fee, case when w.worker_type = 'company' then s.company_callout_fee else s.individual_callout_fee end);
  if v is null then -- nincs megadva sehol: 1 óra bére
    v := coalesce(w.hourly_rate, case when w.worker_type = 'company' then s.company_hourly_rate else s.individual_hourly_rate end, 0);
  end if;
  return greatest(coalesce(v, 0), 0);
end $$;
revoke all on function public.fn_worker_callout_fee(uuid) from public, anon, authenticated;

create or replace function public.fn_attendance_compute()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  w public.workers%rowtype;
  s public.app_settings%rowtype;
  v_rate numeric(14,2);
  v_base numeric(14,2);
begin
  select * into w from public.workers where id = new.worker_id;
  select * into s from public.app_settings where id = 1;

  -- munkás-csere: a közvetítő-pillanatkép az ÚJ munkásról készül újra
  if tg_op = 'UPDATE' and new.worker_id is distinct from old.worker_id then
    new.referrer_user_id := w.referrer_user_id;
    new.referrer_external_id := w.referrer_external_id;
  end if;

  -- díj feloldása: tétel-felülírás > munkavállalói díj > globális alapértelmezés
  if new.applied_rate is null then
    if new.pay_basis = 'hourly' then
      v_rate := coalesce(w.hourly_rate, case when w.worker_type = 'company' then s.company_hourly_rate else s.individual_hourly_rate end);
    elsif new.pay_basis = 'daily' then
      v_rate := coalesce(w.daily_rate, case when w.worker_type = 'company' then s.company_daily_rate else s.individual_daily_rate end);
    elsif new.pay_basis = 'project' then
      v_rate := coalesce(w.project_rate, case when w.worker_type = 'company' then s.company_project_rate else s.individual_project_rate end);
    else
      v_rate := 0;
    end if;
    new.applied_rate := v_rate;
  end if;

  -- alapbér (kiszállási díj nélkül)
  v_base := case new.pay_basis
    when 'hourly'  then round(new.applied_rate * coalesce(new.hours, 0), 2)
    when 'daily'   then round(new.applied_rate * new.day_multiplier, 2)
    when 'project' then new.applied_rate
    else 0
  end;
  v_base := greatest(v_base, 0);

  -- közvetítő pillanatkép a munkavállalóról (csak ha a tételen még nincs)
  if new.referrer_user_id is null and new.referrer_external_id is null then
    new.referrer_user_id := w.referrer_user_id;
    new.referrer_external_id := w.referrer_external_id;
  end if;

  -- közvetítői díj: az ALAPBÉR része (osztódik, nem adódik hozzá); a kiszállási díjra nem jár
  new.commission_amount := 0;
  if (new.referrer_user_id is not null or new.referrer_external_id is not null)
     and w.commission_mode is not null and new.pay_basis <> 'presence' then
    if w.commission_mode = 'percent' then
      new.commission_amount := round(v_base * coalesce(w.commission_value, 0) / 100.0, 2);
    else -- fix összeg
      new.commission_amount := case w.commission_unit
        when 'hour'    then round(coalesce(w.commission_value, 0) * coalesce(new.hours, 0), 2)
        when 'day'     then round(coalesce(w.commission_value, 0) * new.day_multiplier, 2)
        when 'project' then case when new.pay_basis = 'project' then coalesce(w.commission_value, 0) else 0 end
        else 0
      end;
    end if;
    new.commission_amount := greatest(0, least(new.commission_amount, v_base));
  end if;

  -- bérköltség = alapbér + kiszállási díj (jelenlét-sornál nincs díj)
  new.callout_fee := case when new.pay_basis = 'presence' then 0 else greatest(coalesce(new.callout_fee, 0), 0) end;
  new.amount := v_base + new.callout_fee;

  return new;
end;
$function$;
revoke all on function public.fn_attendance_compute() from public, anon, authenticated;

create or replace function public.fn_recalc_session_wage(p_worker uuid, p_site uuid, p_date date)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  w public.workers%rowtype;
  v_hours numeric := 0;
  v_basis text;
  v_task uuid;
  v_owner uuid;
  v_row public.attendance%rowtype;
  v_fee numeric := 0;
  v_note text;
begin
  if p_worker is null or p_site is null or p_date is null then return; end if;
  select * into w from public.workers where id = p_worker;
  if not found then return; end if;

  select coalesce(sum(extract(epoch from (s.ended_at - s.started_at)) / 3600.0), 0),
         (array_agg(s.task_id) filter (where s.task_id is not null))[1]
    into v_hours, v_task
  from public.work_sessions s
  left join public.worker_tasks t on t.id = s.task_id
  where s.worker_id = p_worker and s.site_id = p_site and s.deleted_at is null
    and s.ended_at is not null
    and (s.started_at at time zone 'Europe/Budapest')::date = p_date
    and (t.id is null or t.quote_accepted_at is null);
  -- minden megkezdett óra teljes óra
  v_hours := least(ceil(round(v_hours, 4)), 16); -- napi plafon: egy nap legfeljebb 16 óra

  select * into v_row from public.attendance
  where worker_id = p_worker and site_id = p_site and work_date = p_date
    and source = 'session' and deleted_at is null;

  perform set_config('app.allow_paid_tick', 'on', true);

  if v_hours <= 0 then
    if v_row.id is not null and v_row.paid_at is null then
      begin
        update public.attendance set deleted_at = now() where id = v_row.id;
      exception when others then raise notice 'session wage delete skipped: %', sqlerrm; end;
    end if;
    return;
  end if;

  if exists (select 1 from public.attendance where worker_id = p_worker and site_id = p_site
             and work_date = p_date and source = 'manual' and deleted_at is null) then
    return;
  end if;
  if v_row.id is null then
    -- a partner által törölt automatikus sor: csak akkor éled újra, ha a törlés
    -- UTÁN rögzítettek új munkamenetet (különben a törlés szándékos marad)
    select * into v_row from public.attendance
    where worker_id = p_worker and site_id = p_site and work_date = p_date and source = 'session'
      and deleted_at is not null and paid_at is null
    order by deleted_at desc limit 1;
    if v_row.id is not null then
      if exists (select 1 from public.work_sessions s where s.worker_id = p_worker and s.site_id = p_site and s.deleted_at is null
                 and (s.started_at at time zone 'Europe/Budapest')::date = p_date and s.created_at > v_row.deleted_at) then
        update public.attendance set deleted_at = null where id = v_row.id;
        v_row.deleted_at := null;
      else
        return;
      end if;
    end if;
  end if;

  v_basis := public.fn_worker_auto_basis(p_worker);
  -- kiszállási díj: helyszínenként és naponként egyszer (2026-09-20-tól)
  if p_date >= date '2026-09-20' then v_fee := public.fn_worker_callout_fee(p_worker); end if;
  v_note := 'munkaidő alapján (automatikus) · ' || to_char(v_hours, 'FM990') || ' óra (megkezdett órák)'
    || case when v_fee > 0 then ' + kiszállási díj ' || replace(trim(to_char(v_fee, 'FM999,999,999')), ',', ' ') || ' Ft' else '' end;

  if v_row.id is not null then
    if v_row.paid_at is not null then return; end if;
    begin
      update public.attendance
      set pay_basis = v_basis,
          applied_rate = case when v_row.pay_basis = v_basis then applied_rate else null end,
          hours = case when v_basis = 'hourly' then v_hours else null end,
          day_multiplier = 1,
          callout_fee = v_fee,
          task_id = coalesce(v_task, task_id),
          note = v_note
      where id = v_row.id;
    exception when others then raise notice 'session wage update skipped: %', sqlerrm; end;
    perform public.fn_refresh_timesheet_snapshot(p_worker, p_date);
    return;
  end if;

  select created_by into v_owner from public.worker_tasks where id = v_task;
  if v_owner is null then select created_by into v_owner from public.sites where id = p_site; end if;
  if v_owner is null then select id into v_owner from public.profiles where worker_id is null order by created_at limit 1; end if;

  begin
    insert into public.attendance (work_date, site_id, worker_id, created_by, pay_basis, hours, day_multiplier,
                                   applied_rate, source, task_id, callout_fee, note)
    values (p_date, p_site, p_worker, v_owner, v_basis,
            case when v_basis = 'hourly' then v_hours else null end,
            1, null, 'session', v_task, v_fee, v_note);
  exception when others then
    raise notice 'session wage skipped: %', sqlerrm;
  end;
  perform public.fn_refresh_timesheet_snapshot(p_worker, p_date);
end $function$;
revoke all on function public.fn_recalc_session_wage(uuid, uuid, date) from public, anon, authenticated;

-- heti összesítő: órák a megkezdett órákból (a kiszállási díj az összegben van)
create or replace function public.fn_timesheet_totals(p_worker uuid, p_week date)
returns table(hours numeric, amount numeric, days integer)
language sql stable security definer set search_path to 'public' as $$
  select
    coalesce((select sum(ceil(round(d.h, 4))) from (
                select sum(extract(epoch from (s.ended_at - s.started_at)) / 3600.0) as h
                from public.work_sessions s
                where s.worker_id = p_worker and s.deleted_at is null and s.ended_at is not null
                  and (s.started_at at time zone 'Europe/Budapest')::date between p_week and p_week + 6
                group by (s.started_at at time zone 'Europe/Budapest')::date, s.site_id) d), 0),
    coalesce((select sum(a.amount - a.commission_amount) from public.attendance a
              where a.worker_id = p_worker and a.deleted_at is null and a.pay_basis <> 'presence'
                and a.work_date between p_week and p_week + 6), 0),
    coalesce((select count(distinct a.work_date)::int from public.attendance a
              where a.worker_id = p_worker and a.deleted_at is null
                and a.work_date between p_week and p_week + 6), 0);
$$;
revoke all on function public.fn_timesheet_totals(uuid, date) from public, anon, authenticated;

-- a 2026-09-20-tól rögzített napok újraszámolása az új szabállyal (kifizetett sor nem változik)
do $$ declare r record; begin
  for r in select distinct s.worker_id, s.site_id, (s.started_at at time zone 'Europe/Budapest')::date as day
           from public.work_sessions s
           where s.deleted_at is null and s.ended_at is not null and s.site_id is not null
             and (s.started_at at time zone 'Europe/Budapest')::date >= date '2026-09-20'
  loop
    perform public.fn_recalc_session_wage(r.worker_id, r.site_id, r.day);
  end loop;
end $$;
