-- Heti óralap: a munkavállaló a hét végén beküldi az óráit (a munkaidőből
-- automatikusan képződött bér-sorok alapján), a fő felhasználó jóváhagyja;
-- az automatikus bér-sorok csak jóváhagyott hét után fizethetők ki.

create table if not exists public.timesheets (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  week_start date not null,                       -- hétfő
  status text not null default 'open' check (status in ('open', 'submitted', 'approved', 'rejected')),
  hours numeric(8,2) not null default 0,
  amount numeric(14,2) not null default 0,
  days integer not null default 0,
  submitted_at timestamptz,
  submitted_note text,
  decided_at timestamptz,
  decided_by uuid references public.profiles(id),
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists timesheets_worker_week on public.timesheets(worker_id, week_start) where deleted_at is null;
create index if not exists timesheets_updated_idx on public.timesheets(updated_at);
drop trigger if exists trg_touch_timesheets on public.timesheets;
create trigger trg_touch_timesheets before insert or update on public.timesheets
  for each row execute function public.fn_touch_updated_at();
alter table public.timesheets enable row level security;
revoke all on public.timesheets from anon;
grant select on public.timesheets to authenticated; -- írás csak RPC-n át
drop policy if exists tsh_select on public.timesheets;
create policy tsh_select on public.timesheets for select to authenticated
  using (public.fn_is_partner() or worker_id = public.fn_my_worker_id());
do $$ begin
  execute 'alter publication supabase_realtime add table public.timesheets';
exception when duplicate_object then null; end $$;

-- hét kezdete (hétfő) Budapest szerint
create or replace function public.fn_week_start(p_date date)
returns date language sql immutable as $$
  select (p_date - ((extract(isodow from p_date)::int - 1)))::date;
$$;

-- egy (munkavállaló, hét) összesítése a bér-sorokból + munkamenetekből
create or replace function public.fn_timesheet_totals(p_worker uuid, p_week date)
returns table (hours numeric, amount numeric, days integer)
language sql stable security definer set search_path = public as $$
  select
    coalesce((select round(sum(extract(epoch from (s.ended_at - s.started_at)) / 3600.0), 2)
              from public.work_sessions s
              where s.worker_id = p_worker and s.deleted_at is null and s.ended_at is not null
                and (s.started_at at time zone 'Europe/Budapest')::date between p_week and p_week + 6), 0),
    coalesce((select sum(a.amount - a.commission_amount) from public.attendance a
              where a.worker_id = p_worker and a.deleted_at is null and a.pay_basis <> 'presence'
                and a.work_date between p_week and p_week + 6), 0),
    coalesce((select count(distinct a.work_date)::int from public.attendance a
              where a.worker_id = p_worker and a.deleted_at is null
                and a.work_date between p_week and p_week + 6), 0);
$$;

-- munkavállaló: óralap beküldése
create or replace function public.submit_timesheet(p_week_start date, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_wid uuid := public.fn_my_worker_id();
  v_week date := public.fn_week_start(p_week_start);
  v_t record;
  v_id uuid;
  v_name text;
begin
  if auth.uid() is null or v_wid is null then raise exception 'Csak munkavállalói fiók küldhet be óralapot.'; end if;
  if v_week > public.fn_week_start((now() at time zone 'Europe/Budapest')::date) then
    raise exception 'Jövőbeli hét nem küldhető be.';
  end if;
  select * into v_t from public.fn_timesheet_totals(v_wid, v_week);
  if v_t.hours <= 0 and v_t.amount <= 0 then raise exception 'Ezen a héten nincs rögzített munkaidőd.'; end if;
  insert into public.timesheets (worker_id, week_start, status, hours, amount, days, submitted_at, submitted_note)
  values (v_wid, v_week, 'submitted', v_t.hours, v_t.amount, v_t.days, now(), nullif(trim(coalesce(p_note, '')), ''))
  on conflict (worker_id, week_start) where deleted_at is null do update
    set status = case when public.timesheets.status = 'approved' then 'approved' else 'submitted' end,
        hours = excluded.hours, amount = excluded.amount, days = excluded.days,
        submitted_at = now(), submitted_note = excluded.submitted_note,
        decided_at = case when public.timesheets.status = 'approved' then public.timesheets.decided_at end
  returning id, status into v_id, v_name;
  if v_name = 'approved' then raise exception 'Ez a hét már jóvá van hagyva.'; end if;
  select coalesce(nickname, name) into v_name from public.workers where id = v_wid;
  perform public.fn_notify_partners('timesheet', 'Óralap jóváhagyásra vár 🗓️',
    coalesce(v_name, 'Munkavállaló') || ' · ' || to_char(v_week, 'MM.DD') || '–' || to_char(v_week + 6, 'MM.DD')
    || ' · ' || to_char(v_t.hours, 'FM990.0') || ' óra · ' || trim(to_char(v_t.amount, 'FM999 999 999')) || ' Ft',
    jsonb_build_object('timesheet_id', v_id));
  return v_id;
end $$;
revoke all on function public.submit_timesheet(date, text) from public, anon;
grant execute on function public.submit_timesheet(date, text) to authenticated;

-- partner: jóváhagyás / elutasítás (beküldés nélkül is)
create or replace function public.decide_timesheet(p_worker uuid, p_week_start date, p_approve boolean, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_week date := public.fn_week_start(p_week_start);
  v_t record;
  v_id uuid;
  v_prof uuid;
begin
  if auth.uid() is null or not public.fn_is_partner() then raise exception 'Csak fő felhasználó hagyhat jóvá óralapot.'; end if;
  select * into v_t from public.fn_timesheet_totals(p_worker, v_week);
  insert into public.timesheets (worker_id, week_start, status, hours, amount, days, decided_at, decided_by, decision_note)
  values (p_worker, v_week, case when p_approve then 'approved' else 'rejected' end, v_t.hours, v_t.amount, v_t.days,
          now(), auth.uid(), nullif(trim(coalesce(p_note, '')), ''))
  on conflict (worker_id, week_start) where deleted_at is null do update
    set status = excluded.status, hours = excluded.hours, amount = excluded.amount, days = excluded.days,
        decided_at = now(), decided_by = auth.uid(), decision_note = excluded.decision_note
  returning id into v_id;
  select id into v_prof from public.profiles where worker_id = p_worker;
  if v_prof is not null then
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('timesheet', v_prof,
            case when p_approve then 'Óralap jóváhagyva ✅' else 'Óralap visszaküldve ✖' end,
            to_char(v_week, 'MM.DD') || '–' || to_char(v_week + 6, 'MM.DD') || ' · ' || to_char(v_t.hours, 'FM990.0') || ' óra'
            || case when p_approve then ' — a béred kifizethető.' else coalesce(' — ' || nullif(trim(coalesce(p_note, '')), ''), '') || ' Nézd át és küldd be újra.' end,
            jsonb_build_object('timesheet_id', v_id));
  end if;
  return v_id;
end $$;
revoke all on function public.decide_timesheet(uuid, date, boolean, text) from public, anon;
grant execute on function public.decide_timesheet(uuid, date, boolean, text) to authenticated;

-- kifizetés: automatikus (munkaidőből / ajánlatból) bér-sor csak jóváhagyott hét után
create or replace function public.mark_attendance_paid(p_ids uuid[], p_paid boolean, p_note text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r record;
begin
  if auth.uid() is null or not public.fn_is_partner() then raise exception 'Csak fő felhasználó jelölhet kifizetést.'; end if;
  if p_paid then
    for r in select a.worker_id, a.work_date, w.name from public.attendance a join public.workers w on w.id = a.worker_id
             where a.id = any(p_ids) and a.deleted_at is null and a.source in ('session', 'task')
               and exists (select 1 from public.profiles p where p.worker_id = a.worker_id)
               and not exists (select 1 from public.timesheets t where t.worker_id = a.worker_id
                               and t.week_start = public.fn_week_start(a.work_date) and t.status = 'approved' and t.deleted_at is null)
    loop
      raise exception 'Előbb hagyd jóvá % óralapját (% hete) az Óralapok oldalon.', r.name, to_char(public.fn_week_start(r.work_date), 'MM.DD');
    end loop;
  end if;
  perform set_config('app.allow_paid_tick', 'on', true);
  update public.attendance
     set paid_at = case when p_paid then now() end,
         paid_by = case when p_paid then auth.uid() end,
         paid_note = case when p_paid then nullif(trim(coalesce(p_note, '')), '') end
   where id = any(p_ids) and deleted_at is null;
end $$;
