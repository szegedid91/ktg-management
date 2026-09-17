-- Megjegyzések a feladatokhoz (fő felhasználók írják): szerkeszthető,
-- törölhető; kétféle láthatóság — csak fő felhasználók, vagy a kiosztott
-- munkavállaló(k) is látják. Munkavállalónak látható megjegyzésről a
-- kiosztottak értesítést kapnak.

create table if not exists public.task_notes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.worker_tasks(id) on delete cascade,
  body text not null,
  visible_to_workers boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists task_notes_task_idx on public.task_notes(task_id);
create index if not exists task_notes_updated_idx on public.task_notes(updated_at);
drop trigger if exists trg_touch_task_notes on public.task_notes;
create trigger trg_touch_task_notes before insert or update on public.task_notes
  for each row execute function public.fn_touch_updated_at();
alter table public.task_notes enable row level security;
revoke all on public.task_notes from anon;
grant select, insert, update on public.task_notes to authenticated;
drop policy if exists tn_select on public.task_notes;
create policy tn_select on public.task_notes for select to authenticated
  using (public.fn_is_partner() or (visible_to_workers and exists (
    select 1 from public.task_assignees a where a.task_id = task_notes.task_id
      and a.worker_id = public.fn_my_worker_id() and a.deleted_at is null)));
drop policy if exists tn_insert on public.task_notes;
create policy tn_insert on public.task_notes for insert to authenticated
  with check (public.fn_is_partner() and created_by = auth.uid());
drop policy if exists tn_update on public.task_notes;
create policy tn_update on public.task_notes for update to authenticated
  using (public.fn_is_partner()) with check (public.fn_is_partner());
do $$ begin
  execute 'alter publication supabase_realtime add table public.task_notes';
exception when duplicate_object then null; end $$;

-- munkavállalónak látható (új vagy láthatóvá tett) megjegyzés → értesítés a kiosztottaknak
create or replace function public.fn_notify_task_note()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_task public.worker_tasks%rowtype;
begin
  if new.deleted_at is not null or not new.visible_to_workers then return new; end if;
  if tg_op = 'UPDATE' and old.visible_to_workers and old.deleted_at is null and old.body = new.body then return new; end if;
  select * into v_task from public.worker_tasks where id = new.task_id;
  for r in select p.id from public.task_assignees a join public.profiles p on p.worker_id = a.worker_id
           where a.task_id = new.task_id and a.deleted_at is null
  loop
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', r.id, 'Megjegyzés a feladathoz 📝',
            coalesce(v_task.code || ' — ', '') || v_task.title || ': ' || left(new.body, 140),
            jsonb_build_object('task_id', new.task_id));
  end loop;
  return new;
end $$;
drop trigger if exists trg_notify_task_note on public.task_notes;
create trigger trg_notify_task_note after insert or update of body, visible_to_workers, deleted_at on public.task_notes
  for each row execute function public.fn_notify_task_note();
