-- Átvilágítás 2026-09-28 — bérlogikai javítások.
-- a) kifizetett napon minden munkamenet törölve: a „0 óra” beírást az attendance CHECK (hours > 0)
--    megakadályozta, a hiba pedig elnyelődött → a sor változatlan maradt (a túlfizetés nem látszott)
alter table public.attendance drop constraint if exists attendance_hours_check;
alter table public.attendance drop constraint if exists chk_hours_positive;
alter table public.attendance add constraint attendance_hours_check check (hours is null or hours >= 0);

-- b) fn_recalc_session_wage újraírva:
--    - 0 óra ág: kiszállás is 0, projektdíj is 0; a hibák nem nyelődnek el (csak a versenyhelyzeti
--      unique_violation a beszúrásnál)
--    - napi díjas: ha aznap MÁSIK helyszínen kézi napi díj van, a munkaidőből képzett sor 0 szorzót kap
--      (a napi díj naponta egyszer jár)
--    - kifizetett sor: a kiszállási díj pillanatképe marad (a díjváltozás csak a kifizetetlen napokra hat)
create or replace function public.fn_recalc_session_wage(p_worker uuid, p_site uuid, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare
  w public.workers%rowtype;
  v_hours numeric := 0;
  v_basis text;
  v_task uuid;
  v_owner uuid;
  v_row public.attendance%rowtype;
  v_fee numeric := 0;
  v_note text;
  v_mult numeric := 1;
  v_first_site uuid;
begin
  if p_worker is null or p_site is null or p_date is null then return; end if;
  select * into w from public.workers where id = p_worker;
  if not found then return; end if;

  -- párhuzamos feladatok: az átfedő időszakokat egyesítjük, hogy egy óra csak egyszer számítson
  with s as (
    select s.started_at, s.ended_at, s.task_id
    from public.work_sessions s
    left join public.worker_tasks t on t.id = s.task_id
    where s.worker_id = p_worker and s.site_id = p_site and s.deleted_at is null
      and s.ended_at is not null
      and (s.started_at at time zone 'Europe/Budapest')::date = p_date
      and (t.id is null or t.quote_accepted_at is null)
  ), o as (
    select started_at, ended_at, task_id,
           max(ended_at) over (order by started_at, ended_at rows between unbounded preceding and 1 preceding) as prev_end
    from s
  ), g as (
    select *, sum(case when prev_end is null or started_at > prev_end then 1 else 0 end) over (order by started_at, ended_at) as grp from o
  ), m as (
    select min(started_at) st, max(ended_at) en from g group by grp
  )
  select coalesce((select sum(extract(epoch from (en - st)) / 3600.0) from m), 0),
         (select task_id from s where task_id is not null order by started_at limit 1)
    into v_hours, v_task;
  -- minden megkezdett óra teljes óra
  v_hours := least(ceil(round(v_hours, 4)), 16); -- napi plafon: egy nap legfeljebb 16 óra

  select * into v_row from public.attendance
  where worker_id = p_worker and site_id = p_site and work_date = p_date
    and source = 'session' and deleted_at is null;

  perform set_config('app.allow_paid_tick', 'on', true);

  if v_hours <= 0 then
    if v_row.id is not null and v_row.paid_at is not null then
      -- kifizetett nap, a menetei törölve: a sor marad, 0 órával / 0 díjjal — a kifizetett összeg túlfizetés
      update public.attendance
      set hours = case when pay_basis = 'hourly' then 0 else hours end, day_multiplier = 0, callout_fee = 0,
          applied_rate = case when pay_basis = 'project' then 0 else applied_rate end,
          note = 'munkaidő alapján (automatikus) · a nap munkamenetei törölve — a kifizetett összeg túlfizetés'
      where id = v_row.id;
    elsif v_row.id is not null then
      update public.attendance set deleted_at = now() where id = v_row.id;
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
  -- napi díj: egy napra egy — a legkorábban kezdett helyszín sora viszi, a többi 0 szorzóval csak a kiszállást;
  -- ha aznap bárhol KÉZI napi díj van, a munkaidőből képzett sor sem visz napi díjat
  v_mult := 1;
  if v_basis = 'daily' then
    if exists (select 1 from public.attendance m where m.worker_id = p_worker and m.work_date = p_date and m.source = 'manual'
               and m.deleted_at is null and m.pay_basis = 'daily' and m.day_multiplier > 0) then
      v_mult := 0;
    else
      select s.site_id into v_first_site from public.work_sessions s
      left join public.worker_tasks t on t.id = s.task_id
      where s.worker_id = p_worker and s.deleted_at is null and s.ended_at is not null and s.site_id is not null
        and (s.started_at at time zone 'Europe/Budapest')::date = p_date
        and (t.id is null or t.quote_accepted_at is null)
        and not exists (select 1 from public.attendance m where m.worker_id = p_worker and m.site_id = s.site_id
                        and m.work_date = p_date and m.source = 'manual' and m.deleted_at is null)
      order by s.started_at limit 1;
      if v_first_site is not null and v_first_site <> p_site then v_mult := 0; end if;
    end if;
  end if;
  -- kiszállási díj: helyszínenként és naponként egyszer (2026-09-20-tól); kifizetett soron a pillanatkép marad
  if v_row.id is not null and v_row.paid_at is not null then v_fee := coalesce(v_row.callout_fee, 0);
  elsif p_date >= date '2026-09-20' then v_fee := public.fn_worker_callout_fee(p_worker); end if;
  v_note := 'munkaidő alapján (automatikus) · ' || to_char(v_hours, 'FM990') || ' óra (megkezdett órák)'
    || case when v_fee > 0 then ' + kiszállási díj ' || replace(trim(to_char(v_fee, 'FM999,999,999')), ',', ' ') || ' Ft' else '' end
    || case when v_mult = 0 then ' · a napi díj a nap első helyszínén van elszámolva' else '' end;

  if v_row.id is not null then
    update public.attendance
    set pay_basis = v_basis,
        applied_rate = case when v_row.pay_basis = v_basis then applied_rate else null end,
        hours = case when v_basis = 'hourly' then v_hours else null end,
        day_multiplier = v_mult,
        callout_fee = v_fee,
        task_id = coalesce(v_task, task_id),
        note = v_note
    where id = v_row.id;
    perform public.fn_refresh_timesheet_snapshot(p_worker, p_date);
    return;
  end if;

  select created_by into v_owner from public.worker_tasks where id = v_task;
  if v_owner is null then select created_by into v_owner from public.sites where id = p_site; end if;
  if v_owner is null then select id into v_owner from public.profiles where worker_id is null order by created_at limit 1; end if;

  begin
    insert into public.attendance (work_date, site_id, worker_id, created_by, pay_basis, hours, day_multiplier,
                                   applied_rate, source, task_id, callout_fee, note)
    values (p_date, p_site, p_worker, v_owner, v_basis,
            case when v_basis = 'hourly' then v_hours else null end,
            v_mult, null, 'session', v_task, v_fee, v_note);
  exception when unique_violation then
    -- versenyhelyzet: egy másik lezárás már beszúrta a sort — újraszámoljuk azt
    update public.attendance set hours = case when v_basis = 'hourly' then v_hours else null end, day_multiplier = v_mult,
      callout_fee = v_fee, task_id = coalesce(v_task, task_id), note = v_note
    where worker_id = p_worker and site_id = p_site and work_date = p_date and source = 'session' and deleted_at is null;
  end;
  perform public.fn_refresh_timesheet_snapshot(p_worker, p_date);
end $$;
revoke all on function public.fn_recalc_session_wage(uuid, uuid, date) from public, anon, authenticated;

-- c) munkamenet áthelyezése (másik helyszín / nap / munkavállaló): a RÉGI helyszín / nap MINDEN helyszíne
--    is újraszámolódik (eddig a régi helyszín bérsora ott maradt → dupla bér; napidíjasnál a régi nap napidíja elveszett)
create or replace function public.fn_ws_wage_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_w uuid; v_d date; v_ow uuid; v_od date; r record;
begin
  v_w := coalesce(new.worker_id, old.worker_id);
  v_d := (coalesce(new.started_at, old.started_at) at time zone 'Europe/Budapest')::date;
  if tg_op = 'UPDATE' then
    v_ow := old.worker_id; v_od := (old.started_at at time zone 'Europe/Budapest')::date;
    if v_ow <> new.worker_id or v_od <> v_d or old.site_id is distinct from new.site_id then
      for r in
        select distinct site_id from public.work_sessions s
        where s.worker_id = v_ow and s.site_id is not null and (s.started_at at time zone 'Europe/Budapest')::date = v_od
        union select old.site_id where old.site_id is not null
        union select a.site_id from public.attendance a where a.worker_id = v_ow and a.work_date = v_od and a.source = 'session' and a.deleted_at is null
      loop
        perform public.fn_recalc_session_wage(v_ow, r.site_id, v_od);
      end loop;
    end if;
  end if;
  for r in
    select distinct site_id from public.work_sessions s
    where s.worker_id = v_w and s.site_id is not null and (s.started_at at time zone 'Europe/Budapest')::date = v_d
    union select coalesce(new.site_id, old.site_id) where coalesce(new.site_id, old.site_id) is not null
    union select a.site_id from public.attendance a where a.worker_id = v_w and a.work_date = v_d and a.source = 'session' and a.deleted_at is null
  loop
    perform public.fn_recalc_session_wage(v_w, r.site_id, v_d);
  end loop;
  return coalesce(new, old);
end $$;
revoke all on function public.fn_ws_wage_trigger() from public, anon, authenticated;

-- d) közvetítő / vállalkozó változása: a kifizetetlen napokon a közvetítő-pillanatkép is frissül,
--    és a vállalkozó embereinek napjai is újraszámolódnak (ők a vállalkozó közvetítőjét öröklik)
create or replace function public.fn_recalc_worker_unpaid(p_worker uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if p_worker is null then return; end if;
  perform set_config('app.allow_paid_tick', 'on', true);
  -- a díj- és közvetítő-pillanatkép törlődik, hogy az aktuális beállítás oldódjon fel újra
  update public.attendance set applied_rate = null, referrer_user_id = null, referrer_external_id = null
  where worker_id = p_worker and source = 'session' and paid_at is null and deleted_at is null and pay_basis <> 'presence';
  for r in select distinct a.site_id, a.work_date from public.attendance a
           where a.worker_id = p_worker and a.source = 'session' and a.paid_at is null and a.deleted_at is null
  loop
    perform public.fn_recalc_session_wage(p_worker, r.site_id, r.work_date);
  end loop;
end $$;
revoke all on function public.fn_recalc_worker_unpaid(uuid) from public, anon, authenticated;

create or replace function public.fn_workers_rate_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_comm boolean;
begin
  v_comm := new.commission_mode is distinct from old.commission_mode
     or new.commission_value is distinct from old.commission_value
     or new.commission_unit is distinct from old.commission_unit
     or new.callout_commission is distinct from old.callout_commission
     or new.referrer_user_id is distinct from old.referrer_user_id
     or new.referrer_external_id is distinct from old.referrer_external_id;
  if v_comm
     or new.callout_fee is distinct from old.callout_fee
     or new.hourly_rate is distinct from old.hourly_rate
     or new.daily_rate is distinct from old.daily_rate
     or new.project_rate is distinct from old.project_rate
     or new.default_pay_basis is distinct from old.default_pay_basis
     or new.worker_type is distinct from old.worker_type
     or new.contractor_id is distinct from old.contractor_id then
    perform public.fn_recalc_worker_unpaid(new.id);
  end if;
  if v_comm then
    for r in select id from public.workers c where c.contractor_id = new.id and c.deleted_at is null
             and c.referrer_user_id is null and c.referrer_external_id is null
    loop
      perform public.fn_recalc_worker_unpaid(r.id);
    end loop;
  end if;
  return null;
end $$;
revoke all on function public.fn_workers_rate_change() from public, anon, authenticated;

-- e) ajánlat elfogadása után a feladat korábbi munkameneteiből képzett bér törlődik (a feladatot az ajánlat fizeti);
--    kész feladat újranyitásakor / törlésekor az ajánlat projektdíj-sora (ha nincs kifizetve) törlődik
create or replace function public.fn_task_quote_accepted_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.quote_accepted_at is not null and old.quote_accepted_at is null then
    for r in select distinct s.worker_id, s.site_id, (s.started_at at time zone 'Europe/Budapest')::date as d
             from public.work_sessions s where s.task_id = new.id and s.deleted_at is null and s.site_id is not null
    loop
      perform public.fn_recalc_session_wage(r.worker_id, r.site_id, r.d);
    end loop;
  end if;
  return null;
end $$;
revoke all on function public.fn_task_quote_accepted_recalc() from public, anon, authenticated;
drop trigger if exists trg_task_quote_accepted_recalc on public.worker_tasks;
create trigger trg_task_quote_accepted_recalc after update of quote_accepted_at on public.worker_tasks
  for each row execute function public.fn_task_quote_accepted_recalc();

create or replace function public.fn_task_done_wage()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    perform set_config('app.allow_paid_tick', 'on', true);
    update public.attendance set deleted_at = now() where task_id = new.id and source = 'task' and paid_at is null and deleted_at is null;
    return new;
  end if;
  if new.status = 'done' and (old.status is distinct from 'done') then
    perform public.fn_task_quote_wage(new.id);
  elsif old.status = 'done' and new.status <> 'done' then
    perform set_config('app.allow_paid_tick', 'on', true);
    update public.attendance set deleted_at = now() where task_id = new.id and source = 'task' and paid_at is null and deleted_at is null;
  end if;
  return new;
end $$;
revoke all on function public.fn_task_done_wage() from public, anon, authenticated;
drop trigger if exists trg_task_done_wage on public.worker_tasks;
create trigger trg_task_done_wage after update of status, deleted_at on public.worker_tasks
  for each row execute function public.fn_task_done_wage();
-- az újranyitás után az ajánlat-sor újra képződik, ha ismét kész lesz (fn_task_quote_wage: „van-e élő sor” ellenőrzés)

-- f) átfedő munkamenet MÁSIK helyszínen: egy ember egyszerre egy helyen van (egy helyszínen belül
--    a párhuzamos feladatok megengedettek, az órák összeolvadnak)
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
  if new.deleted_at is null and (tg_op = 'INSERT' or new.started_at <> old.started_at or new.ended_at is distinct from old.ended_at
     or new.site_id is distinct from old.site_id or new.worker_id <> old.worker_id or old.deleted_at is not null) then
    if exists (select 1 from public.work_sessions s
               where s.worker_id = new.worker_id and s.id <> new.id and s.deleted_at is null
                 and s.site_id is distinct from new.site_id
                 and s.started_at < coalesce(new.ended_at, 'infinity'::timestamptz)
                 and coalesce(s.ended_at, 'infinity'::timestamptz) > new.started_at) then
      raise exception 'Ebben az időszakban másik helyszínen már van munkaideje — egyszerre egy helyen lehet.';
    end if;
  end if;
  if auth.uid() is not null and not public.fn_is_partner() then
    -- munkavállaló: csak „most” indítható menet (visszadátumozni a vezető tud),
    -- egyszerre egy nyitott menet, a befejezés nem lehet a jövőben
    if tg_op = 'INSERT' then
      if new.started_at < now() - interval '24 hours' or new.started_at > now() + interval '5 minutes' then
        raise exception 'Munkamenet csak most indítható — korábbi napot a vezető rögzít utólag.';
      end if;
      if exists (select 1 from public.work_sessions s where s.worker_id = new.worker_id and s.ended_at is null and s.deleted_at is null
                 and s.site_id is distinct from new.site_id) then
        raise exception 'Másik munkaterületen még fut a munkaidőd — előbb zárd le, vagy válts át.';
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
      raise exception 'Ezt a hetet a vezető már jóváhagyta — módosítást tőle kérj.';
    end if;
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.fn_is_partner() then
    if new.worker_id <> old.worker_id or new.started_at <> old.started_at
       or new.site_id is distinct from old.site_id or new.task_id is distinct from old.task_id
       or new.created_by <> old.created_by or new.deleted_at is distinct from old.deleted_at then
      raise exception 'A munkamenetnek csak a befejezését állíthatod be.';
    end if;
    if old.ended_at is not null and new.ended_at is distinct from old.ended_at then
      raise exception 'Lezárt munkamenet már nem módosítható — szólj a vezetőnek.';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.fn_ws_guard() from public, anon, authenticated;

-- g) óralap órái = a bér órái (átfedés összeolvasztva, ajánlatos feladat kizárva, 16 ó plafon)
create or replace function public.fn_timesheet_totals(p_worker uuid, p_week date)
returns table(hours numeric, amount numeric, days integer)
language sql stable security definer set search_path = public as $$
  with s as (
    select s.started_at, s.ended_at, (s.started_at at time zone 'Europe/Budapest')::date as d, s.site_id
    from public.work_sessions s
    left join public.worker_tasks t on t.id = s.task_id
    where s.worker_id = p_worker and s.deleted_at is null and s.ended_at is not null
      and (s.started_at at time zone 'Europe/Budapest')::date between p_week and p_week + 6
      and (t.id is null or t.quote_accepted_at is null)
  ), o as (
    select *, max(ended_at) over (partition by d, site_id order by started_at, ended_at rows between unbounded preceding and 1 preceding) as prev_end from s
  ), g as (
    select *, sum(case when prev_end is null or started_at > prev_end then 1 else 0 end) over (partition by d, site_id order by started_at, ended_at) as grp from o
  ), m as (
    select d, site_id, extract(epoch from (max(ended_at) - min(started_at))) / 3600.0 as h from g group by d, site_id, grp
  ), per as (
    select d, site_id, least(ceil(round(sum(h), 4)), 16) as h from m group by d, site_id
  )
  select
    coalesce((select sum(h) from per), 0),
    coalesce((select sum(a.amount - a.commission_amount) from public.attendance a
              where a.worker_id = p_worker and a.deleted_at is null and a.pay_basis <> 'presence'
                and a.work_date between p_week and p_week + 6), 0),
    coalesce((select count(distinct a.work_date)::int from public.attendance a
              where a.worker_id = p_worker and a.deleted_at is null
                and a.work_date between p_week and p_week + 6), 0);
$$;
revoke all on function public.fn_timesheet_totals(uuid, date) from public, anon, authenticated;

-- h) esemény-napló: egy újranyitás egy esemény (eddig status + closed_at együttes változásnál kettő)
create or replace function public.fn_task_event_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_reopened boolean := false;
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
    v_reopened := true;
  end if;
  if new.closed_at is not null and old.closed_at is null then
    insert into public.task_events (task_id, kind, actor_user_id, at) values (new.id, 'closed', auth.uid(), new.closed_at);
  elsif new.closed_at is null and old.closed_at is not null then
    v_reopened := true;
  end if;
  if v_reopened then
    insert into public.task_events (task_id, kind, actor_user_id) values (new.id, 'reopened', auth.uid());
  end if;
  return new;
end $$;
revoke all on function public.fn_task_event_log() from public, anon, authenticated;
