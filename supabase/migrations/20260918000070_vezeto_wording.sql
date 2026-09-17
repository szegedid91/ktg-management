-- „Fő felhasználó” kifejezés megszüntetése (2026-09-18, Daniel kérése: sehol
-- ne szerepeljen az appban). A felhasználónak látható hibaüzenetekben és
-- értesítésekben „vezető” szerepel. A függvények logikája változatlan
-- (pg_get_functiondef alapján újra létrehozva, a jogosultságok megmaradnak).
CREATE OR REPLACE FUNCTION public.accept_task_quote(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_q public.task_quotes%rowtype;
  v_task public.worker_tasks%rowtype;
  v_prof uuid;
  v_pending integer;
  r record;
begin
  if auth.uid() is null or not public.fn_is_partner() then
    raise exception 'Ajánlatot csak a vezetők fogadhatnak el.';
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
$function$

;
CREATE OR REPLACE FUNCTION public.approve_worker(p_worker uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_prof uuid;
begin
  if not public.fn_is_partner() then raise exception 'Csak vezető hagyhat jóvá.'; end if;
  update public.workers set approved_at = now(), approved_by = auth.uid(), updated_at = now()
   where id = p_worker and deleted_at is null and approved_at is null;
  if not found then raise exception 'A munkavállaló nem található vagy már jóvá van hagyva.'; end if;
  select id into v_prof from public.profiles where worker_id = p_worker;
  if v_prof is not null then
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('worker_approved', v_prof, 'Regisztrációd jóváhagyva ✅',
            'Mostantól beléphetsz és láthatod a rád kiosztott feladatokat.',
            jsonb_build_object('worker_id', p_worker));
  end if;
end $function$

;
CREATE OR REPLACE FUNCTION public.close_site(p_site uuid, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_checklist jsonb;
  v_has_issues boolean;
begin
  if auth.uid() is null or not public.fn_is_partner() then raise exception 'Csak vezető zárhat le építkezést.'; end if;
  v_checklist := public.site_close_checklist(p_site);
  v_has_issues := jsonb_array_length(v_checklist->'unpaid_invoices') > 0
               or jsonb_array_length(v_checklist->'unpaid_wages') > 0
               or jsonb_array_length(v_checklist->'unpaid_commissions') > 0;
  if v_has_issues and not p_force then
    return v_checklist || jsonb_build_object('closed', false);
  end if;
  update public.sites set status = 'closed', closed_at = now(), closed_by = auth.uid()
   where id = p_site and deleted_at is null;
  return v_checklist || jsonb_build_object('closed', true);
end $function$

;
CREATE OR REPLACE FUNCTION public.copy_attendance_from_previous_day(p_site uuid, p_date date)
 RETURNS SETOF attendance
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_prev date;
begin
  if auth.uid() is null or not public.fn_is_partner() then raise exception 'Csak vezető rögzíthet jelenlétet.'; end if;
  select max(work_date) into v_prev from public.attendance
  where site_id = p_site and work_date < p_date and deleted_at is null;
  if v_prev is null then return; end if;
  return query
  insert into public.attendance
    (work_date, site_id, worker_id, created_by, pay_basis, hours, day_multiplier, applied_rate, note)
  select p_date, a.site_id, a.worker_id, auth.uid(),
         case when a.pay_basis = 'project' then 'presence' else a.pay_basis end,
         a.hours, a.day_multiplier,
         case when a.pay_basis = 'project' then null else a.applied_rate end,
         null
    from public.attendance a
   where a.site_id = p_site and a.work_date = v_prev and a.deleted_at is null
     and not exists (
       select 1 from public.attendance b
        where b.site_id = p_site and b.work_date = p_date
          and b.worker_id = a.worker_id and b.deleted_at is null
     )
  returning *;
end $function$

;
CREATE OR REPLACE FUNCTION public.create_worker_invite(p_worker uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_token text;
  v_me public.workers%rowtype;
begin
  if auth.uid() is null then raise exception 'Nincs bejelentkezve.'; end if;

  if not public.fn_is_partner() then
    select * into v_me from public.workers where id = public.fn_my_worker_id();
    if v_me.id is null or not v_me.is_contractor then
      raise exception 'Meghívót csak a vezetők vagy vállalkozóként regisztrált munkavállalók készíthetnek.';
    end if;
    if p_worker is not null then raise exception 'Vállalkozó csak általános meghívót készíthet.'; end if;
    select token into v_token from public.worker_invites
    where contractor_id = v_me.id and expires_at > now() and coalesce(uses, 0) < 20
    order by created_at desc limit 1;
    if v_token is not null then return v_token; end if;
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.worker_invites (worker_id, token, created_by, contractor_id)
    values (null, v_token, auth.uid(), v_me.id);
    return v_token;
  end if;

  if p_worker is null then
    select token into v_token from public.worker_invites
    where worker_id is null and contractor_id is null and expires_at > now() and coalesce(uses, 0) < 20
    order by created_at desc limit 1;
    if v_token is not null then return v_token; end if;
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.worker_invites (worker_id, token, created_by) values (null, v_token, auth.uid());
    return v_token;
  end if;

  if not exists (select 1 from public.workers where id = p_worker and deleted_at is null) then
    raise exception 'A munkavállaló nem található.';
  end if;
  if exists (select 1 from public.profiles where worker_id = p_worker) then
    raise exception 'Ehhez a munkavállalóhoz már tartozik fiók.';
  end if;
  select token into v_token from public.worker_invites
  where worker_id = p_worker and used_at is null and expires_at > now()
  order by created_at desc limit 1;
  if v_token is not null then return v_token; end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.worker_invites (worker_id, token, created_by) values (p_worker, v_token, auth.uid());
  return v_token;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.decide_timesheet(p_worker uuid, p_week_start date, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_week date := public.fn_week_start(p_week_start);
  v_t record;
  v_id uuid;
  v_prof uuid;
begin
  if auth.uid() is null or not public.fn_is_partner() then raise exception 'Csak vezető hagyhat jóvá óralapot.'; end if;
  select * into v_t from public.fn_timesheet_totals(p_worker, v_week);
  insert into public.timesheets (worker_id, week_start, status, hours, amount, days, decided_at, decided_by, decision_note)
  values (p_worker, v_week, case when p_approve then 'approved' else 'rejected' end, v_t.hours, v_t.amount, v_t.days,
          now(), auth.uid(), nullif(trim(coalesce(p_note, '')), ''))
  on conflict (worker_id, week_start) where deleted_at is null do update
    set status = excluded.status, hours = excluded.hours, amount = excluded.amount, days = excluded.days,
        decided_at = now(), decided_by = auth.uid(), decision_note = excluded.decision_note
  returning id into v_id;
  select id into v_prof from public.profiles where worker_id = p_worker;
  if v_prof is not null then
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('timesheet', v_prof,
            case when p_approve then 'Óralap jóváhagyva ✅' else 'Óralap visszaküldve ✖' end,
            to_char(v_week, 'MM.DD') || '–' || to_char(v_week + 6, 'MM.DD') || ' · ' || to_char(v_t.hours, 'FM990.0') || ' óra'
            || case when p_approve then ' — a béred kifizethető.' else coalesce(' — ' || nullif(trim(coalesce(p_note, '')), ''), '') || ' Nézd át és küldd be újra.' end,
            jsonb_build_object('timesheet_id', v_id));
  end if;
  return v_id;
end $function$

;
CREATE OR REPLACE FUNCTION public.delete_site(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
  v_name text;
  v_deleter text;
  r record;
begin
  if v_me is null then raise exception 'Bejelentkezés szükséges.'; end if;
  if not public.fn_is_partner() then
    raise exception 'Építkezést csak a vezetők törölhetnek.';
  end if;

  select name into v_name from public.sites where id = p_id and deleted_at is null;
  if v_name is null then raise exception 'Az építkezés nem található.'; end if;

  update public.sites set deleted_at = now(), updated_at = now() where id = p_id;

  select display_name into v_deleter from public.profiles where id = v_me;
  for r in
    select id from public.profiles
    where not is_admin and worker_id is null and id <> v_me
  loop
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('site_deleted', r.id, 'Építkezés törölve 🗑️',
            coalesce(v_deleter, 'A partnered') || ' törölte a(z) „' || v_name
            || '” építkezést. A hozzá tartozó költségek és bevételek 30 napig még megmaradnak és beleszámítanak az elszámolásba, utána véglegesen törlődnek.',
            jsonb_build_object('site_id', p_id));
  end loop;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_boss public.workers%rowtype;
begin
  v_token := new.raw_user_meta_data->>'invite_token';
  if v_token is not null and v_token <> '' then
    select * into v_invite from public.worker_invites
    where token = v_token and expires_at > now() and (worker_id is null or used_at is null)
    for update;
    if not found then
      raise exception 'A meghívó érvénytelen vagy lejárt. Kérj újat a vezetőktől!';
    end if;
    v_contractor := coalesce((new.raw_user_meta_data->>'is_contractor')::boolean, false);
    v_phone := nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), '');

    if v_invite.contractor_id is not null then
      select * into v_boss from public.workers where id = v_invite.contractor_id and deleted_at is null and is_contractor;
      if v_boss.id is null then
        raise exception 'A meghívó vállalkozója már nem aktív. Kérj új meghívót!';
      end if;
      if coalesce(v_invite.uses, 0) >= 20 then
        raise exception 'Ezt a meghívót már túl sokan használták. Kérj újat a vállalkozódtól!';
      end if;
      if (select count(*) from public.workers where contractor_id = v_boss.id and deleted_at is null) >= 50 then
        raise exception 'A vállalkozó már elérte az 50 fős létszámot.';
      end if;
      insert into public.workers (name, phones, trade, email, created_by, is_contractor, worker_type, contractor_id,
                                  approved_at, approved_by, default_pay_basis, hourly_rate, daily_rate, project_rate)
      values (
        coalesce(nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), ''), split_part(new.email, '@', 1)),
        case when v_phone is null then '{}'::text[] else array[v_phone] end,
        nullif(trim(coalesce(new.raw_user_meta_data->>'trade', '')), ''),
        new.email, v_boss.created_by, false, v_boss.worker_type, v_boss.id,
        now(), coalesce(v_boss.approved_by, v_boss.created_by),
        v_boss.default_pay_basis, v_boss.hourly_rate, v_boss.daily_rate, v_boss.project_rate
      ) returning id into v_worker_id;
      update public.worker_invites set uses = uses + 1 where id = v_invite.id;
    elsif v_invite.worker_id is null then
      if coalesce(v_invite.uses, 0) >= 20 then
        raise exception 'Ezt a meghívót már túl sokan használták. Kérj újat a vezetőktől!';
      end if;
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
      -- a munkavállaló a regisztrációkor módosíthatja a nevét, telefonját, szakmáját;
      -- az e-mail a regisztrált cím lesz; a becenév (partner-belső) nem változik
      update public.workers set
        name = coalesce(nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), ''), name),
        phones = case when v_phone is not null then array[v_phone] else phones end,
        trade = coalesce(nullif(trim(coalesce(new.raw_user_meta_data->>'trade', '')), ''), trade),
        email = new.email
        -- a vállalkozói jelölést itt NEM vesszük át a kliens metaadatából: a
        -- partner által felvett (már jóváhagyott) munkavállaló nem válhat
        -- jóváhagyás nélkül vállalkozóvá; ezt a partner állítja a Szerkesztésnél
      where id = v_worker_id;
    end if;

    select name into v_worker_name from public.workers where id = v_worker_id;
    insert into public.profiles (id, email, display_name, profit_share_percent, is_admin, worker_id,
                                 notify_comments, notify_big_expense, notify_weekly, notify_overdue)
    values (new.id, new.email,
            coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), v_worker_name, split_part(new.email, '@', 1)),
            0, false, v_worker_id, false, false, false, false);
    if v_invite.worker_id is not null then
      update public.worker_invites set used_at = now(), used_by = new.id, uses = uses + 1 where id = v_invite.id;
    end if;
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
end $function$

;
CREATE OR REPLACE FUNCTION public.fn_notify_assignee_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
            coalesce(v_task.code || ' — ', '') || v_task.title || ' — a vezetők másra osztották. A rögzített munkaidőd megmarad.',
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
$function$

;
CREATE OR REPLACE FUNCTION public.fn_subtask_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and not public.fn_is_partner() then
    if new.title <> old.title or new.position <> old.position or new.photo_required <> old.photo_required
       or new.deleted_at is distinct from old.deleted_at or new.task_id <> old.task_id then
      raise exception 'A részfeladatot csak a vezető szerkesztheti — te pipálhatod és fotózhatod.';
    end if;
  end if;
  if new.done_at is not null and old.done_at is null then
    if new.photo_required and coalesce(cardinality(new.photo_paths), 0) = 0 then
      raise exception 'Ehhez a lépéshez fotó kell, mielőtt késznek jelölöd.';
    end if;
    -- a készre jelölő mindig a hívó (munkavállaló nem írhat be mást)
    if auth.uid() is not null and not public.fn_is_partner() then new.done_by := auth.uid();
    else new.done_by := coalesce(new.done_by, auth.uid()); end if;
  end if;
  if new.done_at is null then new.done_by := null; end if;
  return new;
end $function$

;
CREATE OR REPLACE FUNCTION public.fn_ws_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- munkavállaló: csak „most” indítható menet (visszadátumozni a vezető tud),
    -- egyszerre egy nyitott menet, a befejezés nem lehet a jövőben
    if tg_op = 'INSERT' then
      if new.started_at < now() - interval '24 hours' or new.started_at > now() + interval '5 minutes' then
        raise exception 'Munkamenet csak most indítható — korábbi napot a vezető rögzít utólag.';
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
end $function$

;
CREATE OR REPLACE FUNCTION public.mark_attendance_paid(p_ids uuid[], p_paid boolean, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or not public.fn_is_partner() then raise exception 'Csak vezető jelölhet kifizetést.'; end if;
  perform set_config('app.allow_paid_tick', 'on', true);
  update public.attendance
     set paid_at = case when p_paid then now() end,
         paid_by = case when p_paid then auth.uid() end,
         paid_note = case when p_paid then nullif(trim(coalesce(p_note, '')), '') end
   where id = any(p_ids) and deleted_at is null;
end $function$

;
CREATE OR REPLACE FUNCTION public.mark_commission_paid(p_ids uuid[], p_paid boolean, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or not public.fn_is_partner() then raise exception 'Csak vezető jelölhet kifizetést.'; end if;
  perform set_config('app.allow_paid_tick', 'on', true);
  update public.attendance
     set commission_paid_at = case when p_paid then now() end,
         commission_paid_by = case when p_paid then auth.uid() end,
         commission_paid_note = case when p_paid then nullif(trim(coalesce(p_note, '')), '') end
   where id = any(p_ids) and deleted_at is null and referrer_external_id is not null;
end $function$

;
CREATE OR REPLACE FUNCTION public.mark_invoice_paid(p_id uuid, p_paid boolean, p_date date DEFAULT NULL::date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or not public.fn_is_partner() then raise exception 'Csak vezető jelölhet befolyást.'; end if;
  perform set_config('app.allow_paid_tick', 'on', true);
  update public.invoices
     set paid_at = case when p_paid then coalesce(p_date, (now() at time zone 'Europe/Budapest')::date) end,
         paid_marked_by = case when p_paid then auth.uid() end
   where id = p_id and deleted_at is null;
end $function$

;
CREATE OR REPLACE FUNCTION public.propose_profit_shares(p_shares jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
  v_others integer;
begin
  if v_me is null then raise exception 'Bejelentkezés szükséges.'; end if;
  if not public.fn_is_partner() then raise exception 'Csak a vezetők módosíthatnak részesedést.'; end if;
  perform public.fn_validate_shares(p_shares);

  if exists (select 1 from public.share_change_requests
             where status = 'pending' and deleted_at is null) then
    raise exception 'Már van függőben lévő módosítási javaslat. Előbb azt kell jóváhagyni, elutasítani vagy visszavonni.';
  end if;

  select count(*) into v_others
  from public.profiles where not is_admin and worker_id is null and id <> v_me;

  if v_others = 0 then
    insert into public.share_change_requests
      (proposed_by, shares, status, effective_from, decided_by, decided_at)
    values (v_me, p_shares, 'approved', (now() at time zone 'Europe/Budapest')::date, v_me, now());
    perform public.fn_apply_shares(p_shares, (now() at time zone 'Europe/Budapest')::date);
    return 'approved';
  end if;

  insert into public.share_change_requests (proposed_by, shares)
  values (v_me, p_shares);
  return 'pending';
end;
$function$

;
CREATE OR REPLACE FUNCTION public.reject_task_quote(p_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_q public.task_quotes%rowtype;
  v_task public.worker_tasks%rowtype;
  v_prof uuid;
begin
  if auth.uid() is null or not public.fn_is_partner() then
    raise exception 'Ajánlatot csak a vezetők utasíthatnak el.';
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
$function$

;
CREATE OR REPLACE FUNCTION public.reject_worker(p_worker uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_prof uuid;
begin
  if not public.fn_is_partner() then raise exception 'Csak vezető utasíthat el.'; end if;
  update public.workers set deleted_at = now(), updated_at = now()
   where id = p_worker and deleted_at is null and approved_at is null;
  if not found then raise exception 'A munkavállaló nem található vagy már jóvá van hagyva.'; end if;
  select id into v_prof from public.profiles where worker_id = p_worker;
  if v_prof is not null then
    insert into public.notification_queue (kind, recipient, title, body, payload)
    values ('worker_rejected', v_prof, 'Regisztrációd elutasítva',
            'A vezetők nem hagyták jóvá a regisztrációdat. Kérdezz rá náluk.',
            jsonb_build_object('worker_id', p_worker));
  end if;
end $function$

;
CREATE OR REPLACE FUNCTION public.reopen_site(p_site uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or not public.fn_is_partner() then raise exception 'Csak vezető nyithat újra építkezést.'; end if;
  update public.sites set status = 'active', closed_at = null, closed_by = null
   where id = p_site and deleted_at is null;
end $function$

;
CREATE OR REPLACE FUNCTION public.request_task_quote(p_task uuid, p_worker uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_task public.worker_tasks%rowtype;
  v_qid uuid;
  v_prof uuid;
  v_site text;
  v_existing boolean;
begin
  if auth.uid() is null or not public.fn_is_partner() then
    raise exception 'Ajánlatot csak a vezetők kérhetnek.';
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
$function$

;
CREATE OR REPLACE FUNCTION public.set_worker_bank_account(p_worker uuid, p_account text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_key text;
begin
  if auth.uid() is null or not public.fn_is_partner() then
    raise exception 'Bankszámlaszámot csak vezető rögzíthet.';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'bank_account_key';
  if v_key is null then raise exception 'Hiányzik a titkosító kulcs (vault: bank_account_key).'; end if;
  update public.workers
     set bank_account_enc = case when p_account is null or p_account = '' then null
                                 else pgp_sym_encrypt(p_account, v_key) end
   where id = p_worker;
end $function$

;
CREATE OR REPLACE FUNCTION public.site_close_checklist(p_site uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or not public.fn_is_partner() then raise exception 'Csak vezető kérheti le.'; end if;
  return jsonb_build_object(
    'unpaid_invoices', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'net_amount', i.net_amount, 'invoice_date', i.invoice_date))
      from public.invoices i
      where i.site_id = p_site and i.deleted_at is null and i.paid_at is null
    ), '[]'::jsonb),
    'unpaid_wages', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'work_date', a.work_date, 'worker_name', w.name, 'amount', a.amount - a.commission_amount))
      from public.attendance a join public.workers w on w.id = a.worker_id
      where a.site_id = p_site and a.deleted_at is null and a.pay_basis <> 'presence'
        and a.amount - a.commission_amount > 0 and a.paid_at is null
    ), '[]'::jsonb),
    'unpaid_commissions', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'work_date', a.work_date, 'referrer_name', ep.name, 'amount', a.commission_amount))
      from public.attendance a join public.external_people ep on ep.id = a.referrer_external_id
      where a.site_id = p_site and a.deleted_at is null
        and a.commission_amount > 0 and a.commission_paid_at is null
    ), '[]'::jsonb)
  );
end $function$

;
