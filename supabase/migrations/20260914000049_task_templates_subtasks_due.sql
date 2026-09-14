-- Feladat-sablonok, részfeladatok (pipálható lépések, kötelező fotóval),
-- határidő és késés-riasztás.

-- ---------- határidő ----------
alter table public.worker_tasks
  add column if not exists due_date date,
  add column if not exists overdue_notified_at timestamptz;
create index if not exists worker_tasks_due_idx on public.worker_tasks(due_date) where deleted_at is null;

-- ---------- részfeladatok ----------
create table if not exists public.task_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.worker_tasks(id) on delete cascade,
  title text not null,
  position integer not null default 0,
  photo_required boolean not null default false,
  photo_paths text[] not null default '{}',
  done_at timestamptz,
  done_by uuid references public.profiles(id),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists task_subtasks_task_idx on public.task_subtasks(task_id);
create index if not exists task_subtasks_updated_idx on public.task_subtasks(updated_at);
drop trigger if exists trg_touch_task_subtasks on public.task_subtasks;
create trigger trg_touch_task_subtasks before insert or update on public.task_subtasks
  for each row execute function public.fn_touch_updated_at();

alter table public.task_subtasks enable row level security;
revoke all on public.task_subtasks from anon;
grant select, insert, update on public.task_subtasks to authenticated;
drop policy if exists ts_select on public.task_subtasks;
create policy ts_select on public.task_subtasks for select to authenticated
  using (public.fn_is_partner() or exists (
    select 1 from public.task_assignees a
    where a.task_id = task_subtasks.task_id and a.worker_id = public.fn_my_worker_id() and a.deleted_at is null));
drop policy if exists ts_insert on public.task_subtasks;
create policy ts_insert on public.task_subtasks for insert to authenticated
  with check (public.fn_is_partner() and created_by = auth.uid());
-- a munkavállaló csak a pipát és a fotót állíthatja (elfogadott feladaton)
drop policy if exists ts_update on public.task_subtasks;
create policy ts_update on public.task_subtasks for update to authenticated
  using (public.fn_is_partner() or exists (
    select 1 from public.task_assignees a
    where a.task_id = task_subtasks.task_id and a.worker_id = public.fn_my_worker_id()
      and a.deleted_at is null and a.acknowledged_at is not null))
  with check (public.fn_is_partner() or exists (
    select 1 from public.task_assignees a
    where a.task_id = task_subtasks.task_id and a.worker_id = public.fn_my_worker_id()
      and a.deleted_at is null and a.acknowledged_at is not null));

create or replace function public.fn_subtask_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.fn_is_partner() then
    -- munkavállaló: cím, sorrend, kötelező-fotó, törlés nem módosítható
    if new.title <> old.title or new.position <> old.position or new.photo_required <> old.photo_required
       or new.deleted_at is distinct from old.deleted_at or new.task_id <> old.task_id then
      raise exception 'A részfeladatot csak a fő felhasználó szerkesztheti — te pipálhatod és fotózhatod.';
    end if;
  end if;
  if new.done_at is not null and old.done_at is null then
    if new.photo_required and coalesce(cardinality(new.photo_paths), 0) = 0 then
      raise exception 'Ehhez a lépéshez fotó kell, mielőtt késznek jelölöd.';
    end if;
    new.done_by := coalesce(new.done_by, auth.uid());
  end if;
  if new.done_at is null then new.done_by := null; end if;
  return new;
end $$;
drop trigger if exists trg_subtask_guard on public.task_subtasks;
create trigger trg_subtask_guard before update on public.task_subtasks
  for each row execute function public.fn_subtask_guard();

do $$ begin
  execute 'alter publication supabase_realtime add table public.task_subtasks';
exception when duplicate_object then null; end $$;

-- ---------- sablonok ----------
create table if not exists public.task_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  title text not null,
  details text,
  code_prefix text,
  priority integer not null default 0,
  quote_requested boolean not null default false,
  due_days integer,
  subtasks jsonb not null default '[]'::jsonb,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists task_templates_updated_idx on public.task_templates(updated_at);
drop trigger if exists trg_touch_task_templates on public.task_templates;
create trigger trg_touch_task_templates before insert or update on public.task_templates
  for each row execute function public.fn_touch_updated_at();
alter table public.task_templates enable row level security;
revoke all on public.task_templates from anon;
grant select, insert, update on public.task_templates to authenticated;
drop policy if exists tt_select on public.task_templates;
create policy tt_select on public.task_templates for select to authenticated using (public.fn_is_partner());
drop policy if exists tt_insert on public.task_templates;
create policy tt_insert on public.task_templates for insert to authenticated
  with check (public.fn_is_partner() and created_by = auth.uid());
drop policy if exists tt_update on public.task_templates;
create policy tt_update on public.task_templates for update to authenticated
  using (public.fn_is_partner()) with check (public.fn_is_partner());
do $$ begin
  execute 'alter publication supabase_realtime add table public.task_templates';
exception when duplicate_object then null; end $$;

-- ---------- késés-riasztás (naponta reggel) ----------
alter table public.notification_queue drop constraint if exists notification_queue_kind_check;
alter table public.notification_queue add constraint notification_queue_kind_check
  check (kind in ('comment','big_expense','weekly','overdue','share_change','site_deleted','task','material',
                  'worker_joined','worker_approved','worker_rejected','task_due','timesheet'));

create or replace function public.fn_notify_overdue_tasks()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; v_prof uuid; v_days integer;
begin
  for r in
    select t.* from public.worker_tasks t
    where t.deleted_at is null and t.status in ('assigned', 'acknowledged')
      and t.due_date is not null and t.due_date < (now() at time zone 'Europe/Budapest')::date
      and t.overdue_notified_at is null
  loop
    v_days := (now() at time zone 'Europe/Budapest')::date - r.due_date;
    perform public.fn_notify_partners('task_due', 'Lejárt határidejű feladat ⏰',
      coalesce(r.code || ' — ', '') || r.title || ' · ' || v_days || ' napja lejárt (' || to_char(r.due_date, 'YYYY.MM.DD') || ')',
      jsonb_build_object('task_id', r.id));
    for v_prof in
      select p.id from public.task_assignees a join public.profiles p on p.worker_id = a.worker_id
      where a.task_id = r.id and a.deleted_at is null
    loop
      insert into public.notification_queue (kind, recipient, title, body, payload)
      values ('task_due', v_prof, 'Lejárt a feladat határideje ⏰',
              coalesce(r.code || ' — ', '') || r.title || ' — jelezd az állapotát az appban!',
              jsonb_build_object('task_id', r.id));
    end loop;
    update public.worker_tasks set overdue_notified_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.fn_notify_overdue_tasks() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'notify-overdue-tasks';
    perform cron.schedule('notify-overdue-tasks', '0 5 * * *', 'select public.fn_notify_overdue_tasks()');
  end if;
end $$;

-- határidő módosításakor a riasztás újra élesedik
create or replace function public.fn_task_due_reset()
returns trigger language plpgsql as $$
begin
  if new.due_date is distinct from old.due_date then new.overdue_notified_at := null; end if;
  return new;
end $$;
drop trigger if exists trg_task_due_reset on public.worker_tasks;
create trigger trg_task_due_reset before update of due_date on public.worker_tasks
  for each row execute function public.fn_task_due_reset();
