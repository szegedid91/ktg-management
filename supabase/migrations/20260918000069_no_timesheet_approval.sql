-- Óralap-jóváhagyás megszűnt (2026-09-18, Daniel kérése): az óralap csak
-- tájékoztató beküldés, a kifizetés a Kifizetetlen bérek oldalon történik.
--  1) submit_timesheet: az értesítés címe „Óralap beküldve”, nem „jóváhagyásra vár”
--  2) vasárnapi emlékeztető: nem hivatkozik a kifizethetőségre
--  3) decide_timesheet: a kliens már nem hívja → nem futtatható bejelentkezett felhasználóként

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
  perform public.fn_notify_partners('timesheet', 'Óralap beküldve 🗓️',
    coalesce(v_name, 'Munkavállaló') || ' · ' || to_char(v_week, 'MM.DD') || '–' || to_char(v_week + 6, 'MM.DD')
    || ' · ' || to_char(v_t.hours, 'FM990.0') || ' óra · ' || trim(to_char(v_t.amount, 'FM999 999 999')) || ' Ft',
    jsonb_build_object('timesheet_id', v_id));
  return v_id;
end $$;
revoke all on function public.submit_timesheet(date, text, uuid) from public, anon;
grant execute on function public.submit_timesheet(date, text, uuid) to authenticated;

create or replace function public.fn_remind_timesheets()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; v_week date := public.fn_week_start((now() at time zone 'Europe/Budapest')::date); v_t record;
begin
  for r in
    select p.id as prof, w.id as worker_id, coalesce(w.nickname, w.name) as name
    from public.profiles p join public.workers w on w.id = p.worker_id
    where w.deleted_at is null and w.approved_at is not null
  loop
    select * into v_t from public.fn_timesheet_totals(r.worker_id, v_week);
    if v_t.hours > 0 and not exists (select 1 from public.timesheets t where t.worker_id = r.worker_id and t.week_start = v_week
                                     and t.status in ('submitted', 'approved') and t.deleted_at is null) then
      insert into public.notification_queue (kind, recipient, title, body, payload)
      values ('timesheet', r.prof, 'Óralap beküldése 🗓️',
              'Ezen a héten ' || to_char(v_t.hours, 'FM990') || ' órád van rögzítve — küldd be az óralapod a kezdőlapon.',
              '{}'::jsonb);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.fn_remind_timesheets() from public, anon, authenticated;

revoke execute on function public.decide_timesheet(uuid, date, boolean, text) from public, anon, authenticated;
