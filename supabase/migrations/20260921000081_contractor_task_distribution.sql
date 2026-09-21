-- Vállalkozó és az emberei (2026-09-21, Daniel kérése):
--  1) a vállalkozó EMBERE csak a rá osztott, még futó feladatot látja — a
--     lezártakat (kész / nem sikerült / visszavonva) nem;
--  2) a vállalkozó az általa elvállalt feladatot szétoszthatja az emberei között;
--     az ember visszaigazolja és le is zárhatja.

-- a bejelentkezett munkavállaló egy vállalkozó embere-e
create or replace function public.fn_is_crew_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workers w
                 where w.id = public.fn_my_worker_id() and w.contractor_id is not null);
$$;
revoke execute on function public.fn_is_crew_member() from public, anon;
grant execute on function public.fn_is_crew_member() to authenticated;

drop policy if exists wt_select on public.worker_tasks;
create policy wt_select on public.worker_tasks for select to authenticated
  using (public.fn_is_partner() or (
    exists (select 1 from public.task_assignees a
            where a.task_id = worker_tasks.id and a.worker_id = public.fn_my_worker_id() and a.deleted_at is null)
    and (status in ('assigned', 'acknowledged') or not public.fn_is_crew_member())));

-- ajánlatkérés a vállalkozó dolga: az emberének nem nyitunk ajánlatkérést
create or replace function public.fn_quote_on_assign()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_task public.worker_tasks%rowtype;
begin
  if exists (select 1 from public.workers w where w.id = new.worker_id and w.contractor_id is not null) then
    return new;
  end if;
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
revoke execute on function public.fn_quote_on_assign() from public, anon, authenticated;

-- a vállalkozó embere ajánlatkéréses feladatot is visszaigazolhat (az ajánlatot a vállalkozó adta)
do $$
declare v_def text; v_old text := 'if v_task.quote_requested and (v_q.id is null';
begin
  v_def := pg_get_functiondef('public.worker_task_action(uuid,text,text,text,numeric,text[])'::regprocedure);
  if position('fn_is_crew_member' in v_def) = 0 then
    if position(v_old in v_def) = 0 then raise exception 'worker_task_action: a várt szövegrész nem található'; end if;
    v_def := replace(v_def, v_old, 'if v_task.quote_requested and not public.fn_is_crew_member() and (v_q.id is null');
    execute v_def;
  end if;
end $$;

-- szétosztás: a teljes kívánt névsort adja át (akit kihagy, azt leveszi a feladatról)
create or replace function public.contractor_assign_task(p_task uuid, p_workers uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_wid uuid := public.fn_my_worker_id();
  v_task public.worker_tasks%rowtype;
  v_w uuid;
begin
  if v_wid is null or not exists (select 1 from public.workers where id = v_wid and is_contractor and deleted_at is null) then
    raise exception 'Nincs jogosultságod a feladat szétosztásához.';
  end if;
  select * into v_task from public.worker_tasks where id = p_task and deleted_at is null for update;
  if not found then raise exception 'A feladat nem található.'; end if;
  if v_task.status not in ('assigned', 'acknowledged') then raise exception 'Ez a feladat már le van zárva.'; end if;
  if not exists (select 1 from public.task_assignees a where a.task_id = p_task and a.worker_id = v_wid
                 and a.deleted_at is null and a.acknowledged_at is not null) then
    raise exception 'Előbb fogadd el a feladatot, utána oszthatod szét az embereid között.';
  end if;
  if exists (select 1 from unnest(coalesce(p_workers, '{}'::uuid[])) x
             where not exists (select 1 from public.workers w where w.id = x and w.contractor_id = v_wid and w.deleted_at is null)) then
    raise exception 'Csak a saját embereidre oszthatsz feladatot.';
  end if;

  -- akit kihagyott: lekerül (a rögzített munkaideje megmarad)
  update public.task_assignees a set deleted_at = now()
  where a.task_id = p_task and a.deleted_at is null
    and a.worker_id in (select id from public.workers where contractor_id = v_wid)
    and not (a.worker_id = any(coalesce(p_workers, '{}'::uuid[])));

  foreach v_w in array coalesce(p_workers, '{}'::uuid[]) loop
    -- fiókkal rendelkező ember maga igazol vissza; fiók nélkülinél a vállalkozó kiosztása a visszaigazolás
    insert into public.task_assignees (task_id, worker_id, acknowledged_at)
    values (p_task, v_w, case when exists (select 1 from public.profiles p where p.worker_id = v_w) then null else now() end)
    on conflict (task_id, worker_id) do update
      set deleted_at = null,
          acknowledged_at = case when task_assignees.deleted_at is null then task_assignees.acknowledged_at
                                 else excluded.acknowledged_at end;
  end loop;
end $$;
revoke execute on function public.contractor_assign_task(uuid, uuid[]) from public, anon;
grant execute on function public.contractor_assign_task(uuid, uuid[]) to authenticated;
