-- Vállalkozó munkavállaló saját emberekkel: a vállalkozó (fiókkal) felviszi
-- az embereit (fiók nélkül), bejelentkezteti őket munkára; az emberek bére
-- emberenként részletezve képződik, de a kifizetés a vállalkozóhoz megy.

alter table public.workers
  add column if not exists is_contractor boolean not null default false,
  add column if not exists contractor_id uuid references public.workers(id) on delete set null;
create index if not exists workers_contractor_idx on public.workers(contractor_id) where contractor_id is not null;

-- a saját munkavállaló-azonosítóm + az embereimé (vállalkozónál)
create or replace function public.fn_my_worker_ids()
returns uuid[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(w.id), '{}'::uuid[])
  from public.workers w
  where public.fn_my_worker_id() is not null
    and (w.id = public.fn_my_worker_id() or w.contractor_id = public.fn_my_worker_id())
    and w.deleted_at is null;
$$;
revoke execute on function public.fn_my_worker_ids() from public, anon;
grant execute on function public.fn_my_worker_ids() to authenticated;

-- ---------- RLS: a vállalkozó látja az embereit és az ő adataikat ----------
drop policy if exists workers_select on public.workers;
create policy workers_select on public.workers for select to authenticated
  using (public.fn_is_partner() or id = any(public.fn_my_worker_ids()));

drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated
  using (public.fn_is_partner() or worker_id = any(public.fn_my_worker_ids()));

drop policy if exists timesheets_select on public.timesheets;
drop policy if exists tsh_select on public.timesheets;
create policy tsh_select on public.timesheets for select to authenticated
  using (public.fn_is_partner() or worker_id = any(public.fn_my_worker_ids()));

drop policy if exists ws_select on public.work_sessions;
create policy ws_select on public.work_sessions for select to authenticated
  using (public.fn_is_partner() or worker_id = any(public.fn_my_worker_ids()));
drop policy if exists ws_update on public.work_sessions;
create policy ws_update on public.work_sessions for update to authenticated
  using (public.fn_is_partner() or worker_id = any(public.fn_my_worker_ids()))
  with check (public.fn_is_partner() or worker_id = any(public.fn_my_worker_ids()));
-- a vállalkozó az embereit a SAJÁT (elfogadott) feladatára jelentheti be
drop policy if exists ws_insert on public.work_sessions;
create policy ws_insert on public.work_sessions for insert to authenticated
  with check (created_by = auth.uid() and (
    public.fn_is_partner()
    or (worker_id = any(public.fn_my_worker_ids()) and (
      task_id is null
      or exists (select 1 from public.task_assignees a
                 where a.task_id = work_sessions.task_id and a.worker_id = public.fn_my_worker_id()
                   and a.deleted_at is null and a.acknowledged_at is not null)
    ))
  ));

-- a munkamenet-őr: a vállalkozó az embereinek menetét is csak lezárhatja
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

-- ---------- vállalkozó: ember felvétele ----------
create or replace function public.contractor_add_member(p_name text, p_phone text default null, p_trade text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me public.workers%rowtype;
  v_id uuid;
begin
  select * into v_me from public.workers where id = public.fn_my_worker_id();
  if v_me.id is null or not v_me.is_contractor then
    raise exception 'Csak vállalkozóként regisztrált munkavállaló vehet fel embereket.';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Add meg a nevét.'; end if;
  if (select count(*) from public.workers where contractor_id = v_me.id and deleted_at is null) >= 50 then
    raise exception 'Legfeljebb 50 ember vehető fel.';
  end if;
  insert into public.workers (name, phones, trade, worker_type, created_by, contractor_id, approved_at, approved_by,
                              default_pay_basis, hourly_rate, daily_rate, project_rate)
  values (trim(p_name),
          case when nullif(trim(coalesce(p_phone, '')), '') is null then '{}'::text[] else array[trim(p_phone)] end,
          nullif(trim(coalesce(p_trade, '')), ''),
          v_me.worker_type, v_me.created_by, v_me.id, now(), v_me.created_by,
          -- alapból a vállalkozó díjazását örökli; a partner utána egyedileg állíthatja
          v_me.default_pay_basis, v_me.hourly_rate, v_me.daily_rate, v_me.project_rate)
  returning id into v_id;
  perform public.fn_notify_partners('worker_joined', 'Vállalkozó új embert hozott 👥',
    coalesce(v_me.nickname, v_me.name) || ' felvette: ' || trim(p_name) || coalesce(' (' || nullif(trim(coalesce(p_trade, '')), '') || ')', '')
    || ' — a bére a vállalkozóhoz kerül, emberenként részletezve.',
    jsonb_build_object('worker_id', v_id));
  return v_id;
end $$;
revoke all on function public.contractor_add_member(text, text, text) from public, anon;
grant execute on function public.contractor_add_member(text, text, text) to authenticated;

-- vállalkozó: ember törlése (csak a sajátját, ha nincs nyitott munkamenete)
create or replace function public.contractor_remove_member(p_worker uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.workers where id = p_worker and contractor_id = public.fn_my_worker_id() and deleted_at is null) then
    raise exception 'Ez nem a te embered.';
  end if;
  if exists (select 1 from public.work_sessions where worker_id = p_worker and ended_at is null and deleted_at is null) then
    raise exception 'Előbb fejezd be a munkamenetét.';
  end if;
  update public.workers set deleted_at = now(), updated_at = now() where id = p_worker;
end $$;
revoke all on function public.contractor_remove_member(uuid) from public, anon;
grant execute on function public.contractor_remove_member(uuid) to authenticated;

-- ---------- regisztráció: vállalkozó jelölés a meghívós fiókon ----------
create or replace function public.fn_handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_count integer;
  v_partner_count integer;
  v_admin boolean;
  v_token text;
  v_invite record;
  v_worker_id uuid;
  v_worker_name text;
  v_phone text;
  v_contractor boolean;
begin
  v_token := new.raw_user_meta_data->>'invite_token';
  if v_token is not null and v_token <> '' then
    select * into v_invite from public.worker_invites
    where token = v_token and expires_at > now() and (worker_id is null or used_at is null)
    for update;
    if not found then
      raise exception 'A meghívó érvénytelen vagy lejárt. Kérj újat a fő felhasználóktól!';
    end if;
    v_contractor := coalesce((new.raw_user_meta_data->>'is_contractor')::boolean, false);

    if v_invite.worker_id is null then
      if coalesce(v_invite.uses, 0) >= 20 then
        raise exception 'Ezt a meghívót már túl sokan használták. Kérj újat a fő felhasználóktól!';
      end if;
      v_phone := nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), '');
      insert into public.workers (name, phones, trade, email, created_by, is_contractor, worker_type)
      values (
        coalesce(nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), ''), split_part(new.email, '@', 1)),
        case when v_phone is null then '{}'::text[] else array[v_phone] end,
        nullif(trim(coalesce(new.raw_user_meta_data->>'trade', '')), ''),
        new.email,
        v_invite.created_by,
        v_contractor,
        case when v_contractor then 'company' else 'individual' end
      ) returning id into v_worker_id;
      update public.worker_invites set uses = uses + 1 where id = v_invite.id;
    else
      if exists (select 1 from public.profiles where worker_id = v_invite.worker_id) then
        raise exception 'Ehhez a munkavállalóhoz már tartozik fiók.';
      end if;
      v_worker_id := v_invite.worker_id;
      update public.workers set email = coalesce(email, new.email), is_contractor = is_contractor or v_contractor where id = v_worker_id;
      update public.worker_invites set used_at = now(), used_by = new.id, uses = uses + 1 where id = v_invite.id;
    end if;

    select name into v_worker_name from public.workers where id = v_worker_id;
    insert into public.profiles (id, email, display_name, profit_share_percent, is_admin, worker_id,
                                 notify_comments, notify_big_expense, notify_weekly, notify_overdue)
    values (new.id, new.email,
            coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), v_worker_name, split_part(new.email, '@', 1)),
            0, false, v_worker_id, false, false, false, false);
    begin
      update auth.users set raw_user_meta_data = raw_user_meta_data - 'invite_token' where id = new.id;
    exception when others then null; end;
    return new;
  end if;

  select count(*) into v_count from public.profiles;
  if v_count > 0 and not exists (
    select 1 from public.allowed_emails where email = lower(new.email)
  ) then
    raise exception 'Zárt alkalmazás: ez az e-mail cím nincs engedélyezve. Kérj hozzáférést a tulajdonosoktól.';
  end if;

  select coalesce(ae.is_admin, false) into v_admin
  from public.allowed_emails ae where ae.email = lower(new.email);
  v_admin := coalesce(v_admin, false);

  select count(*) into v_partner_count from public.profiles where not is_admin and worker_id is null;

  insert into public.profiles (id, email, display_name, profit_share_percent, is_admin)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    case when v_admin then 0 when v_partner_count = 0 then 100 else 0 end,
    v_admin
  );
  return new;
end $$;

-- a regisztrációs értesítés szövege jelezze, ha vállalkozó
create or replace function public.fn_notify_worker_joined()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare r record; v_name text; v_contr boolean;
begin
  if new.worker_id is null then return new; end if;
  select coalesce(nickname, name), is_contractor into v_name, v_contr from public.workers where id = new.worker_id;
  for r in select id from public.profiles where worker_id is null loop
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('worker_joined', r.id,
            case when v_contr then 'Új vállalkozó vár jóváhagyásra 👥' else 'Új munkavállaló vár jóváhagyásra 👷' end,
            coalesce(v_name, new.display_name) || ' regisztrált (' || coalesce(new.email, '') ||
            case when v_contr then ') vállalkozóként — saját embereket hoz. ' else '). ' end
            || 'Nézd át a díjazását és hagyd jóvá, hogy be tudjon lépni.',
            jsonb_build_object('worker_id', new.worker_id));
  end loop;
  return new;
end;
$$;

-- óralap: a vállalkozó az embereiért is beküldheti
create or replace function public.submit_timesheet(p_week_start date, p_note text default null, p_worker uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_wid uuid := coalesce(p_worker, public.fn_my_worker_id());
  v_week date := public.fn_week_start(p_week_start);
  v_t record;
  v_id uuid;
  v_name text;
  v_status text;
begin
  if auth.uid() is null or public.fn_my_worker_id() is null then raise exception 'Csak munkavállalói fiók küldhet be óralapot.'; end if;
  if v_wid <> all(public.fn_my_worker_ids()) then raise exception 'Csak a saját vagy az embereid óralapját küldheted be.'; end if;
  if v_week > public.fn_week_start((now() at time zone 'Europe/Budapest')::date) then
    raise exception 'Jövőbeli hét nem küldhető be.';
  end if;
  select * into v_t from public.fn_timesheet_totals(v_wid, v_week);
  if v_t.hours <= 0 and v_t.amount <= 0 then raise exception 'Ezen a héten nincs rögzített munkaidő.'; end if;
  insert into public.timesheets (worker_id, week_start, status, hours, amount, days, submitted_at, submitted_note)
  values (v_wid, v_week, 'submitted', v_t.hours, v_t.amount, v_t.days, now(), nullif(trim(coalesce(p_note, '')), ''))
  on conflict (worker_id, week_start) where deleted_at is null do update
    set status = case when public.timesheets.status = 'approved' then 'approved' else 'submitted' end,
        hours = excluded.hours, amount = excluded.amount, days = excluded.days,
        submitted_at = now(), submitted_note = excluded.submitted_note,
        decided_at = case when public.timesheets.status = 'approved' then public.timesheets.decided_at end
  returning id, status into v_id, v_status;
  if v_status = 'approved' then raise exception 'Ez a hét már jóvá van hagyva.'; end if;
  select coalesce(nickname, name) into v_name from public.workers where id = v_wid;
  perform public.fn_notify_partners('timesheet', 'Óralap jóváhagyásra vár 🗓️',
    coalesce(v_name, 'Munkavállaló') || ' · ' || to_char(v_week, 'MM.DD') || '–' || to_char(v_week + 6, 'MM.DD')
    || ' · ' || to_char(v_t.hours, 'FM990.0') || ' óra · ' || trim(to_char(v_t.amount, 'FM999 999 999')) || ' Ft',
    jsonb_build_object('timesheet_id', v_id));
  return v_id;
end $$;
drop function if exists public.submit_timesheet(date, text);
revoke all on function public.submit_timesheet(date, text, uuid) from public, anon;
grant execute on function public.submit_timesheet(date, text, uuid) to authenticated;

-- kifizetés-kapu: a vállalkozó emberei (fiók nélkül) is a vállalkozó óralapja alá esnek
create or replace function public.mark_attendance_paid(p_ids uuid[], p_paid boolean, p_note text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r record;
begin
  if auth.uid() is null or not public.fn_is_partner() then raise exception 'Csak fő felhasználó jelölhet kifizetést.'; end if;
  if p_paid then
    for r in select a.worker_id, a.work_date, w.name from public.attendance a join public.workers w on w.id = a.worker_id
             where a.id = any(p_ids) and a.deleted_at is null and a.source in ('session', 'task')
               and (exists (select 1 from public.profiles p where p.worker_id = a.worker_id)
                    or exists (select 1 from public.workers c join public.profiles p on p.worker_id = c.id where c.id = w.contractor_id))
               and not exists (select 1 from public.timesheets t where t.worker_id = a.worker_id
                               and t.week_start = public.fn_week_start(a.work_date) and t.status = 'approved' and t.deleted_at is null)
    loop
      raise exception 'Előbb hagyd jóvá % óralapját (% hete) az Óralapok oldalon.', r.name, to_char(public.fn_week_start(r.work_date), 'MM.DD');
    end loop;
  end if;
  perform set_config('app.allow_paid_tick', 'on', true);
  update public.attendance
     set paid_at = case when p_paid then now() end,
         paid_by = case when p_paid then auth.uid() end,
         paid_note = case when p_paid then nullif(trim(coalesce(p_note, '')), '') end
   where id = any(p_ids) and deleted_at is null;
end $$;
