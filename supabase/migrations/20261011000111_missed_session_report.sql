-- Késve szinkronizált munkaidő (2026-10-11, Daniel kérése): ha a munkavállaló készüléke napokkal később
-- küldi fel az offline indított munkaidőt, a szerver (szándékosan) nem fogad el visszadátumozott indítást.
-- Hogy a ledolgozott idő ne vesszen el, a készülék ilyenkor jelenti a kimaradt időszakot, és a vezetők
-- értesítést kapnak, hogy kézzel rögzítsék.
create or replace function public.report_missed_session(p_site uuid, p_task uuid, p_started timestamptz, p_ended timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare v_wid uuid := public.fn_my_worker_id(); v_name text; v_site text; v_task text; v_body text; v_p record;
begin
  if auth.uid() is null or v_wid is null then raise exception 'Csak munkavállalói fiókból jelenthető.'; end if;
  if p_started is null then return; end if;
  select coalesce(nickname, name) into v_name from public.workers where id = v_wid;
  select name into v_site from public.sites where id = p_site;
  select coalesce(code || ' · ', '') || title into v_task from public.worker_tasks where id = p_task;
  v_body := coalesce(v_name, 'Munkavállaló') || ': '
    || to_char(p_started at time zone 'Europe/Budapest', 'YYYY.MM.DD. HH24:MI') || ' – '
    || coalesce(to_char(p_ended at time zone 'Europe/Budapest', 'HH24:MI'), 'nincs befejezés')
    || ' · ' || coalesce(v_task, v_site, 'ismeretlen helyszín')
    || ' — a készülék késve szinkronizált, a munkaidő nem rögzült. Kérlek, rögzítsd kézzel.';
  for v_p in select id from public.profiles where worker_id is null loop
    -- ugyanaz a jelentés nem megy ki kétszer (a készülék újra is próbálkozhat)
    if exists (select 1 from public.notification_queue n where n.recipient = v_p.id and n.title = '⏱ Nem rögzült munkaidő' and n.body = v_body) then continue; end if;
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('task', v_p.id, '⏱ Nem rögzült munkaidő', v_body,
            jsonb_build_object('task_id', p_task, 'site_id', p_site, 'worker_id', v_wid, 'started_at', p_started, 'ended_at', p_ended));
  end loop;
end $$;
revoke all on function public.report_missed_session(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_missed_session(uuid, uuid, timestamptz, timestamptz) to authenticated;
