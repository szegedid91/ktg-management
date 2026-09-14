-- Napidíjas automatikus bér: a rövid jelenlét is egész napnak számít
-- (nincs fél napos kerekítés).

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
  v_hours := round(v_hours, 2);

  select * into v_row from public.attendance
  where worker_id = p_worker and site_id = p_site and work_date = p_date
    and source = 'session' and deleted_at is null;

  if v_hours <= 0 then
    if v_row.id is not null and v_row.paid_at is null then
      update public.attendance set deleted_at = now() where id = v_row.id;
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
    update public.attendance
    set pay_basis = v_basis,
        applied_rate = null, -- újra feloldjuk (saját díj → globális alapértelmezés)
        hours = case when v_basis = 'hourly' then v_hours else null end,
        day_multiplier = 1,
        task_id = coalesce(v_task, task_id),
        note = 'munkaidő alapján (automatikus) · ' || to_char(v_hours, 'FM990.00') || ' óra'
    where id = v_row.id;
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
            1,
            null, 'session', v_task,
            'munkaidő alapján (automatikus) · ' || to_char(v_hours, 'FM990.00') || ' óra');
  exception when others then
    raise notice 'session wage skipped: %', sqlerrm;
  end;
end $$;

do $$
declare r record;
begin
  for r in select distinct worker_id, site_id, work_date from public.attendance
           where source = 'session' and deleted_at is null and paid_at is null loop
    perform public.fn_recalc_session_wage(r.worker_id, r.site_id, r.work_date);
  end loop;
end $$;
