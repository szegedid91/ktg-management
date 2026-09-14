-- Bér a munkaidő alapján: ha a munkavállaló feladaton dolgozik vagy egy
-- építkezésen bejelentkezik (work_sessions), a lezárt munkamenetekből
-- automatikusan jelenléti/bér-sor (attendance) képződik naponta és
-- építkezésenként — órabéresnél az órák, napidíjasnál a nap alapján.
-- Elfogadott ajánlatos (fix áras) feladatnál a bér a feladat készre
-- jelentésekor, projektdíjként keletkezik.

alter table public.attendance
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'session', 'task')),
  add column if not exists task_id uuid references public.worker_tasks(id) on delete set null;

-- naponta / építkezésenként egy automatikus sor munkavállalónként
create unique index if not exists attendance_session_unique
  on public.attendance (worker_id, site_id, work_date)
  where source = 'session' and deleted_at is null;
create unique index if not exists attendance_task_unique
  on public.attendance (task_id, worker_id)
  where source = 'task' and deleted_at is null;

-- munkavállalói fiók: az aktív építkezéseket látja (bejelentkezéshez választ)
drop policy if exists sites_select on public.sites;
create policy sites_select on public.sites for select to authenticated
  using (
    public.fn_is_partner()
    or (public.fn_my_worker_id() is not null and status = 'active' and deleted_at is null)
    or exists (select 1 from public.task_assignees a join public.worker_tasks t on t.id = a.task_id
               where a.worker_id = public.fn_my_worker_id() and a.deleted_at is null and t.site_id = sites.id)
    or exists (select 1 from public.attendance x where x.worker_id = public.fn_my_worker_id() and x.site_id = sites.id)
    or exists (select 1 from public.work_sessions w where w.worker_id = public.fn_my_worker_id() and w.site_id = sites.id)
  );

-- egy (munkavállaló, építkezés, nap) automatikus bér-sorának újraszámítása
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

  -- lezárt munkamenetek órái aznap, ezen az építkezésen; a fix áras
  -- (elfogadott ajánlatos) feladatok ideje nem órabér
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

  -- a partner kézzel rögzített már erre a napra → az övé érvényes
  if exists (select 1 from public.attendance where worker_id = p_worker and site_id = p_site
             and work_date = p_date and source = 'manual' and deleted_at is null) then
    return;
  end if;
  -- a partner szándékosan törölte az automatikus sort → nem hozzuk vissza
  if v_row.id is null and exists (select 1 from public.attendance where worker_id = p_worker and site_id = p_site
             and work_date = p_date and source = 'session' and deleted_at is not null) then
    return;
  end if;

  v_basis := coalesce(w.default_pay_basis, 'hourly');
  if v_basis = 'project' then v_basis := 'daily'; end if; -- projektdíjas: napi bér a jelenlétért

  if v_row.id is not null then
    if v_row.paid_at is not null then return; end if; -- kifizetett sort nem írunk át
    update public.attendance
    set hours = case when v_basis = 'hourly' then v_hours else null end,
        day_multiplier = case when v_basis = 'daily' and v_hours < 4 then 0.5 else 1 end,
        task_id = coalesce(v_task, task_id),
        note = 'munkaidő alapján (automatikus) · ' || to_char(v_hours, 'FM990.00') || ' óra'
    where id = v_row.id;
    return;
  end if;

  -- a sor „tulajdonosa” a partner (feladat kiadója / építkezés rögzítője),
  -- így a munkavállaló nem szerkesztheti a saját bérét
  select created_by into v_owner from public.worker_tasks where id = v_task;
  if v_owner is null then select created_by into v_owner from public.sites where id = p_site; end if;
  if v_owner is null then select id into v_owner from public.profiles where worker_id is null order by created_at limit 1; end if;

  begin
    insert into public.attendance (work_date, site_id, worker_id, created_by, pay_basis, hours, day_multiplier,
                                   applied_rate, source, task_id, note)
    values (p_date, p_site, p_worker, v_owner, v_basis,
            case when v_basis = 'hourly' then v_hours else null end,
            case when v_basis = 'daily' and v_hours < 4 then 0.5 else 1 end,
            null, 'session', v_task,
            'munkaidő alapján (automatikus) · ' || to_char(v_hours, 'FM990.00') || ' óra');
  exception when others then
    -- pl. lezárt építkezés: a munkaidő megmarad, bér-sor nem készül
    raise notice 'session wage skipped: %', sqlerrm;
  end;
end $$;

create or replace function public.fn_ws_wage_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.fn_recalc_session_wage(old.worker_id, old.site_id, (old.started_at at time zone 'Europe/Budapest')::date);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.fn_recalc_session_wage(new.worker_id, new.site_id, (new.started_at at time zone 'Europe/Budapest')::date);
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_ws_wage on public.work_sessions;
create trigger trg_ws_wage after insert or update or delete on public.work_sessions
  for each row execute function public.fn_ws_wage_trigger();

-- feladaton indított munkaidő: az építkezés a feladaté (ha a kliens nem adta meg)
create or replace function public.fn_ws_default_site()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.site_id is null and new.task_id is not null then
    select site_id into new.site_id from public.worker_tasks where id = new.task_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_ws_default_site on public.work_sessions;
create trigger trg_ws_default_site before insert on public.work_sessions
  for each row execute function public.fn_ws_default_site();

-- fix áras (elfogadott ajánlat) feladat készre jelentése → projektdíj bér-sor
create or replace function public.fn_task_quote_wage(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.worker_tasks%rowtype;
  v_worker uuid;
begin
  select * into t from public.worker_tasks where id = p_task;
  if t.quote_accepted_at is null or t.quote_amount is null or t.site_id is null then return; end if;
  select worker_id into v_worker from public.task_quotes
  where task_id = p_task and status = 'accepted' and deleted_at is null order by decided_at desc limit 1;
  if v_worker is null then
    select worker_id into v_worker from public.task_assignees where task_id = p_task and deleted_at is null limit 1;
  end if;
  if v_worker is null then return; end if;
  if exists (select 1 from public.attendance where task_id = p_task and worker_id = v_worker and source = 'task' and deleted_at is null) then return; end if;
  begin
    insert into public.attendance (work_date, site_id, worker_id, created_by, pay_basis, hours, day_multiplier,
                                   applied_rate, source, task_id, note)
    values ((coalesce(t.done_at, now()) at time zone 'Europe/Budapest')::date, t.site_id, v_worker, t.created_by,
            'project', null, 1, t.quote_amount, 'task', p_task,
            'elfogadott ajánlat: ' || coalesce(t.code || ' ', '') || t.title);
  exception when others then
    raise notice 'task wage skipped: %', sqlerrm;
  end;
end $$;

create or replace function public.fn_task_done_wage()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and (old.status is distinct from 'done') then
    perform public.fn_task_quote_wage(new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_task_done_wage on public.worker_tasks;
create trigger trg_task_done_wage after update of status on public.worker_tasks
  for each row execute function public.fn_task_done_wage();

-- a már lezárt munkamenetek visszamenőleges átszámítása
do $$
declare r record;
begin
  for r in
    select distinct s.worker_id, s.site_id, (s.started_at at time zone 'Europe/Budapest')::date as d
    from public.work_sessions s
    where s.deleted_at is null and s.ended_at is not null and s.site_id is not null
  loop
    perform public.fn_recalc_session_wage(r.worker_id, r.site_id, r.d);
  end loop;
  for r in select id from public.worker_tasks where status = 'done' and quote_accepted_at is not null and deleted_at is null loop
    perform public.fn_task_quote_wage(r.id);
  end loop;
end $$;
