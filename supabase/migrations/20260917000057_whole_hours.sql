-- Órabérnél minden megkezdett óra teljes órának számít (nincs tört óra):
-- a napi, építkezésenkénti munkaidő-összeget felfelé kerekítjük egész órára,
-- mindenkinél (magánszemély és vállalkozó/emberei egyaránt). Az óralap is
-- ezekkel az egész órákkal számol. A meglévő, még ki nem fizetett automatikus
-- bér-sorokat újraszámoljuk.

create or replace function public.fn_recalc_session_wage(p_worker uuid, p_site uuid, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare
  w public.workers%rowtype;
  v_hours numeric := 0;
  v_basis text;
  v_task uuid;
  v_owner uuid;
  v_row public.attendance%rowtype;
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
  v_hours := ceil(round(v_hours, 4));

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
  if v_row.id is null and exists (select 1 from public.attendance where worker_id = p_worker and site_id = p_site
             and work_date = p_date and source = 'session' and deleted_at is not null) then
    return;
  end if;

  v_basis := public.fn_worker_auto_basis(p_worker);

  if v_row.id is not null then
    if v_row.paid_at is not null then return; end if;
    begin
      update public.attendance
      set pay_basis = v_basis,
          applied_rate = case when v_row.pay_basis = v_basis then applied_rate else null end,
          hours = case when v_basis = 'hourly' then v_hours else null end,
          day_multiplier = 1,
          task_id = coalesce(v_task, task_id),
          note = 'munkaidő alapján (automatikus) · ' || to_char(v_hours, 'FM990') || ' óra (megkezdett órák)'
      where id = v_row.id;
    exception when others then raise notice 'session wage update skipped: %', sqlerrm; end;
    return;
  end if;

  select created_by into v_owner from public.worker_tasks where id = v_task;
  if v_owner is null then select created_by into v_owner from public.sites where id = p_site; end if;
  if v_owner is null then select id into v_owner from public.profiles where worker_id is null order by created_at limit 1; end if;

  begin
    insert into public.attendance (work_date, site_id, worker_id, created_by, pay_basis, hours, day_multiplier,
                                   applied_rate, source, task_id, note)
    values (p_date, p_site, p_worker, v_owner, v_basis,
            case when v_basis = 'hourly' then v_hours else null end,
            1, null, 'session', v_task,
            'munkaidő alapján (automatikus) · ' || to_char(v_hours, 'FM990') || ' óra (megkezdett órák)');
  exception when others then
    raise notice 'session wage skipped: %', sqlerrm;
  end;
end $$;
revoke execute on function public.fn_recalc_session_wage(uuid, uuid, date) from public, anon, authenticated;

-- óralap: az órák is egész (megkezdett) órák, naponként és építkezésenként
create or replace function public.fn_timesheet_totals(p_worker uuid, p_week date)
returns table (hours numeric, amount numeric, days integer)
language sql stable security definer set search_path = public as $$
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

-- meglévő, ki nem fizetett automatikus sorok újraszámolása
do $$
declare r record;
begin
  for r in select distinct worker_id, site_id, work_date from public.attendance
           where source = 'session' and deleted_at is null and paid_at is null
  loop
    perform public.fn_recalc_session_wage(r.worker_id, r.site_id, r.work_date);
  end loop;
end $$;
