-- Ajánlatkérés napló: feladatonként és munkavállalónként egy sor minden
-- ajánlatkérésre (kérés → ajánlat → elfogadva / elutasítva / nem vállalja).
-- A munkavállaló ajánlatkérésnél nem „fogadja el” a feladatot: ajánlatot ad
-- vagy nem vállalja; az elfogadott ajánlat egyben a feladat elfogadása is.

create table if not exists public.task_quotes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.worker_tasks(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  requested_by uuid references public.profiles(id),
  requested_at timestamptz not null default now(),
  amount numeric check (amount is null or amount > 0),
  note text,
  submitted_at timestamptz,
  status text not null default 'requested'
    check (status in ('requested', 'submitted', 'accepted', 'rejected', 'declined')),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id),
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists task_quotes_task_idx on public.task_quotes(task_id);
create index if not exists task_quotes_worker_idx on public.task_quotes(worker_id);
create index if not exists task_quotes_updated_idx on public.task_quotes(updated_at);

drop trigger if exists trg_touch_task_quotes on public.task_quotes;
create trigger trg_touch_task_quotes before insert or update on public.task_quotes
  for each row execute function public.fn_touch_updated_at();

alter table public.task_quotes enable row level security;
drop policy if exists tq_select on public.task_quotes;
create policy tq_select on public.task_quotes for select to authenticated
  using (public.fn_is_partner() or worker_id = public.fn_my_worker_id());
-- írás csak az RPC-ken át (security definer)
grant select on public.task_quotes to authenticated;
revoke all on public.task_quotes from anon;

do $$ begin
  execute 'alter publication supabase_realtime add table public.task_quotes';
exception when duplicate_object then null; end $$;

-- meglévő ajánlatkérős feladatok átemelése a naplóba
insert into public.task_quotes (task_id, worker_id, requested_by, requested_at, amount, note, submitted_at, status, decided_at, decided_by)
select t.id, a.worker_id, t.created_by, t.created_at, t.quote_amount, t.quote_note, t.quote_submitted_at,
       case when t.quote_accepted_at is not null then 'accepted'
            when t.quote_amount is not null then 'submitted'
            else 'requested' end,
       t.quote_accepted_at, t.quote_accepted_by
from public.worker_tasks t
join public.task_assignees a on a.task_id = t.id and a.deleted_at is null
where t.quote_requested and t.deleted_at is null and t.status in ('assigned', 'acknowledged')
  and not exists (select 1 from public.task_quotes q where q.task_id = t.id and q.worker_id = a.worker_id);

-- ajánlatkérős feladat kiosztásakor automatikusan nyílik egy kérés-sor
create or replace function public.fn_quote_on_assign()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_task public.worker_tasks%rowtype;
begin
  select * into v_task from public.worker_tasks where id = new.task_id;
  if v_task.quote_requested and new.deleted_at is null and not exists (
    select 1 from public.task_quotes q
    where q.task_id = new.task_id and q.worker_id = new.worker_id and q.deleted_at is null
      and q.status in ('requested', 'submitted', 'accepted')
  ) then
    insert into public.task_quotes (task_id, worker_id, requested_by)
    values (new.task_id, new.worker_id, coalesce(auth.uid(), v_task.created_by));
  end if;
  return new;
end $$;
drop trigger if exists trg_quote_on_assign on public.task_assignees;
create trigger trg_quote_on_assign after insert on public.task_assignees
  for each row execute function public.fn_quote_on_assign();

-- fő felhasználók értesítése (a munkavállalói fiókok kivételével)
create or replace function public.fn_notify_partners(p_kind text, p_title text, p_body text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.profiles where worker_id is null loop
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values (p_kind, r.id, p_title, p_body, p_payload);
  end loop;
end $$;

-- ---------- munkavállalói műveletek ----------
create or replace function public.worker_task_action(
  p_id uuid, p_action text, p_reason text default null, p_photo_path text default null,
  p_amount numeric default null, p_photo_paths text[] default null)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_wid uuid := public.fn_my_worker_id();
  v_task public.worker_tasks%rowtype;
  v_name text;
  v_pending integer;
  v_paths text[];
  v_q public.task_quotes%rowtype;
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

  select coalesce(nickname, name) into v_name from public.workers where id = v_wid;
  -- a legutóbbi ajánlat-sorom ehhez a feladathoz
  select * into v_q from public.task_quotes
  where task_id = p_id and worker_id = v_wid and deleted_at is null
  order by requested_at desc limit 1;

  if p_action = 'acknowledge' then
    if v_task.quote_requested and (v_q.id is null or v_q.status <> 'accepted') then
      raise exception 'Ajánlatkérésnél nem kell elfogadni a feladatot — adj ajánlatot, vagy jelezd, hogy nem vállalod.';
    end if;
    update public.task_assignees set acknowledged_at = coalesce(acknowledged_at, now())
    where task_id = p_id and worker_id = v_wid;
    select count(*) into v_pending from public.task_assignees
    where task_id = p_id and deleted_at is null and acknowledged_at is null;
    if v_pending = 0 and v_task.status = 'assigned' then
      update public.worker_tasks set status = 'acknowledged', acknowledged_at = now() where id = p_id;
    end if;
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_task.created_by, 'Feladat elfogadva ✅',
            coalesce(v_name, 'A munkavállaló') || ' elfogadta a feladatot: ' || v_task.title,
            jsonb_build_object('task_id', p_id));

  elsif p_action = 'quote' then
    if p_amount is null or p_amount <= 0 then raise exception 'Adj meg ajánlati összeget.'; end if;
    if v_q.id is not null and v_q.status = 'accepted' then
      raise exception 'Az ajánlatodat már elfogadták.';
    end if;
    if v_q.id is null or v_q.status not in ('requested', 'submitted') then
      -- nincs nyitott kérés (régi adat): nyitunk egyet, hogy legyen napló
      insert into public.task_quotes (task_id, worker_id, requested_by)
      values (p_id, v_wid, v_task.created_by) returning * into v_q;
    end if;
    update public.task_quotes
    set amount = p_amount, note = nullif(trim(coalesce(p_reason, '')), ''),
        submitted_at = now(), status = 'submitted'
    where id = v_q.id;
    perform public.fn_notify_partners('task', 'Ajánlat érkezett 💬',
      coalesce(v_name, 'A munkavállaló') || ' ajánlata: ' || trim(to_char(p_amount, 'FM999 999 999'))
      || ' Ft — ' || v_task.title || ' (fogadd el vagy utasítsd el az appban)',
      jsonb_build_object('task_id', p_id));

  elsif p_action = 'decline_quote' then
    if v_q.id is null or v_q.status not in ('requested', 'submitted') then
      raise exception 'Nincs nyitott ajánlatkérésed ehhez a feladathoz.';
    end if;
    update public.task_quotes
    set status = 'declined', decided_at = now(), decided_by = auth.uid(),
        decision_note = nullif(trim(coalesce(p_reason, '')), '')
    where id = v_q.id;
    -- lekerül a listájáról; a napló megmarad
    update public.task_assignees set deleted_at = now()
    where task_id = p_id and worker_id = v_wid and deleted_at is null;
    perform public.fn_notify_partners('task', 'Nem vállalja ✋',
      coalesce(v_name, 'A munkavállaló') || ' nem vállalja: ' || v_task.title
      || coalesce(' — ' || nullif(trim(coalesce(p_reason, '')), ''), '')
      || ' (kérhetsz új ajánlatot az appban)',
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
    v_paths := coalesce(p_photo_paths, case when p_photo_path is null then '{}'::text[] else array[p_photo_path] end);
    update public.worker_tasks
    set status = 'failed', done_at = now(), fail_reason = trim(p_reason),
        fail_photo_path = v_paths[1], fail_photo_paths = v_paths,
        acknowledged_at = coalesce(acknowledged_at, now())
    where id = p_id;
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_task.created_by, 'Feladat nem sikerült ⚠️',
            coalesce(v_name, 'A munkavállaló') || ': ' || v_task.title
            || ' — indok: ' || trim(p_reason)
            || case when cardinality(v_paths) > 0 then ' (' || cardinality(v_paths) || ' fotó)' else '' end,
            jsonb_build_object('task_id', p_id));
  else
    raise exception 'Ismeretlen művelet.';
  end if;
end;
$$;

-- ---------- partneri műveletek ----------
-- ajánlat elfogadása (p_id = az ajánlat-sor azonosítója): a nyertes
-- munkavállaló feladata ezzel elfogadottá válik, a többi nyitott ajánlat
-- elutasítva, a többi jelentkező lekerül a feladatról
create or replace function public.accept_task_quote(p_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_q public.task_quotes%rowtype;
  v_task public.worker_tasks%rowtype;
  v_prof uuid;
  v_pending integer;
  r record;
begin
  if auth.uid() is null or not public.fn_is_partner() then
    raise exception 'Ajánlatot csak a fő felhasználók fogadhatnak el.';
  end if;
  select * into v_q from public.task_quotes where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Az ajánlat nem található.'; end if;
  if v_q.status <> 'submitted' then raise exception 'Csak beküldött ajánlat fogadható el.'; end if;
  select * into v_task from public.worker_tasks where id = v_q.task_id and deleted_at is null for update;
  if not found then raise exception 'A feladat nem található.'; end if;

  update public.task_quotes set status = 'accepted', decided_at = now(), decided_by = auth.uid() where id = p_id;
  update public.worker_tasks
  set quote_requested = true, quote_amount = v_q.amount, quote_note = v_q.note, quote_submitted_at = v_q.submitted_at,
      quote_accepted_at = now(), quote_accepted_by = auth.uid()
  where id = v_task.id;

  -- a nyertes kiosztása + automatikus elfogadás
  insert into public.task_assignees (task_id, worker_id, acknowledged_at)
  values (v_task.id, v_q.worker_id, now())
  on conflict (task_id, worker_id) do update set deleted_at = null, acknowledged_at = coalesce(public.task_assignees.acknowledged_at, now());

  -- a többi nyitott ajánlat: elutasítva, jelentkező lekerül a feladatról
  for r in
    select q.id, q.worker_id, p.id as profile_id from public.task_quotes q
    left join public.profiles p on p.worker_id = q.worker_id
    where q.task_id = v_task.id and q.id <> p_id and q.deleted_at is null and q.status in ('requested', 'submitted')
  loop
    update public.task_quotes set status = 'rejected', decided_at = now(), decided_by = auth.uid(),
      decision_note = 'másik ajánlatot fogadtak el' where id = r.id;
    update public.task_assignees set deleted_at = now() where task_id = v_task.id and worker_id = r.worker_id and deleted_at is null;
    if r.profile_id is not null then
      insert into public.notification_queue (kind, recipient, title, body, payload)
      values ('task', r.profile_id, 'Ajánlatkérés lezárva',
              'Ehhez a feladathoz másik ajánlatot fogadtak el: ' || v_task.title,
              jsonb_build_object('task_id', v_task.id));
    end if;
  end loop;

  select count(*) into v_pending from public.task_assignees
  where task_id = v_task.id and deleted_at is null and acknowledged_at is null;
  if v_pending = 0 and v_task.status = 'assigned' then
    update public.worker_tasks set status = 'acknowledged', acknowledged_at = now() where id = v_task.id;
  end if;

  select id into v_prof from public.profiles where worker_id = v_q.worker_id;
  if v_prof is not null then
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_prof, 'Ajánlat elfogadva ✅',
            'Elfogadták az ajánlatodat (' || trim(to_char(v_q.amount, 'FM999 999 999')) || ' Ft): '
            || v_task.title || ' — a feladat a tiéd, kezdheted!',
            jsonb_build_object('task_id', v_task.id));
  end if;
end;
$$;

-- ajánlat elutasítása (p_id = ajánlat-sor)
create or replace function public.reject_task_quote(p_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_q public.task_quotes%rowtype;
  v_task public.worker_tasks%rowtype;
  v_prof uuid;
begin
  if auth.uid() is null or not public.fn_is_partner() then
    raise exception 'Ajánlatot csak a fő felhasználók utasíthatnak el.';
  end if;
  select * into v_q from public.task_quotes where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Az ajánlat nem található.'; end if;
  if v_q.status not in ('requested', 'submitted') then raise exception 'Ez az ajánlat már le van zárva.'; end if;
  select * into v_task from public.worker_tasks where id = v_q.task_id;
  update public.task_quotes
  set status = 'rejected', decided_at = now(), decided_by = auth.uid(),
      decision_note = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_id;
  update public.task_assignees set deleted_at = now()
  where task_id = v_q.task_id and worker_id = v_q.worker_id and deleted_at is null;
  select id into v_prof from public.profiles where worker_id = v_q.worker_id;
  if v_prof is not null then
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_prof,
            case when v_q.status = 'submitted' then 'Ajánlat elutasítva' else 'Ajánlatkérés visszavonva' end,
            v_task.title || coalesce(' — ' || nullif(trim(coalesce(p_reason, '')), ''), ''),
            jsonb_build_object('task_id', v_q.task_id));
  end if;
end;
$$;

-- új ajánlatkérés egy munkavállalótól (akár ugyanattól újra)
create or replace function public.request_task_quote(p_task uuid, p_worker uuid)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_task public.worker_tasks%rowtype;
  v_qid uuid;
  v_prof uuid;
  v_site text;
  v_existing boolean;
begin
  if auth.uid() is null or not public.fn_is_partner() then
    raise exception 'Ajánlatot csak a fő felhasználók kérhetnek.';
  end if;
  select * into v_task from public.worker_tasks where id = p_task and deleted_at is null for update;
  if not found then raise exception 'A feladat nem található.'; end if;
  if v_task.status not in ('assigned', 'acknowledged') then raise exception 'Lezárt feladathoz nem kérhető ajánlat.'; end if;
  if exists (select 1 from public.task_quotes where task_id = p_task and deleted_at is null and status = 'accepted') then
    raise exception 'Ehhez a feladathoz már elfogadtak egy ajánlatot.';
  end if;
  if exists (select 1 from public.task_quotes where task_id = p_task and worker_id = p_worker and deleted_at is null and status in ('requested', 'submitted')) then
    raise exception 'Ettől a munkavállalótól már van nyitott ajánlatkérés ehhez a feladathoz.';
  end if;
  if not exists (select 1 from public.workers where id = p_worker and deleted_at is null and approved_at is not null) then
    raise exception 'A munkavállaló nem található.';
  end if;

  update public.worker_tasks set quote_requested = true where id = p_task and not quote_requested;

  select exists (select 1 from public.task_assignees where task_id = p_task and worker_id = p_worker) into v_existing;
  if v_existing then
    update public.task_assignees set deleted_at = null, acknowledged_at = null
    where task_id = p_task and worker_id = p_worker;
    -- a beszúrás-trigger itt nem fut: kérés-sor és értesítés kézzel
    insert into public.task_quotes (task_id, worker_id, requested_by) values (p_task, p_worker, auth.uid())
    returning id into v_qid;
    select id into v_prof from public.profiles where worker_id = p_worker;
    if v_prof is not null then
      select name into v_site from public.sites where id = v_task.site_id;
      insert into public.notification_queue (kind, recipient, title, body, payload)
      values ('task', v_prof, 'Ajánlatkérés 💬',
              coalesce(v_task.code || ' — ', '') || v_task.title || coalesce(' · Helyszín: ' || v_site, '')
              || ' — adj ajánlatot az appban!',
              jsonb_build_object('task_id', p_task));
    end if;
  else
    insert into public.task_assignees (task_id, worker_id) values (p_task, p_worker);
    select id into v_qid from public.task_quotes
    where task_id = p_task and worker_id = p_worker and status = 'requested' order by requested_at desc limit 1;
  end if;
  return v_qid;
end;
$$;

revoke all on function public.reject_task_quote(uuid, text) from public, anon;
grant execute on function public.reject_task_quote(uuid, text) to authenticated;
revoke all on function public.request_task_quote(uuid, uuid) from public, anon;
grant execute on function public.request_task_quote(uuid, uuid) to authenticated;
