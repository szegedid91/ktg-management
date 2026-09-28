-- Átvilágítás 2026-09-28 — biztonsági javítások.
-- 1) worker_tasks alaptábla: a munkavállaló a REST-en / Realtime-on át elolvashatta az ajánlati
--    összeget (quote_amount, quote_note, …), mert a wt_select policy a kiosztott feladatra engedte a
--    sort, az oszlopjog pedig teljes volt. A nézet (worker_tasks_v) maszkol; az alaptáblán mostantól
--    oszlop-szintű SELECT: az ajánlati oszlopok nincsenek benne (a partner is a nézeten át olvas).
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'worker_tasks'
    and column_name not in ('quote_amount', 'quote_note', 'quote_submitted_at', 'quote_accepted_by');
  execute 'revoke select on public.worker_tasks from authenticated';
  execute 'grant select (' || v_cols || ') on public.worker_tasks to authenticated';
end $$;

-- 2) task_notes: a szerző neve nem hamisítható, a jegyzet nem tehető át másik feladatra
create or replace function public.fn_task_note_author()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.fn_is_partner()
     and (new.task_id <> old.task_id or new.created_by <> old.created_by or new.created_at <> old.created_at) then
    raise exception 'A megjegyzés feladata nem módosítható.';
  end if;
  if new.author_name is null or (auth.uid() is not null and not public.fn_is_partner()) then
    select coalesce(w.nickname, w.name, p.display_name) into new.author_name
    from public.profiles p left join public.workers w on w.id = p.worker_id where p.id = new.created_by;
  end if;
  return new;
end $$;
revoke all on function public.fn_task_note_author() from public, anon, authenticated;
drop trigger if exists trg_task_note_author on public.task_notes;
create trigger trg_task_note_author before insert or update on public.task_notes
  for each row execute function public.fn_task_note_author();

-- 3) anyagköltség / fotó: munkavállaló csak élő (futó vagy nyitva hagyott nem sikerült) feladatra rögzíthet
create or replace function public.fn_task_material_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.fn_is_partner() then
    if not exists (select 1 from public.worker_tasks t where t.id = new.task_id and t.deleted_at is null
                   and (t.status in ('assigned', 'acknowledged') or (t.status = 'failed' and t.closed_at is null))) then
      raise exception 'Lezárt feladathoz már nem rögzíthető anyagköltség.';
    end if;
    if tg_op = 'UPDATE' then
      if new.task_id <> old.task_id or new.worker_id is distinct from old.worker_id
         or new.created_by is distinct from old.created_by or new.created_at <> old.created_at
         or new.deleted_at is distinct from old.deleted_at then
        raise exception 'Az anyagköltségnek csak az összegét, megjegyzését és fotóit módosíthatod.';
      end if;
      if exists (select 1 from public.task_material_pricing p where p.material_id = new.id) then
        raise exception 'Ezt a tételt a vezető már beárazta — módosítást tőle kérj.';
      end if;
    end if;
    if new.amount is null or new.amount <= 0 then
      raise exception 'Az összegnek nullánál nagyobbnak kell lennie.';
    end if;
    if new.amount > 100000 and coalesce(cardinality(new.photo_paths), 0) = 0 and new.photo_path is null then
      raise exception '100 000 Ft feletti anyagköltséghez kötelező a számla fotója.';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.fn_task_material_guard() from public, anon, authenticated;
drop policy if exists tp_insert on public.task_photos;
create policy tp_insert on public.task_photos for insert to authenticated
  with check (created_by = (select auth.uid()) and (public.fn_is_partner() or (
    worker_id = public.fn_my_worker_id()
    and exists (select 1 from public.task_assignees a where a.task_id = task_photos.task_id and a.worker_id = public.fn_my_worker_id() and a.deleted_at is null and a.acknowledged_at is not null)
    and exists (select 1 from public.worker_tasks t where t.id = task_photos.task_id and t.deleted_at is null
                and (t.status in ('assigned', 'acknowledged') or (t.status = 'failed' and t.closed_at is null))))));

-- 4) tároló: munkavállaló csak a feladat munkafotó-mappáiba tölthet fel (a „brief” a vezetőé)
drop policy if exists tasks_insert on storage.objects;
create policy tasks_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tasks' and (public.fn_is_partner() or (
    (storage.foldername(name))[2] = any (array['material', 'fail', 'sub', 'before', 'after'])
    and exists (select 1 from public.task_assignees a where a.worker_id = public.fn_my_worker_id() and a.deleted_at is null
                and a.task_id::text = (storage.foldername(name))[1]))));

-- 5) workers_v: a vezetői belső jegyzet és a jóváhagyó csak vezetőnek; adószám / székhely csak
--    a vezetőnek és magának a munkavállalónak (a csapattag / főnök ne lássa)
do $$
declare v_def text;
begin
  v_def := pg_get_viewdef('public.workers_v'::regclass, true);
  if position('WHEN me.partner THEN w.note' in v_def) > 0 then return; end if; -- már javítva
  v_def := replace(v_def, E'CASE\n            WHEN f."full" THEN w.note\n            ELSE NULL::text\n        END AS note', 'CASE WHEN me.partner THEN w.note ELSE NULL::text END AS note');
  v_def := replace(v_def, E'CASE\n            WHEN f."full" THEN w.approved_by\n            ELSE NULL::uuid\n        END AS approved_by', 'CASE WHEN me.partner THEN w.approved_by ELSE NULL::uuid END AS approved_by');
  v_def := replace(v_def, E'CASE\n            WHEN f."full" THEN w.tax_number\n            ELSE NULL::text\n        END AS tax_number', 'CASE WHEN me.partner OR w.id = ANY (me.mine) THEN w.tax_number ELSE NULL::text END AS tax_number');
  v_def := replace(v_def, E'CASE\n            WHEN f."full" THEN w.hq_address\n            ELSE NULL::text\n        END AS hq_address', 'CASE WHEN me.partner OR w.id = ANY (me.mine) THEN w.hq_address ELSE NULL::text END AS hq_address');
  if position('WHEN me.partner THEN w.note' in v_def) = 0 or position('WHEN me.partner THEN w.approved_by' in v_def) = 0
     or position('THEN w.tax_number' in v_def) = 0 then
    raise exception 'workers_v: a várt oszlopdefiníció nem található';
  end if;
  execute 'create or replace view public.workers_v with (security_barrier = true, security_invoker = false) as ' || v_def;
end $$;
revoke all on public.workers_v from public, anon, authenticated;
grant select on public.workers_v to authenticated;

-- 6) worker_task_action: elfogadás idempotens (nincs értesítés-spam), lezárt feladatot nem lehet elfogadni /
--    ajánlatot adni rá; ajánlat percenként legfeljebb egyszer; a vállalkozó akkor is készre jelentheti,
--    ha csak az emberei dolgoztak rajta; ismételt „nem sikerült” jelentésnél a régi fotók megmaradnak
do $$
declare v_def text;
  v_old1 text := E'  if p_action = ''acknowledge'' then\n';
  v_new1 text := E'  if p_action in (''acknowledge'', ''quote'') and (v_task.closed_at is not null or v_task.status in (''done'', ''cancelled'')) then\n    raise exception ''Ez a feladat már le van zárva.'';\n  end if;\n  if p_action = ''acknowledge'' then\n    if v_me.acknowledged_at is not null then return; end if;\n';
  v_old2 text := E'    if v_q.id is not null and v_q.status = ''accepted'' then\n      raise exception ''Az ajánlatodat már elfogadták.'';\n    end if;\n';
  v_new2 text := E'    if v_q.id is not null and v_q.status = ''accepted'' then\n      raise exception ''Az ajánlatodat már elfogadták.'';\n    end if;\n    if v_q.id is not null and v_q.submitted_at > now() - interval ''1 minute'' then\n      raise exception ''Az ajánlatot az imént küldted el — várj egy percet a módosítással.'';\n    end if;\n';
  v_old3 text := E'                     where task_id = p_id and worker_id = v_wid and deleted_at is null) then\n';
  v_new3 text := E'                     where task_id = p_id and worker_id = any(public.fn_my_worker_ids()) and deleted_at is null) then\n';
  v_old4 text := E'          fail_photo_path = v_paths[1], fail_photo_paths = v_paths,\n';
  v_new4 text := E'          fail_photo_path = coalesce(v_paths[1], fail_photo_path),\n          fail_photo_paths = (select coalesce(array_agg(x), ''{}'') from unnest(coalesce(fail_photo_paths, ''{}'') || v_paths) x),\n';
begin
  v_def := pg_get_functiondef('public.worker_task_action(uuid,text,text,text,numeric,text[])'::regprocedure);
  if position('if v_me.acknowledged_at is not null then return; end if;' in v_def) > 0 then return; end if; -- már javítva
  if position(v_old1 in v_def) = 0 or position(v_old2 in v_def) = 0 or position(v_old3 in v_def) = 0 or position(v_old4 in v_def) = 0 then
    raise exception 'worker_task_action: a várt szövegrész nem található';
  end if;
  execute replace(replace(replace(replace(v_def, v_old1, v_new1), v_old2, v_new2), v_old3, v_new3), v_old4, v_new4);
end $$;

-- 7) partnerek elszámolása: a kifizetett napnál a ténylegesen kifizetett összeg számít (paid_amount),
--    akkor is, ha a nap bére a kifizetés után módosult (Daniel döntése, 2026-09-28)
do $$
declare v_def text;
  v_old text := 'sum(attendance.amount - attendance.commission_amount) AS spent_wages';
  v_new text := 'sum(COALESCE(attendance.paid_amount, attendance.amount - attendance.commission_amount)) AS spent_wages';
begin
  v_def := pg_get_viewdef('public.v_user_balances'::regclass, true);
  if position(v_new in v_def) > 0 then return; end if; -- már javítva
  if position(v_old in v_def) = 0 then raise exception 'v_user_balances: a várt szövegrész nem található'; end if;
  execute 'create or replace view public.v_user_balances with (security_invoker = true) as ' || replace(v_def, v_old, v_new);
end $$;

-- 8) advisor: hiányzó FK-indexek, policy auth.uid() egyszeri kiértékelése
create index if not exists ix_fk_item_codes_created_by on public.item_codes(created_by);
create index if not exists ix_fk_task_events_worker_id on public.task_events(worker_id);
create index if not exists ix_fk_worker_tasks_item_code_id on public.worker_tasks(item_code_id);
drop policy if exists ic_insert on public.item_codes;
create policy ic_insert on public.item_codes for insert to authenticated
  with check (public.fn_is_partner() and created_by = (select auth.uid()));
