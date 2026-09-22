-- Feladat-folyamat (2026-09-23, Daniel kérése): esemény-napló a feladat oldalán látható
-- idővonalhoz — kiosztás, elfogadás, nem sikerült (indokkal, fotókkal, MINDEN alkalommal),
-- kész, vezetői lezárás / újranyitás, visszavonás, ajánlatok. A munkaidő indítás/befejezés
-- a work_sessions-ból jön (a kliens fésüli össze). Csak vezető olvassa.

create table if not exists public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.worker_tasks(id) on delete cascade,
  kind text not null,                      -- created | assigned | unassigned | accepted | failed | done | closed | reopened | cancelled | quote_* 
  worker_id uuid references public.workers(id),
  actor_user_id uuid,                      -- aki tette (auth.uid())
  note text,
  photo_paths text[] not null default '{}',
  amount numeric(14,2),
  at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists task_events_task_idx on public.task_events(task_id, at);
create index if not exists task_events_updated_idx on public.task_events(updated_at);
alter table public.task_events enable row level security;
revoke all on public.task_events from public, anon, authenticated;
grant select on public.task_events to authenticated;
drop policy if exists te_select on public.task_events;
create policy te_select on public.task_events for select to authenticated using (public.fn_is_partner());
do $$ begin
  execute 'alter publication supabase_realtime add table public.task_events';
exception when duplicate_object then null; end $$;

-- ---------- feladat állapotváltozásai ----------
create or replace function public.fn_task_event_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (task_id, kind, actor_user_id, at) values (new.id, 'created', coalesce(auth.uid(), new.created_by), new.created_at);
    return new;
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    insert into public.task_events (task_id, kind, actor_user_id) values (new.id, 'deleted', auth.uid());
    return new;
  end if;
  -- nem sikerült: minden jelentés külön esemény (új indok / új időpont akkor is, ha az állapot már failed volt)
  if new.status = 'failed' and (old.status <> 'failed' or new.fail_reason is distinct from old.fail_reason or new.done_at is distinct from old.done_at) then
    insert into public.task_events (task_id, kind, actor_user_id, note, photo_paths, at)
    values (new.id, 'failed', auth.uid(), new.fail_reason, coalesce(new.fail_photo_paths, '{}'), coalesce(new.done_at, now()));
  elsif new.status = 'done' and old.status <> 'done' then
    insert into public.task_events (task_id, kind, actor_user_id, at) values (new.id, 'done', auth.uid(), coalesce(new.done_at, now()));
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    insert into public.task_events (task_id, kind, actor_user_id) values (new.id, 'cancelled', auth.uid());
  elsif new.status in ('assigned', 'acknowledged') and old.status in ('done', 'failed', 'cancelled') then
    insert into public.task_events (task_id, kind, actor_user_id) values (new.id, 'reopened', auth.uid());
  end if;
  if new.closed_at is not null and old.closed_at is null then
    insert into public.task_events (task_id, kind, actor_user_id, at) values (new.id, 'closed', auth.uid(), new.closed_at);
  elsif new.closed_at is null and old.closed_at is not null then
    insert into public.task_events (task_id, kind, actor_user_id) values (new.id, 'reopened', auth.uid());
  end if;
  return new;
end $$;
revoke all on function public.fn_task_event_log() from public, anon, authenticated;
drop trigger if exists trg_task_event_log on public.worker_tasks;
create trigger trg_task_event_log after insert or update on public.worker_tasks
  for each row execute function public.fn_task_event_log();

-- ---------- kiosztás / elfogadás ----------
create or replace function public.fn_task_assignee_event_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (task_id, kind, worker_id, actor_user_id, at) values (new.task_id, 'assigned', new.worker_id, auth.uid(), new.created_at);
    if new.acknowledged_at is not null then
      insert into public.task_events (task_id, kind, worker_id, actor_user_id, at) values (new.task_id, 'accepted', new.worker_id, auth.uid(), new.acknowledged_at);
    end if;
    return new;
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    insert into public.task_events (task_id, kind, worker_id, actor_user_id) values (new.task_id, 'unassigned', new.worker_id, auth.uid());
  elsif new.deleted_at is null and old.deleted_at is not null then
    insert into public.task_events (task_id, kind, worker_id, actor_user_id) values (new.task_id, 'assigned', new.worker_id, auth.uid());
  end if;
  if new.acknowledged_at is not null and old.acknowledged_at is null and new.deleted_at is null then
    insert into public.task_events (task_id, kind, worker_id, actor_user_id, at) values (new.task_id, 'accepted', new.worker_id, auth.uid(), new.acknowledged_at);
  end if;
  return new;
end $$;
revoke all on function public.fn_task_assignee_event_log() from public, anon, authenticated;
drop trigger if exists trg_task_assignee_event_log on public.task_assignees;
create trigger trg_task_assignee_event_log after insert or update on public.task_assignees
  for each row execute function public.fn_task_assignee_event_log();

-- ---------- ajánlatok ----------
create or replace function public.fn_task_quote_event_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (task_id, kind, worker_id, actor_user_id, at) values (new.task_id, 'quote_requested', new.worker_id, auth.uid(), new.requested_at);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.task_events (task_id, kind, worker_id, actor_user_id, note, amount, at)
    values (new.task_id, 'quote_' || new.status, new.worker_id, auth.uid(),
            case when new.status = 'submitted' then new.note else new.decision_note end, new.amount,
            case when new.status = 'submitted' then coalesce(new.submitted_at, now()) else coalesce(new.decided_at, now()) end);
  end if;
  return new;
end $$;
revoke all on function public.fn_task_quote_event_log() from public, anon, authenticated;
drop trigger if exists trg_task_quote_event_log on public.task_quotes;
create trigger trg_task_quote_event_log after insert or update on public.task_quotes
  for each row execute function public.fn_task_quote_event_log();

-- ---------- visszamenőleges feltöltés a meglévő adatokból ----------
insert into public.task_events (task_id, kind, actor_user_id, at)
select t.id, 'created', t.created_by, t.created_at from public.worker_tasks t
where not exists (select 1 from public.task_events e where e.task_id = t.id);
insert into public.task_events (task_id, kind, worker_id, at)
select a.task_id, 'assigned', a.worker_id, a.created_at from public.task_assignees a
where a.deleted_at is null and not exists (select 1 from public.task_events e where e.task_id = a.task_id and e.kind = 'assigned' and e.worker_id = a.worker_id);
insert into public.task_events (task_id, kind, worker_id, at)
select a.task_id, 'accepted', a.worker_id, a.acknowledged_at from public.task_assignees a
where a.deleted_at is null and a.acknowledged_at is not null and not exists (select 1 from public.task_events e where e.task_id = a.task_id and e.kind = 'accepted' and e.worker_id = a.worker_id);
insert into public.task_events (task_id, kind, note, photo_paths, at)
select t.id, 'failed', t.fail_reason, coalesce(t.fail_photo_paths, '{}'), coalesce(t.done_at, t.updated_at) from public.worker_tasks t
where t.status = 'failed' and not exists (select 1 from public.task_events e where e.task_id = t.id and e.kind = 'failed');
insert into public.task_events (task_id, kind, note, photo_paths, at)
select t.id, 'failed', t.fail_reason, coalesce(t.fail_photo_paths, '{}'), t.updated_at from public.worker_tasks t
where t.status = 'done' and t.fail_reason is not null and not exists (select 1 from public.task_events e where e.task_id = t.id and e.kind = 'failed');
insert into public.task_events (task_id, kind, at)
select t.id, 'done', coalesce(t.done_at, t.updated_at) from public.worker_tasks t
where t.status = 'done' and not exists (select 1 from public.task_events e where e.task_id = t.id and e.kind = 'done');
insert into public.task_events (task_id, kind, at)
select t.id, 'cancelled', t.updated_at from public.worker_tasks t
where t.status = 'cancelled' and not exists (select 1 from public.task_events e where e.task_id = t.id and e.kind = 'cancelled');
insert into public.task_events (task_id, kind, at)
select t.id, 'closed', t.closed_at from public.worker_tasks t
where t.closed_at is not null and not exists (select 1 from public.task_events e where e.task_id = t.id and e.kind = 'closed');
insert into public.task_events (task_id, kind, worker_id, note, amount, at)
select q.task_id, 'quote_' || q.status, q.worker_id, coalesce(q.decision_note, q.note), q.amount, coalesce(q.decided_at, q.submitted_at, q.requested_at)
from public.task_quotes q where q.deleted_at is null and q.status <> 'requested'
  and not exists (select 1 from public.task_events e where e.task_id = q.task_id and e.kind like 'quote_%' and e.worker_id = q.worker_id);
