-- Alkalmazáson belüli értesítések (harang): olvasott jelölés, szinkron,
-- + új események: anyagköltség fotóval, új munkavállaló regisztrációja.
alter table public.notification_queue
  add column if not exists read_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;
drop trigger if exists trg_touch_notification_queue on public.notification_queue;
create trigger trg_touch_notification_queue before insert or update on public.notification_queue
  for each row execute function public.fn_touch_updated_at();
drop policy if exists notif_update on public.notification_queue;
create policy notif_update on public.notification_queue for update to authenticated
  using (recipient = auth.uid()) with check (recipient = auth.uid());

alter table public.notification_queue drop constraint notification_queue_kind_check;
alter table public.notification_queue add constraint notification_queue_kind_check
  check (kind in ('comment','big_expense','weekly','overdue','share_change','site_deleted','task','material','worker_joined'));

create or replace function public.fn_notify_material()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_task public.worker_tasks%rowtype;
  v_who text;
  v_photos integer;
  r record;
begin
  select * into v_task from public.worker_tasks where id = new.task_id;
  select coalesce(nickname, name) into v_who from public.workers where id = new.worker_id;
  v_photos := coalesce(cardinality(new.photo_paths), 0);
  if v_photos = 0 and new.photo_path is not null then v_photos := 1; end if;
  for r in select id from public.profiles where worker_id is null and id <> new.created_by loop
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('material', r.id, 'Anyagköltség rögzítve 📦',
            coalesce(v_who, 'Munkavállaló') || ': ' || trim(to_char(new.amount, 'FM999 999 999')) || ' Ft'
            || case when v_photos > 0 then ' · ' || v_photos || ' fotó' else '' end
            || coalesce(' — ' || v_task.title, '') || ' (beárazandó)',
            jsonb_build_object('task_id', new.task_id));
  end loop;
  return new;
end;
$$;
drop trigger if exists trg_notify_material on public.task_materials;
create trigger trg_notify_material after insert on public.task_materials
  for each row execute function public.fn_notify_material();

create or replace function public.fn_notify_worker_joined()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare r record; v_name text;
begin
  if new.worker_id is null then return new; end if;
  select coalesce(nickname, name) into v_name from public.workers where id = new.worker_id;
  for r in select id from public.profiles where worker_id is null loop
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('worker_joined', r.id, 'Új munkavállaló regisztrált 👷',
            coalesce(v_name, new.display_name) || ' létrehozta a fiókját (' || coalesce(new.email, '') || ').',
            jsonb_build_object('worker_id', new.worker_id));
  end loop;
  return new;
end;
$$;
drop trigger if exists trg_notify_worker_joined on public.profiles;
create trigger trg_notify_worker_joined after insert on public.profiles
  for each row execute function public.fn_notify_worker_joined();

do $$ begin
  execute 'alter publication supabase_realtime add table public.notification_queue';
exception when duplicate_object then null; end $$;
