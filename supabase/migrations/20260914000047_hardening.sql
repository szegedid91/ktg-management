-- Biztonsági keményítés az átvilágítás alapján (2026-09-14).
-- Fő elv: a pénzügyi táblákba csak fő felhasználó (partner) írhat; a
-- munkavállalói fiók csak a saját munkamenetét/anyagköltségét/fotóit;
-- minden partner-művelet RPC-je ellenőrzi a szerepet; belső segédfüggvények
-- és névtelen hívók nem érik el a SECURITY DEFINER függvényeket.

-- ============================================================ C1: profil
-- A worker_id / is_admin / profit_share_percent oszlopot kliens nem írhatja:
-- csak a megengedett oszlopokra van UPDATE jog.
revoke update on public.profiles from authenticated;
grant update (display_name, email, push_token, notify_comments, notify_big_expense,
              big_expense_threshold, notify_weekly, notify_overdue, overdue_days)
  on public.profiles to authenticated;

-- ============================================================ H5: profil-olvasás
-- A tábla teljes sora csak saját magának és partnernek; a munkavállaló a
-- partnerek nevét egy maszkoló nézeten át látja (push_token, e-mail,
-- részesedés nélkül). A kliens a profiles_v nézetből szinkronizál.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.fn_is_partner());

create or replace view public.profiles_v with (security_barrier = true) as
  select p.id,
         p.display_name,
         case when p.id = auth.uid() or public.fn_is_partner() then p.email end as email,
         p.is_admin,
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
-- a nézet a tulajdonos (postgres) jogával olvassa a táblát, a szűrést maga végzi
alter view public.profiles_v set (security_invoker = false);
revoke all on public.profiles_v from public, anon;
grant select on public.profiles_v to authenticated;

drop policy if exists allowed_emails_select on public.allowed_emails;
create policy allowed_emails_select on public.allowed_emails for select to authenticated
  using (public.fn_is_partner());

-- ============================================================ C2: írás csak partnernek
do $$
declare t text;
begin
  foreach t in array array['expenses','expense_photos','invoices','settlements','equipment',
                           'equipment_moves','external_people','attendance','sites'] loop
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (public.fn_is_partner() and created_by = auth.uid())', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (public.fn_is_partner() and created_by = auth.uid()) with check (public.fn_is_partner() and created_by = auth.uid())', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (public.fn_is_partner() and created_by = auth.uid())', t, t);
  end loop;
end $$;

drop policy if exists workers_insert on public.workers;
create policy workers_insert on public.workers for insert to authenticated
  with check (public.fn_is_partner() and created_by = auth.uid());
drop policy if exists workers_update on public.workers;
create policy workers_update on public.workers for update to authenticated
  using (public.fn_is_partner() and (created_by = auth.uid() or approved_at is null))
  with check (public.fn_is_partner() and (created_by = auth.uid() or approved_at is null));
drop policy if exists workers_delete on public.workers;
create policy workers_delete on public.workers for delete to authenticated
  using (public.fn_is_partner() and created_by = auth.uid());

drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated
  with check (public.fn_is_partner() and author_id = auth.uid());
drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments for update to authenticated
  using (public.fn_is_partner() and author_id = auth.uid()) with check (public.fn_is_partner() and author_id = auth.uid());
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete to authenticated
  using (public.fn_is_partner() and author_id = auth.uid());

drop policy if exists expense_categories_insert on public.expense_categories;
create policy expense_categories_insert on public.expense_categories for insert to authenticated
  with check (public.fn_is_partner() and created_by = auth.uid());
drop policy if exists expense_categories_update on public.expense_categories;
create policy expense_categories_update on public.expense_categories for update to authenticated
  using (public.fn_is_partner()) with check (public.fn_is_partner());
drop policy if exists expense_categories_delete on public.expense_categories;
create policy expense_categories_delete on public.expense_categories for delete to authenticated
  using (public.fn_is_partner() and created_by = auth.uid());

-- ============================================================ C3: beállítások
drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings for update to authenticated
  using (public.fn_is_partner()) with check (public.fn_is_partner());

-- ============================================================ sites: törölt sor sehol
drop policy if exists sites_select on public.sites;
create policy sites_select on public.sites for select to authenticated
  using (
    public.fn_is_partner()
    or (deleted_at is null and public.fn_my_worker_id() is not null and (
      status = 'active'
      or exists (select 1 from public.task_assignees a join public.worker_tasks t on t.id = a.task_id
                 where a.worker_id = public.fn_my_worker_id() and a.deleted_at is null and t.site_id = sites.id)
      or exists (select 1 from public.attendance x where x.worker_id = public.fn_my_worker_id() and x.site_id = sites.id)
      or exists (select 1 from public.work_sessions w where w.worker_id = public.fn_my_worker_id() and w.site_id = sites.id)
    ))
  );

-- ============================================================ H1: partner-RPC-k
create or replace function public.mark_attendance_paid(p_ids uuid[], p_paid boolean, p_note text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or not public.fn_is_partner() then raise exception 'Csak fő felhasználó jelölhet kifizetést.'; end if;
  perform set_config('app.allow_paid_tick', 'on', true);
  update public.attendance
     set paid_at = case when p_paid then now() end,
         paid_by = case when p_paid then auth.uid() end,
         paid_note = case when p_paid then nullif(trim(coalesce(p_note, '')), '') end
   where id = any(p_ids) and deleted_at is null;
end $$;

create or replace function public.mark_commission_paid(p_ids uuid[], p_paid boolean, p_note text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or not public.fn_is_partner() then raise exception 'Csak fő felhasználó jelölhet kifizetést.'; end if;
  perform set_config('app.allow_paid_tick', 'on', true);
  update public.attendance
     set commission_paid_at = case when p_paid then now() end,
         commission_paid_by = case when p_paid then auth.uid() end,
         commission_paid_note = case when p_paid then nullif(trim(coalesce(p_note, '')), '') end
   where id = any(p_ids) and deleted_at is null and referrer_external_id is not null;
end $$;

create or replace function public.mark_invoice_paid(p_id uuid, p_paid boolean, p_date date default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or not public.fn_is_partner() then raise exception 'Csak fő felhasználó jelölhet befolyást.'; end if;
  perform set_config('app.allow_paid_tick', 'on', true);
  update public.invoices
     set paid_at = case when p_paid then coalesce(p_date, (now() at time zone 'Europe/Budapest')::date) end,
         paid_marked_by = case when p_paid then auth.uid() end
   where id = p_id and deleted_at is null;
end $$;

-- H2: az ellenőrzőlista csak partnernek
create or replace function public.site_close_checklist(p_site uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or not public.fn_is_partner() then raise exception 'Csak fő felhasználó kérheti le.'; end if;
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
end $$;

create or replace function public.close_site(p_site uuid, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_checklist jsonb;
  v_has_issues boolean;
begin
  if auth.uid() is null or not public.fn_is_partner() then raise exception 'Csak fő felhasználó zárhat le építkezést.'; end if;
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
end $$;

create or replace function public.reopen_site(p_site uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or not public.fn_is_partner() then raise exception 'Csak fő felhasználó nyithat újra építkezést.'; end if;
  update public.sites set status = 'active', closed_at = null, closed_by = null
   where id = p_site and deleted_at is null;
end $$;

create or replace function public.copy_attendance_from_previous_day(p_site uuid, p_date date)
returns setof public.attendance language plpgsql security definer set search_path to 'public' as $$
declare v_prev date;
begin
  if auth.uid() is null or not public.fn_is_partner() then raise exception 'Csak fő felhasználó rögzíthet jelenlétet.'; end if;
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
end $$;

-- ============================================================ H4: bankszámla
create or replace function public.set_worker_bank_account(p_worker uuid, p_account text)
returns void language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_key text;
begin
  if auth.uid() is null or not public.fn_is_partner() then
    raise exception 'Bankszámlaszámot csak fő felhasználó rögzíthet.';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'bank_account_key';
  if v_key is null then raise exception 'Hiányzik a titkosító kulcs (vault: bank_account_key).'; end if;
  update public.workers
     set bank_account_enc = case when p_account is null or p_account = '' then null
                                 else pgp_sym_encrypt(p_account, v_key) end
   where id = p_worker;
end $$;

create or replace function public.get_worker_bank_account(p_worker uuid)
returns text language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_key text; v_enc bytea;
begin
  if auth.uid() is null then raise exception 'Bejelentkezés szükséges.'; end if;
  if not public.fn_is_partner() and p_worker is distinct from public.fn_my_worker_id() then
    raise exception 'Csak a saját bankszámlaszámodat láthatod.';
  end if;
  select bank_account_enc into v_enc from public.workers where id = p_worker;
  if v_enc is null then return null; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'bank_account_key';
  return pgp_sym_decrypt(v_enc, v_key);
end $$;

-- ============================================================ H3: jogok
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
-- belső segédek: csak más definer-függvényből
revoke execute on function public.fn_task_quote_wage(uuid) from authenticated;
revoke execute on function public.fn_recalc_session_wage(uuid, uuid, date) from authenticated;
revoke execute on function public.fn_notify_partners(text, text, text, jsonb) from authenticated;
revoke execute on function public.fn_worker_auto_basis(uuid) from authenticated;
-- rögzített search_path a tanácsadó által jelzett függvényeken
alter function public.fn_touch_updated_at() set search_path = public;
alter function public.fn_protect_builtin_category() set search_path = public;
alter function public.fn_protect_admin_flag() set search_path = public;
alter function public.fn_protect_share_percent() set search_path = public;

-- ============================================================ projektdíj csak kész feladatnál
create or replace function public.fn_task_quote_wage(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.worker_tasks%rowtype;
  v_worker uuid;
begin
  select * into t from public.worker_tasks where id = p_task;
  if t.status <> 'done' or t.quote_accepted_at is null or t.quote_amount is null or t.site_id is null then return; end if;
  select worker_id into v_worker from public.task_quotes
  where task_id = p_task and status = 'accepted' and deleted_at is null order by decided_at desc limit 1;
  if v_worker is null then
    select worker_id into v_worker from public.task_assignees where task_id = p_task and deleted_at is null limit 1;
  end if;
  if v_worker is null then return; end if;
  if exists (select 1 from public.attendance where task_id = p_task and worker_id = v_worker and source = 'task' and deleted_at is null) then return; end if;
  begin
    perform set_config('app.allow_paid_tick', 'on', true);
    insert into public.attendance (work_date, site_id, worker_id, created_by, pay_basis, hours, day_multiplier,
                                   applied_rate, source, task_id, note)
    values ((coalesce(t.done_at, now()) at time zone 'Europe/Budapest')::date, t.site_id, v_worker, t.created_by,
            'project', null, 1, t.quote_amount, 'task', p_task,
            'elfogadott ajánlat: ' || coalesce(t.code || ' ', '') || t.title);
  exception when others then
    raise notice 'task wage skipped: %', sqlerrm;
  end;
end $$;

-- ============================================================ M2 + M3: bér-újraszámítás
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
  v_hours := round(v_hours, 2);

  select * into v_row from public.attendance
  where worker_id = p_worker and site_id = p_site and work_date = p_date
    and source = 'session' and deleted_at is null;

  -- lezárt építkezésen is átmehet a bér-sor karbantartása (a munkaidő valós)
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
  if v_row.id is null and exists (select 1 from public.attendance where worker_id = p_worker and site_id = p_site
             and work_date = p_date and source = 'session' and deleted_at is not null) then
    return;
  end if;

  v_basis := public.fn_worker_auto_basis(p_worker);

  if v_row.id is not null then
    if v_row.paid_at is not null then return; end if;
    begin
      update public.attendance
      set pay_basis = v_basis,
          -- a partner egyedi díj-felülírása megmarad; csak mód-váltásnál oldjuk fel újra
          applied_rate = case when v_row.pay_basis = v_basis then applied_rate else null end,
          hours = case when v_basis = 'hourly' then v_hours else null end,
          day_multiplier = 1,
          task_id = coalesce(v_task, task_id),
          note = 'munkaidő alapján (automatikus) · ' || to_char(v_hours, 'FM990.00') || ' óra'
      where id = v_row.id;
    exception when others then raise notice 'session wage update skipped: %', sqlerrm; end;
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
            'munkaidő alapján (automatikus) · ' || to_char(v_hours, 'FM990.00') || ' óra');
  exception when others then
    raise notice 'session wage skipped: %', sqlerrm;
  end;
end $$;

-- ============================================================ M1: munkamenet-őr
create or replace function public.fn_ws_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ended_at is not null then
    if new.ended_at <= new.started_at then
      raise exception 'A befejezés a kezdés után kell legyen.';
    end if;
    -- elfelejtett lezárás: legfeljebb 16 óra számolható egy menetre
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
drop trigger if exists trg_ws_guard on public.work_sessions;
create trigger trg_ws_guard before insert or update on public.work_sessions
  for each row execute function public.fn_ws_guard();

-- ============================================================ M4: worker_task_action visszaellenőrzések
create or replace function public.worker_task_action(
  p_id uuid, p_action text, p_reason text default null, p_photo_path text default null,
  p_amount numeric default null, p_photo_paths text[] default null)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_wid uuid := public.fn_my_worker_id();
  v_task public.worker_tasks%rowtype;
  v_me public.task_assignees%rowtype;
  v_name text;
  v_pending integer;
  v_paths text[];
  v_q public.task_quotes%rowtype;
begin
  if auth.uid() is null then raise exception 'Bejelentkezés szükséges.'; end if;
  select * into v_task from public.worker_tasks
  where id = p_id and deleted_at is null for update;
  if not found then raise exception 'A feladat nem található.'; end if;
  if v_wid is not null then
    select * into v_me from public.task_assignees where task_id = p_id and worker_id = v_wid and deleted_at is null;
  end if;
  if v_wid is null or v_me.id is null then
    raise exception 'Ez a feladat nem hozzád tartozik.';
  end if;

  select coalesce(nickname, name) into v_name from public.workers where id = v_wid;
  select * into v_q from public.task_quotes
  where task_id = p_id and worker_id = v_wid and deleted_at is null
  order by (status in ('requested', 'submitted')) desc, requested_at desc, created_at desc limit 1;

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
    if p_amount > 999999999 then raise exception 'Túl nagy ajánlati összeg.'; end if;
    if v_q.id is not null and v_q.status = 'accepted' then
      raise exception 'Az ajánlatodat már elfogadták.';
    end if;
    if v_q.id is null or v_q.status not in ('requested', 'submitted') then
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
    update public.task_assignees set deleted_at = now()
    where task_id = p_id and worker_id = v_wid and deleted_at is null;
    perform public.fn_notify_partners('task', 'Nem vállalja ✋',
      coalesce(v_name, 'A munkavállaló') || ' nem vállalja: ' || v_task.title
      || coalesce(' — ' || nullif(trim(coalesce(p_reason, '')), ''), '')
      || ' (kérhetsz új ajánlatot az appban)',
      jsonb_build_object('task_id', p_id));

  elsif p_action in ('done', 'fail') then
    if v_task.status not in ('assigned', 'acknowledged') then
      raise exception 'Ez a feladat már le van zárva.';
    end if;
    if v_q.id is not null and v_q.status in ('requested', 'submitted') then
      raise exception 'Előbb az ajánlatkérést kell lezárni (ajánlat vagy nem vállalom).';
    end if;
    if v_me.acknowledged_at is null then
      raise exception 'Előbb fogadd el a feladatot.';
    end if;
    if p_action = 'done' then
      if not exists (select 1 from public.work_sessions
                     where task_id = p_id and worker_id = v_wid and deleted_at is null) then
        raise exception 'A feladat akkor jelölhető késznek, ha előtte elindítottad rajta a munkát.';
      end if;
      update public.worker_tasks
      set status = 'done', done_at = now(), acknowledged_at = coalesce(acknowledged_at, now())
      where id = p_id;
      insert into public.notification_queue (kind, recipient, title, body, payload)
      values ('task', v_task.created_by, 'Feladat elkészült ✔️',
              coalesce(v_name, 'A munkavállaló') || ' elkészült: ' || v_task.title,
              jsonb_build_object('task_id', p_id));
    else
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
    end if;
  else
    raise exception 'Ismeretlen művelet.';
  end if;
end;
$$;

-- ============================================================ M8: tároló
update storage.buckets
   set file_size_limit = 8388608,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif']
 where id in ('receipts', 'equipment', 'tasks');

drop policy if exists receipts_insert on storage.objects;
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('receipts', 'equipment') and public.fn_is_partner());
drop policy if exists receipts_update on storage.objects;
create policy receipts_update on storage.objects for update to authenticated
  using (bucket_id in ('receipts', 'equipment') and public.fn_is_partner());
drop policy if exists receipts_delete on storage.objects;
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id in ('receipts', 'equipment') and public.fn_is_partner());
drop policy if exists tasks_insert on storage.objects;
create policy tasks_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tasks' and (
    public.fn_is_partner()
    or exists (select 1 from public.task_assignees a
               where a.worker_id = public.fn_my_worker_id() and a.deleted_at is null
                 and a.task_id::text = (storage.foldername(name))[1])
  ));

-- ============================================================ alacsony tételek
-- egyszerre csak egy függő részesedés-javaslat
create unique index if not exists share_change_requests_one_pending
  on public.share_change_requests ((1)) where status = 'pending' and deleted_at is null;

-- ajánlati összeg felső korlát (a bér-sor numeric(14,2) mezőjébe férjen)
alter table public.task_quotes drop constraint if exists task_quotes_amount_max;
alter table public.task_quotes add constraint task_quotes_amount_max check (amount is null or amount <= 999999999);

-- törölt építkezés végleges takarítása: a kapcsolódó munkamenetek, feladatok,
-- anyagköltségek, eszközmozgások is
create or replace function public.fn_purge_deleted_sites()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_site record;
  v_count integer := 0;
begin
  perform set_config('app.allow_paid_tick', 'on', true);
  for v_site in
    select id from public.sites
    where deleted_at is not null and deleted_at < now() - interval '30 days'
  loop
    update public.expenses set deleted_at = now(), updated_at = now() where site_id = v_site.id and deleted_at is null;
    update public.invoices set deleted_at = now(), updated_at = now() where site_id = v_site.id and deleted_at is null;
    update public.attendance set deleted_at = now(), updated_at = now() where site_id = v_site.id and deleted_at is null;
    update public.work_sessions set deleted_at = now(), updated_at = now() where site_id = v_site.id and deleted_at is null;
    update public.task_materials m set deleted_at = now(), updated_at = now()
      from public.worker_tasks t where t.id = m.task_id and t.site_id = v_site.id and m.deleted_at is null;
    update public.worker_tasks set deleted_at = now(), updated_at = now() where site_id = v_site.id and deleted_at is null;
    update public.equipment_moves set deleted_at = now(), updated_at = now() where site_id = v_site.id and deleted_at is null;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- általános meghívó: legfeljebb 20 regisztráció; a token nem marad a fiók metaadatában
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
begin
  v_token := new.raw_user_meta_data->>'invite_token';
  if v_token is not null and v_token <> '' then
    select * into v_invite from public.worker_invites
    where token = v_token and expires_at > now() and (worker_id is null or used_at is null)
    for update;
    if not found then
      raise exception 'A meghívó érvénytelen vagy lejárt. Kérj újat a fő felhasználóktól!';
    end if;

    if v_invite.worker_id is null then
      if coalesce(v_invite.uses, 0) >= 20 then
        raise exception 'Ezt a meghívót már túl sokan használták. Kérj újat a fő felhasználóktól!';
      end if;
      v_phone := nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), '');
      insert into public.workers (name, phones, trade, email, created_by)
      values (
        coalesce(nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), ''), split_part(new.email, '@', 1)),
        case when v_phone is null then '{}'::text[] else array[v_phone] end,
        nullif(trim(coalesce(new.raw_user_meta_data->>'trade', '')), ''),
        new.email,
        v_invite.created_by
      ) returning id into v_worker_id;
      update public.worker_invites set uses = uses + 1 where id = v_invite.id;
    else
      if exists (select 1 from public.profiles where worker_id = v_invite.worker_id) then
        raise exception 'Ehhez a munkavállalóhoz már tartozik fiók.';
      end if;
      v_worker_id := v_invite.worker_id;
      update public.workers set email = coalesce(email, new.email) where id = v_worker_id;
      update public.worker_invites set used_at = now(), used_by = new.id, uses = uses + 1 where id = v_invite.id;
    end if;

    select name into v_worker_name from public.workers where id = v_worker_id;
    insert into public.profiles (id, email, display_name, profit_share_percent, is_admin, worker_id,
                                 notify_comments, notify_big_expense, notify_weekly, notify_overdue)
    values (new.id, new.email,
            coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), v_worker_name, split_part(new.email, '@', 1)),
            0, false, v_worker_id, false, false, false, false);
    -- a token ne maradjon olvasható a fiók metaadatában
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
