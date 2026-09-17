-- Biztonsági és logikai átvilágítás 2026-09-17 (adatbázis rész):
--  A) profiles_v / workers_v: NEM írható (auto-updatable nézet + öröklött DML-jog); is_admin maszkolva
--  B) allowed_emails: csak admin írhat (a „még nincs admin” ág RLS alatt hamisan igaz volt munkavállalónak)
--  C) work_sessions: munkavállaló nem dátumozhat vissza, nem indíthat párhuzamos menetet, nem írhat jövőbe,
--     inaktív építkezésre, jóváhagyott hétbe; napi 16 óra plafon; törölt auto-sor csak új menetnél éled újra
--  D) fn_timesheet_totals és trigger-függvények: nem hívhatók a kliensről; jövőbeli objektumok alapból zártak
--  E) kiosztás-változás értesítés: nincs önértesítés / duplikátum; megjegyzés: szerkesztésről nincs értesítés
--  F) comments csak partner (vagy szerző), app_settings csak partner
--  G) task_notes.author_name: a szerző neve a sorban (munkavállaló-társ nem látja a profilt)
--  H) jóváhagyott óralap-hét pillanatképe frissül, ha a fő felhasználó utólag javít

-- A) nézetek
revoke insert, update, delete, truncate, references, trigger on public.profiles_v from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.workers_v from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke insert, update, delete, truncate, references, trigger on tables from authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
create or replace view public.profiles_v with (security_barrier = true) as
  select p.id,
         p.display_name,
         case when p.id = auth.uid() or public.fn_is_partner() then p.email end as email,
         case when public.fn_is_partner() then p.is_admin else false end as is_admin,
         p.worker_id,
         case when p.id = auth.uid() or public.fn_is_partner() then p.profit_share_percent else 0 end as profit_share_percent,
         case when p.id = auth.uid() then p.push_token end as push_token,
         case when p.id = auth.uid() or public.fn_is_partner() then p.notify_comments else false end as notify_comments,
         case when p.id = auth.uid() or public.fn_is_partner() then p.notify_big_expense else false end as notify_big_expense,
         case when p.id = auth.uid() or public.fn_is_partner() then p.big_expense_threshold else 0 end as big_expense_threshold,
         case when p.id = auth.uid() or public.fn_is_partner() then p.notify_weekly else false end as notify_weekly,
         case when p.id = auth.uid() or public.fn_is_partner() then p.notify_overdue else false end as notify_overdue,
         case when p.id = auth.uid() or public.fn_is_partner() then p.overdue_days else 0 end as overdue_days,
         p.created_at,
         p.updated_at
  from public.profiles p
  where auth.uid() is not null
    and (p.id = auth.uid() or p.worker_id is null or public.fn_is_partner());

alter view public.profiles_v set (security_invoker = false);
revoke all on public.profiles_v from public, anon;
grant select on public.profiles_v to authenticated;

-- B) admin-e a hívó (definer: nem az RLS alatt látszó sorokból dönt)
create or replace function public.fn_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_admin);
$$;
revoke execute on function public.fn_is_admin() from public, anon;
grant execute on function public.fn_is_admin() to authenticated;
create or replace function public.fn_no_admin_exists()
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where is_admin);
$$;
revoke execute on function public.fn_no_admin_exists() from public, anon;
grant execute on function public.fn_no_admin_exists() to authenticated;
drop policy if exists allowed_emails_insert on public.allowed_emails;
create policy allowed_emails_insert on public.allowed_emails for insert to authenticated
  with check (public.fn_is_admin() or (public.fn_is_partner() and public.fn_no_admin_exists()));
drop policy if exists allowed_emails_delete on public.allowed_emails;
create policy allowed_emails_delete on public.allowed_emails for delete to authenticated
  using (public.fn_is_admin() or (public.fn_is_partner() and public.fn_no_admin_exists()));
drop policy if exists allowed_emails_update on public.allowed_emails;
create policy allowed_emails_update on public.allowed_emails for update to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

-- H) jóváhagyott hét pillanatképe (a fő felhasználó utólagos javítása után is egyezzen)
create or replace function public.fn_refresh_timesheet_snapshot(p_worker uuid, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare v_week date := public.fn_week_start(p_date); v_t record;
begin
  if exists (select 1 from public.timesheets t where t.worker_id = p_worker and t.week_start = v_week and t.deleted_at is null) then
    select * into v_t from public.fn_timesheet_totals(p_worker, v_week);
    update public.timesheets set hours = v_t.hours, amount = v_t.amount, days = v_t.days
     where worker_id = p_worker and week_start = v_week and deleted_at is null;
  end if;
end $$;
revoke execute on function public.fn_refresh_timesheet_snapshot(uuid, date) from public, anon, authenticated;

-- C) munkamenet-őr + bér-újraszámolás
create or replace function public.fn_ws_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ended_at is not null then
    if new.ended_at <= new.started_at then
      raise exception 'A befejezés a kezdés után kell legyen.';
    end if;
    if new.ended_at - new.started_at > interval '16 hours' then
      new.ended_at := new.started_at + interval '16 hours';
      new.note := coalesce(new.note || ' · ', '') || '16 órára korlátozva (nem lett lezárva)';
    end if;
  end if;
  if auth.uid() is not null and not public.fn_is_partner() then
    -- munkavállaló: csak „most” indítható menet (visszadátumozni a fő felhasználó tud),
    -- egyszerre egy nyitott menet, a befejezés nem lehet a jövőben
    if tg_op = 'INSERT' then
      if new.started_at < now() - interval '24 hours' or new.started_at > now() + interval '5 minutes' then
        raise exception 'Munkamenet csak most indítható — korábbi napot a fő felhasználó rögzít utólag.';
      end if;
      if exists (select 1 from public.work_sessions s where s.worker_id = new.worker_id and s.ended_at is null and s.deleted_at is null) then
        raise exception 'Ennek a munkavállalónak már fut egy munkamenete.';
      end if;
    end if;
    if new.ended_at is not null and new.ended_at > now() + interval '5 minutes' then
      raise exception 'A befejezés nem lehet a jövőben.';
    end if;
    if new.site_id is not null and not exists (select 1 from public.sites s where s.id = new.site_id and s.deleted_at is null and s.status = 'active') then
      raise exception 'Az építkezés nem aktív — nem lehet rá bejelentkezni.';
    end if;
    -- jóváhagyott óralapú hétbe munkavállaló már nem írhat (a jóváhagyott összeg nem változhat)
    if exists (select 1 from public.timesheets t where t.worker_id = new.worker_id and t.deleted_at is null and t.status = 'approved'
               and t.week_start = public.fn_week_start((new.started_at at time zone 'Europe/Budapest')::date)) then
      raise exception 'Ezt a hetet a fő felhasználó már jóváhagyta — módosítást tőle kérj.';
    end if;
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.fn_is_partner() then
    if new.worker_id <> old.worker_id or new.started_at <> old.started_at
       or new.site_id is distinct from old.site_id or new.task_id is distinct from old.task_id
       or new.created_by <> old.created_by or new.deleted_at is distinct from old.deleted_at then
      raise exception 'A munkamenetnek csak a befejezését állíthatod be.';
    end if;
    if old.ended_at is not null and new.ended_at is distinct from old.ended_at then
      raise exception 'Lezárt munkamenet már nem módosítható — szólj a fő felhasználónak.';
    end if;
  end if;
  return new;
end $$;
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

  select coalesce(sum(extract(epoch from (s.ended_at - s.started_at)) / 3600.0), 0),
         (array_agg(s.task_id) filter (where s.task_id is not null))[1]
    into v_hours, v_task
  from public.work_sessions s
  left join public.worker_tasks t on t.id = s.task_id
  where s.worker_id = p_worker and s.site_id = p_site and s.deleted_at is null
    and s.ended_at is not null
    and (s.started_at at time zone 'Europe/Budapest')::date = p_date
    and (t.id is null or t.quote_accepted_at is null);
  -- minden megkezdett óra teljes óra
  v_hours := least(ceil(round(v_hours, 4)), 16); -- napi plafon: egy nap legfeljebb 16 óra

  select * into v_row from public.attendance
  where worker_id = p_worker and site_id = p_site and work_date = p_date
    and source = 'session' and deleted_at is null;

  perform set_config('app.allow_paid_tick', 'on', true);

  if v_hours <= 0 then
    if v_row.id is not null and v_row.paid_at is null then
      begin
        update public.attendance set deleted_at = now() where id = v_row.id;
      exception when others then raise notice 'session wage delete skipped: %', sqlerrm; end;
    end if;
    return;
  end if;

  if exists (select 1 from public.attendance where worker_id = p_worker and site_id = p_site
             and work_date = p_date and source = 'manual' and deleted_at is null) then
    return;
  end if;
  if v_row.id is null then
    -- a partner által törölt automatikus sor: csak akkor éled újra, ha a törlés
    -- UTÁN rögzítettek új munkamenetet (különben a törlés szándékos marad)
    select * into v_row from public.attendance
    where worker_id = p_worker and site_id = p_site and work_date = p_date and source = 'session'
      and deleted_at is not null and paid_at is null
    order by deleted_at desc limit 1;
    if v_row.id is not null then
      if exists (select 1 from public.work_sessions s where s.worker_id = p_worker and s.site_id = p_site and s.deleted_at is null
                 and (s.started_at at time zone 'Europe/Budapest')::date = p_date and s.created_at > v_row.deleted_at) then
        update public.attendance set deleted_at = null where id = v_row.id;
        v_row.deleted_at := null;
      else
        return;
      end if;
    end if;
  end if;

  v_basis := public.fn_worker_auto_basis(p_worker);

  if v_row.id is not null then
    if v_row.paid_at is not null then return; end if;
    begin
      update public.attendance
      set pay_basis = v_basis,
          applied_rate = case when v_row.pay_basis = v_basis then applied_rate else null end,
          hours = case when v_basis = 'hourly' then v_hours else null end,
          day_multiplier = 1,
          task_id = coalesce(v_task, task_id),
          note = 'munkaidő alapján (automatikus) · ' || to_char(v_hours, 'FM990') || ' óra (megkezdett órák)'
      where id = v_row.id;
    exception when others then raise notice 'session wage update skipped: %', sqlerrm; end;
    perform public.fn_refresh_timesheet_snapshot(p_worker, p_date);
    return;
  end if;

  select created_by into v_owner from public.worker_tasks where id = v_task;
  if v_owner is null then select created_by into v_owner from public.sites where id = p_site; end if;
  if v_owner is null then select id into v_owner from public.profiles where worker_id is null order by created_at limit 1; end if;

  begin
    insert into public.attendance (work_date, site_id, worker_id, created_by, pay_basis, hours, day_multiplier,
                                   applied_rate, source, task_id, note)
    values (p_date, p_site, p_worker, v_owner, v_basis,
            case when v_basis = 'hourly' then v_hours else null end,
            1, null, 'session', v_task,
            'munkaidő alapján (automatikus) · ' || to_char(v_hours, 'FM990') || ' óra (megkezdett órák)');
  exception when others then
    raise notice 'session wage skipped: %', sqlerrm;
  end;
  perform public.fn_refresh_timesheet_snapshot(p_worker, p_date);
end $$;

-- D) függvényjogok
revoke execute on function public.fn_timesheet_totals(uuid, date) from public, anon, authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
revoke execute on function public.fn_week_start(date) from public, anon;
grant execute on function public.fn_week_start(date) to authenticated;

-- E) értesítések
create or replace function public.fn_notify_assignee_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_profile uuid;
  v_task public.worker_tasks%rowtype;
begin
  select id into v_profile from public.profiles where worker_id = new.worker_id;
  if v_profile is null then return new; end if;
  -- a saját (munkavállalói) művelete — pl. ajánlat visszautasítása — nem „levétel”
  if v_profile = auth.uid() then return new; end if;
  -- ugyanarról a feladatról néhány másodpercen belül már ment értesítés (RPC-k saját üzenete): nem duplázunk
  if exists (select 1 from public.notification_queue q where q.recipient = v_profile
             and q.payload->>'task_id' = new.task_id::text and q.created_at > now() - interval '10 seconds') then
    return new;
  end if;
  select * into v_task from public.worker_tasks where id = new.task_id;
  if old.deleted_at is null and new.deleted_at is not null then
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_profile, 'Levettek egy feladatról',
            coalesce(v_task.code || ' — ', '') || v_task.title || ' — a fő felhasználók másra osztották. A rögzített munkaidőd megmarad.',
            jsonb_build_object('task_id', new.task_id));
  elsif old.deleted_at is not null and new.deleted_at is null then
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_profile,
            case when v_task.quote_requested then 'Ajánlatkérés 💬' else 'Új feladat 🛠️' end,
            coalesce(v_task.code || ' — ', '') || v_task.title
            || case when v_task.quote_requested then ' — adj ajánlatot az appban!' else ' — igazold vissza az appban!' end,
            jsonb_build_object('task_id', new.task_id));
  end if;
  return new;
end;
$$;
create or replace function public.fn_notify_task_note()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_task public.worker_tasks%rowtype; v_author text; v_is_worker boolean;
begin
  if new.deleted_at is not null or not new.visible_to_workers then return new; end if;
  -- szerkesztésről nem megy értesítés (csak új megjegyzés, vagy amikor láthatóvá válik)
  if tg_op = 'UPDATE' and old.visible_to_workers and old.deleted_at is null then return new; end if;
  select * into v_task from public.worker_tasks where id = new.task_id;
  select coalesce(w.nickname, w.name, p.display_name), p.worker_id is not null
    into v_author, v_is_worker
  from public.profiles p left join public.workers w on w.id = p.worker_id where p.id = new.created_by;
  for r in select p.id from public.task_assignees a join public.profiles p on p.worker_id = a.worker_id
           where a.task_id = new.task_id and a.deleted_at is null and p.id <> new.created_by
  loop
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', r.id, 'Megjegyzés a feladathoz 📝',
            coalesce(v_task.code || ' — ', '') || v_task.title || ' · ' || coalesce(v_author, '?') || ': ' || left(new.body, 140),
            jsonb_build_object('task_id', new.task_id));
  end loop;
  if v_is_worker then
    perform public.fn_notify_partners('task', 'Munkavállalói megjegyzés 📝',
      coalesce(v_task.code || ' — ', '') || v_task.title || ' · ' || coalesce(v_author, '?') || ': ' || left(new.body, 140),
      jsonb_build_object('task_id', new.task_id));
  end if;
  return new;
end $$;

-- F) kommentek és beállítások láthatósága
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select to authenticated
  using (public.fn_is_partner() or author_id = auth.uid());
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings for select to authenticated
  using (public.fn_is_partner());

-- G) megjegyzés szerzőjének neve
alter table public.task_notes add column if not exists author_name text;
create or replace function public.fn_task_note_author()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.author_name is null then
    select coalesce(w.nickname, w.name, p.display_name) into new.author_name
    from public.profiles p left join public.workers w on w.id = p.worker_id where p.id = new.created_by;
  end if;
  return new;
end $$;
drop trigger if exists trg_task_note_author on public.task_notes;
create trigger trg_task_note_author before insert on public.task_notes
  for each row execute function public.fn_task_note_author();
update public.task_notes n set author_name = coalesce(w.nickname, w.name, p.display_name)
  from public.profiles p left join public.workers w on w.id = p.worker_id
  where p.id = n.created_by and n.author_name is null;
