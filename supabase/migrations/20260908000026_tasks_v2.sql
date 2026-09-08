-- Feladatok v2:
--  - több munkavállalóra osztható (task_assignees, visszaigazolás fejenként)
--  - munkaidő feladathoz köthető (work_sessions.task_id)
--  - anyagköltség fotós bizonylattal, partner általi továbbszámlázási árral
--    (task_materials.resale_net — amíg üres, „beárazandó”)
--  - feladat kiszámlázott értéke (invoice_net) → haszon
--  - ajánlatkérés: partner kér → munkavállaló ad → partner elfogadja

alter table public.worker_tasks alter column worker_id drop not null;
alter table public.worker_tasks
  add column if not exists invoice_net numeric,
  add column if not exists quote_requested boolean not null default false,
  add column if not exists quote_amount numeric,
  add column if not exists quote_note text,
  add column if not exists quote_submitted_at timestamptz,
  add column if not exists quote_accepted_at timestamptz,
  add column if not exists quote_accepted_by uuid references public.profiles(id);

-- ---------- kiosztások ----------
create table if not exists public.task_assignees (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.worker_tasks(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (task_id, worker_id)
);
alter table public.task_assignees enable row level security;
drop policy if exists ta_select on public.task_assignees;
create policy ta_select on public.task_assignees for select to authenticated
  using (public.fn_is_partner() or worker_id = public.fn_my_worker_id());
drop policy if exists ta_insert on public.task_assignees;
create policy ta_insert on public.task_assignees for insert to authenticated
  with check (public.fn_is_partner());
drop policy if exists ta_update on public.task_assignees;
create policy ta_update on public.task_assignees for update to authenticated
  using (public.fn_is_partner()) with check (public.fn_is_partner());
drop trigger if exists trg_touch_task_assignees on public.task_assignees;
create trigger trg_touch_task_assignees before insert or update on public.task_assignees
  for each row execute function public.fn_touch_updated_at();

-- meglévő egy-munkavállalós feladatok átemelése
insert into public.task_assignees (task_id, worker_id, acknowledged_at)
select id, worker_id, acknowledged_at from public.worker_tasks where worker_id is not null
on conflict (task_id, worker_id) do nothing;

-- kiosztáskor a munkavállaló kap értesítést (fiók esetén push is)
drop trigger if exists trg_notify_task_assigned on public.worker_tasks;
create or replace function public.fn_notify_task_assigned()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_profile uuid;
  v_task public.worker_tasks%rowtype;
  v_site text;
begin
  select id into v_profile from public.profiles where worker_id = new.worker_id;
  if v_profile is null then return new; end if;
  select * into v_task from public.worker_tasks where id = new.task_id;
  select name into v_site from public.sites where id = v_task.site_id;
  insert into public.notification_queue (kind, recipient, title, body, payload)
  values ('task', v_profile,
          case when v_task.quote_requested then 'Ajánlatkérés 💬' else 'Új feladat 🛠️' end,
          coalesce(v_task.code || ' — ', '') || v_task.title
          || coalesce(' · Helyszín: ' || v_site, '')
          || case when v_task.quote_requested
               then ' — adj ajánlatot az appban!'
               else ' — igazold vissza az appban!' end,
          jsonb_build_object('task_id', new.task_id));
  return new;
end;
$$;
drop trigger if exists trg_notify_task_assignee on public.task_assignees;
create trigger trg_notify_task_assignee after insert on public.task_assignees
  for each row execute function public.fn_notify_task_assigned();

-- ---------- munkaidő ↔ feladat ----------
alter table public.work_sessions add column if not exists task_id uuid references public.worker_tasks(id);

-- ---------- anyagköltség ----------
create table if not exists public.task_materials (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.worker_tasks(id) on delete cascade,
  worker_id uuid references public.workers(id),
  amount numeric not null check (amount > 0),
  note text,
  photo_path text not null,
  resale_net numeric check (resale_net is null or resale_net >= 0),
  resale_by uuid references public.profiles(id),
  resale_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists ix_materials_task on public.task_materials (task_id);
alter table public.task_materials enable row level security;
drop policy if exists tm_select on public.task_materials;
create policy tm_select on public.task_materials for select to authenticated
  using (public.fn_is_partner() or worker_id = public.fn_my_worker_id());
drop policy if exists tm_insert on public.task_materials;
create policy tm_insert on public.task_materials for insert to authenticated
  with check (created_by = auth.uid() and (
    public.fn_is_partner()
    or (worker_id = public.fn_my_worker_id() and exists (
          select 1 from public.task_assignees a
          where a.task_id = task_materials.task_id and a.worker_id = public.fn_my_worker_id()))));
drop policy if exists tm_update on public.task_materials;
create policy tm_update on public.task_materials for update to authenticated
  using (public.fn_is_partner()) with check (public.fn_is_partner());
drop trigger if exists trg_touch_task_materials on public.task_materials;
create trigger trg_touch_task_materials before insert or update on public.task_materials
  for each row execute function public.fn_touch_updated_at();
drop trigger if exists trg_audit_task_materials on public.task_materials;
create trigger trg_audit_task_materials after insert or update or delete on public.task_materials
  for each row execute function public.fn_audit();

-- anyagköltség rögzítésekor a partnerek kapnak jelzést: beárazandó
create or replace function public.fn_notify_material()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_title text;
  v_who text;
begin
  select title into v_title from public.worker_tasks where id = new.task_id;
  select name into v_who from public.workers where id = new.worker_id;
  for r in select id from public.profiles where not is_admin and worker_id is null loop
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', r.id, 'Anyagköltség beárazandó 📦',
            coalesce(v_who, 'Munkavállaló') || ' rögzített ' || to_char(new.amount, 'FM999 999 999')
            || ' Ft anyagköltséget ehhez: ' || coalesce(v_title, 'feladat')
            || ' — add meg, mennyiért számlázod tovább.',
            jsonb_build_object('task_id', new.task_id, 'material_id', new.id));
  end loop;
  return new;
end;
$$;
drop trigger if exists trg_notify_material on public.task_materials;
create trigger trg_notify_material after insert on public.task_materials
  for each row execute function public.fn_notify_material();

-- ---------- munkavállalói műveletek: visszaigazolás / kész / nem sikerült / ajánlat ----------
create or replace function public.worker_task_action(
  p_id uuid, p_action text, p_reason text default null, p_photo_path text default null,
  p_amount numeric default null)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_wid uuid := public.fn_my_worker_id();
  v_task public.worker_tasks%rowtype;
  v_name text;
  v_pending integer;
begin
  if auth.uid() is null then raise exception 'Bejelentkezés szükséges.'; end if;
  select * into v_task from public.worker_tasks
  where id = p_id and deleted_at is null for update;
  if not found then raise exception 'A feladat nem található.'; end if;
  if v_wid is null or not exists (
    select 1 from public.task_assignees where task_id = p_id and worker_id = v_wid and deleted_at is null
  ) then
    raise exception 'Ez a feladat nem hozzád tartozik.';
  end if;

  select name into v_name from public.workers where id = v_wid;

  if p_action = 'acknowledge' then
    update public.task_assignees set acknowledged_at = coalesce(acknowledged_at, now())
    where task_id = p_id and worker_id = v_wid;
    -- ha már mindenki visszaigazolt, a feladat is „visszaigazolt”
    select count(*) into v_pending from public.task_assignees
    where task_id = p_id and deleted_at is null and acknowledged_at is null;
    if v_pending = 0 and v_task.status = 'assigned' then
      update public.worker_tasks set status = 'acknowledged', acknowledged_at = now() where id = p_id;
    end if;
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_task.created_by, 'Feladat visszaigazolva ✅',
            coalesce(v_name, 'A munkavállaló') || ' megkapta és csinálja: ' || v_task.title,
            jsonb_build_object('task_id', p_id));

  elsif p_action = 'quote' then
    if p_amount is null or p_amount <= 0 then raise exception 'Adj meg ajánlati összeget.'; end if;
    update public.worker_tasks
    set quote_amount = p_amount, quote_note = nullif(trim(coalesce(p_reason, '')), ''),
        quote_submitted_at = now(), quote_accepted_at = null, quote_accepted_by = null
    where id = p_id;
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_task.created_by, 'Ajánlat érkezett 💬',
            coalesce(v_name, 'A munkavállaló') || ' ajánlata: ' || to_char(p_amount, 'FM999 999 999')
            || ' Ft — ' || v_task.title || ' (fogadd el az appban)',
            jsonb_build_object('task_id', p_id));

  elsif p_action = 'done' then
    if v_task.status not in ('assigned', 'acknowledged') then
      raise exception 'Ez a feladat már le van zárva.';
    end if;
    update public.worker_tasks
    set status = 'done', done_at = now(), acknowledged_at = coalesce(acknowledged_at, now())
    where id = p_id;
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_task.created_by, 'Feladat elkészült ✔️',
            coalesce(v_name, 'A munkavállaló') || ' elkészült: ' || v_task.title,
            jsonb_build_object('task_id', p_id));

  elsif p_action = 'fail' then
    if v_task.status not in ('assigned', 'acknowledged') then
      raise exception 'Ez a feladat már le van zárva.';
    end if;
    if p_reason is null or length(trim(p_reason)) < 3 then
      raise exception 'Kötelező megindokolni, miért nem sikerült a feladat.';
    end if;
    update public.worker_tasks
    set status = 'failed', done_at = now(), fail_reason = trim(p_reason),
        fail_photo_path = p_photo_path, acknowledged_at = coalesce(acknowledged_at, now())
    where id = p_id;
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_task.created_by, 'Feladat nem sikerült ⚠️',
            coalesce(v_name, 'A munkavállaló') || ': ' || v_task.title
            || ' — indok: ' || trim(p_reason),
            jsonb_build_object('task_id', p_id));
  else
    raise exception 'Ismeretlen művelet.';
  end if;
end;
$$;

-- partner: ajánlat elfogadása → a munkavállaló értesül
create or replace function public.accept_task_quote(p_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_task public.worker_tasks%rowtype;
  r record;
begin
  if auth.uid() is null or not public.fn_is_partner() then
    raise exception 'Ajánlatot csak a fő felhasználók fogadhatnak el.';
  end if;
  select * into v_task from public.worker_tasks where id = p_id and deleted_at is null for update;
  if not found then raise exception 'A feladat nem található.'; end if;
  if v_task.quote_amount is null then raise exception 'Még nincs ajánlat ehhez a feladathoz.'; end if;
  update public.worker_tasks set quote_accepted_at = now(), quote_accepted_by = auth.uid() where id = p_id;
  for r in
    select p.id from public.task_assignees a join public.profiles p on p.worker_id = a.worker_id
    where a.task_id = p_id and a.deleted_at is null
  loop
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', r.id, 'Ajánlat elfogadva ✅',
            'Elfogadták az ajánlatodat (' || to_char(v_task.quote_amount, 'FM999 999 999') || ' Ft): '
            || v_task.title || ' — kezdheted, igazold vissza!',
            jsonb_build_object('task_id', p_id));
  end loop;
end;
$$;

-- realtime
do $$
declare t text;
begin
  foreach t in array array['task_assignees', 'task_materials']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- a munkavállaló a task_assignees szerint hozzá kiosztott feladatokat látja
-- (a régi worker_id oszlop már nem mérvadó)
drop policy if exists wt_select on public.worker_tasks;
create policy wt_select on public.worker_tasks for select to authenticated
  using (
    public.fn_is_partner()
    or exists (
      select 1 from public.task_assignees a
      where a.task_id = worker_tasks.id and a.worker_id = public.fn_my_worker_id() and a.deleted_at is null
    )
  );
