-- Beosztás (naptár) + automatikus emlékeztetők
--  1) schedule_entries: ki melyik napon melyik építkezésen lesz (partner írja,
--     a munkavállaló a sajátját + emberei beosztását látja); értesítés a munkavállalónak
--  2) emlékeztetők (pg_cron): 24 órája el nem fogadott feladat, este le nem zárt
--     munkamenet, vasárnap be nem küldött óralap

create table if not exists public.schedule_entries (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  work_date date not null,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists schedule_entries_uq on public.schedule_entries(worker_id, work_date, site_id) where deleted_at is null;
create index if not exists schedule_entries_date_idx on public.schedule_entries(work_date);
create index if not exists schedule_entries_updated_idx on public.schedule_entries(updated_at);
create index if not exists ix_fk_schedule_entries_site on public.schedule_entries(site_id);
create index if not exists ix_fk_schedule_entries_created_by on public.schedule_entries(created_by);
drop trigger if exists trg_touch_schedule_entries on public.schedule_entries;
create trigger trg_touch_schedule_entries before insert or update on public.schedule_entries
  for each row execute function public.fn_touch_updated_at();
alter table public.schedule_entries enable row level security;
revoke all on public.schedule_entries from anon;
grant select, insert, update on public.schedule_entries to authenticated;
drop policy if exists se_select on public.schedule_entries;
create policy se_select on public.schedule_entries for select to authenticated
  using (public.fn_is_partner() or worker_id = any(public.fn_my_worker_ids()));
drop policy if exists se_insert on public.schedule_entries;
create policy se_insert on public.schedule_entries for insert to authenticated
  with check (public.fn_is_partner() and created_by = (select auth.uid()));
drop policy if exists se_update on public.schedule_entries;
create policy se_update on public.schedule_entries for update to authenticated
  using (public.fn_is_partner()) with check (public.fn_is_partner());
do $$ begin
  execute 'alter publication supabase_realtime add table public.schedule_entries';
exception when duplicate_object then null; end $$;

alter table public.notification_queue drop constraint if exists notification_queue_kind_check;
alter table public.notification_queue add constraint notification_queue_kind_check
  check (kind in ('comment','big_expense','weekly','overdue','share_change','site_deleted','task','material',
                  'worker_joined','worker_approved','worker_rejected','task_due','timesheet','schedule','reminder'));

-- értesítés a beosztott munkavállalónak (új / módosított / törölt beosztás)
create or replace function public.fn_notify_schedule()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prof uuid; v_site text;
begin
  select id into v_prof from public.profiles where worker_id = new.worker_id;
  if v_prof is null then
    -- vállalkozó embere: a vállalkozó kapja
    select p.id into v_prof from public.workers w join public.profiles p on p.worker_id = w.contractor_id where w.id = new.worker_id;
  end if;
  if v_prof is null or v_prof = (select auth.uid()) then return new; end if;
  select name || coalesce(' · ' || address, '') into v_site from public.sites where id = new.site_id;
  if tg_op = 'INSERT' and new.deleted_at is null then
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('schedule', v_prof, 'Beosztás 📆',
            to_char(new.work_date, 'MM.DD') || ' — ' || coalesce(v_site, '?') || coalesce(' · ' || new.note, ''),
            jsonb_build_object('site_id', new.site_id, 'work_date', new.work_date));
  elsif tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('schedule', v_prof, 'Beosztás törölve 📆',
            to_char(new.work_date, 'MM.DD') || ' — ' || coalesce(v_site, '?') || ' — erre a napra már nem vagy beosztva ide.',
            jsonb_build_object('work_date', new.work_date));
  elsif tg_op = 'UPDATE' and new.deleted_at is null and (old.work_date <> new.work_date or old.site_id <> new.site_id) then
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('schedule', v_prof, 'Beosztás módosult 📆',
            to_char(new.work_date, 'MM.DD') || ' — ' || coalesce(v_site, '?'),
            jsonb_build_object('site_id', new.site_id, 'work_date', new.work_date));
  end if;
  return new;
end $$;
drop trigger if exists trg_notify_schedule on public.schedule_entries;
create trigger trg_notify_schedule after insert or update on public.schedule_entries
  for each row execute function public.fn_notify_schedule();
revoke execute on function public.fn_notify_schedule() from public, anon, authenticated;

-- ---------- emlékeztetők ----------
alter table public.task_assignees add column if not exists reminded_at timestamptz;
alter table public.work_sessions add column if not exists reminded_at timestamptz;

-- 24 órája el nem fogadott feladat: a munkavállalónak (naponta egyszer) + a partnereknek összesítve
create or replace function public.fn_remind_unaccepted_tasks()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; v_names text := '';
begin
  for r in
    select a.id as assignee_id, a.worker_id, t.id as task_id, t.code, t.title, t.priority, p.id as prof
    from public.task_assignees a
    join public.worker_tasks t on t.id = a.task_id
    left join public.profiles p on p.worker_id = a.worker_id
    where a.deleted_at is null and a.acknowledged_at is null and t.deleted_at is null and t.status = 'assigned'
      and a.updated_at < now() - interval '24 hours'
      and (a.reminded_at is null or a.reminded_at < now() - interval '24 hours')
  loop
    if r.prof is not null then
      insert into public.notification_queue (kind, recipient, title, body, payload)
      values ('reminder', r.prof, case when r.priority > 0 then '🆘 Sürgős feladat vár elfogadásra' else 'Feladat vár elfogadásra ⏳' end,
              coalesce(r.code || ' — ', '') || r.title || ' — fogadd el vagy jelezd, ha nem vállalod.',
              jsonb_build_object('task_id', r.task_id));
    end if;
    update public.task_assignees set reminded_at = now() where id = r.assignee_id;
    v_names := v_names || case when v_names = '' then '' else ', ' end || coalesce(r.code, r.title);
    n := n + 1;
  end loop;
  if n > 0 then
    perform public.fn_notify_partners('reminder', 'El nem fogadott feladatok ⏳',
      n || ' kiosztás vár 24 órája elfogadásra: ' || left(coalesce(v_names, ''), 160), '{}'::jsonb);
  end if;
  return n;
end $$;
revoke execute on function public.fn_remind_unaccepted_tasks() from public, anon, authenticated;

-- este nyitva maradt munkamenet: a munkavállalónak (vállalkozó emberénél a vállalkozónak)
create or replace function public.fn_remind_open_sessions()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; v_prof uuid;
begin
  for r in
    select s.id, s.worker_id, s.started_at, w.name, w.contractor_id
    from public.work_sessions s join public.workers w on w.id = s.worker_id
    where s.deleted_at is null and s.ended_at is null and s.reminded_at is null
      and s.started_at < now() - interval '6 hours'
  loop
    select id into v_prof from public.profiles where worker_id = r.worker_id;
    if v_prof is null and r.contractor_id is not null then
      select id into v_prof from public.profiles where worker_id = r.contractor_id;
    end if;
    if v_prof is not null then
      insert into public.notification_queue (kind, recipient, title, body, payload)
      values ('reminder', v_prof, 'Fut még a munkaidő? ⏱',
              r.name || ' munkamenete ' || to_char(r.started_at at time zone 'Europe/Budapest', 'HH24:MI') || ' óta nyitva — ha végeztél, zárd le az appban (max. 16 órát számolunk).',
              '{}'::jsonb);
      n := n + 1;
    end if;
    update public.work_sessions set reminded_at = now() where id = r.id;
  end loop;
  return n;
end $$;
revoke execute on function public.fn_remind_open_sessions() from public, anon, authenticated;

-- vasárnap: be nem küldött óralap (van munkaidő a héten, nincs beküldött/jóváhagyott lap)
create or replace function public.fn_remind_timesheets()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; v_week date := public.fn_week_start((now() at time zone 'Europe/Budapest')::date); v_t record;
begin
  for r in
    select p.id as prof, w.id as worker_id, coalesce(w.nickname, w.name) as name
    from public.profiles p join public.workers w on w.id = p.worker_id
    where w.deleted_at is null and w.approved_at is not null
  loop
    select * into v_t from public.fn_timesheet_totals(r.worker_id, v_week);
    if v_t.hours > 0 and not exists (select 1 from public.timesheets t where t.worker_id = r.worker_id and t.week_start = v_week
                                     and t.status in ('submitted', 'approved') and t.deleted_at is null) then
      insert into public.notification_queue (kind, recipient, title, body, payload)
      values ('timesheet', r.prof, 'Óralap beküldése 🗓️',
              'Ezen a héten ' || to_char(v_t.hours, 'FM990') || ' órád van rögzítve — küldd be az óralapod a kezdőlapon, hogy a béred kifizethető legyen.',
              '{}'::jsonb);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.fn_remind_timesheets() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('remind-unaccepted-tasks', 'remind-open-sessions', 'remind-timesheets');
    perform cron.schedule('remind-unaccepted-tasks', '0 6 * * *', 'select public.fn_remind_unaccepted_tasks()');   -- 08:00 (nyári idő)
    perform cron.schedule('remind-open-sessions', '0 18 * * *', 'select public.fn_remind_open_sessions()');        -- 20:00 (nyári idő)
    perform cron.schedule('remind-timesheets', '0 15 * * 0', 'select public.fn_remind_timesheets()');             -- vasárnap 17:00 (nyári idő)
  end if;
end $$;
