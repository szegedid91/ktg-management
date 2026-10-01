-- A munkavállaló egy ideig látja a kész feladatait (2026-10-01, Daniel kérése).
-- A vezetők a Beállításokban adják meg, hány napig (app_settings.worker_done_visible_days, alap: 35;
-- 0 = a kész feladat azonnal eltűnik, mint eddig). „Kész” a munkavállalónak: a saját részét készre
-- jelentette (task_assignees.done_at) — akkor is, ha a többiek még dolgoznak rajta —, vagy a vezető
-- lezárta a feladatot. A kész feladat csak olvasható: munkaidő, anyag, fotó, megjegyzés nem adható hozzá.

alter table public.app_settings add column if not exists worker_done_visible_days integer not null default 35;
alter table public.app_settings add column if not exists worker_done_days_changed_at timestamptz not null default now();
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_worker_done_days_check') then
    alter table public.app_settings add constraint app_settings_worker_done_days_check
      check (worker_done_visible_days between 0 and 3650);
  end if;
end $$;

-- a napok számának változását időbélyeg jelzi: a munkavállalói készülék ebből tudja, hogy újra kell
-- töltenie a feladatait (a kliens ezt az oszlopot nem írhatja át)
create or replace function public.fn_app_settings_done_days()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.worker_done_visible_days is distinct from old.worker_done_visible_days then
    new.worker_done_days_changed_at := now();
  else
    new.worker_done_days_changed_at := old.worker_done_days_changed_at;
  end if;
  return new;
end $$;
revoke all on function public.fn_app_settings_done_days() from public, anon, authenticated;
drop trigger if exists trg_app_settings_done_days on public.app_settings;
create trigger trg_app_settings_done_days before update on public.app_settings
  for each row execute function public.fn_app_settings_done_days();

-- a beállítás a munkavállalónak is kell (az app_settings többi része — díjak — neki nem olvasható)
create or replace function public.fn_worker_done_window()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('days', s.worker_done_visible_days, 'changed_at', s.worker_done_days_changed_at)
  from public.app_settings s where s.id = 1;
$$;
revoke all on function public.fn_worker_done_window() from public, anon;
grant execute on function public.fn_worker_done_window() to authenticated;

-- a munkavállaló kész feladatai az időablakon belül: a saját része kész, a feladat nincs törölve / visszavonva
create or replace function public.fn_my_done_task_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct a.task_id), '{}'::uuid[])
  from public.task_assignees a
  join public.worker_tasks t on t.id = a.task_id
  cross join (select worker_done_visible_days as days from public.app_settings where id = 1) s
  where a.worker_id = public.fn_my_worker_id() and a.deleted_at is null and a.done_at is not null
    and a.done_at >= now() - make_interval(days => s.days)
    and t.deleted_at is null
    and (t.status in ('done', 'assigned', 'acknowledged') or (t.status = 'failed' and t.closed_at is null));
$$;
revoke all on function public.fn_my_done_task_ids() from public, anon;
grant execute on function public.fn_my_done_task_ids() to authenticated;

-- amit a munkavállaló olvashat: a futó feladatai + a nemrég elkészültek
create or replace function public.fn_my_visible_task_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select public.fn_my_active_task_ids() || public.fn_my_done_task_ids();
$$;
revoke all on function public.fn_my_visible_task_ids() from public, anon;
grant execute on function public.fn_my_visible_task_ids() to authenticated;

-- olvasás: futó + nemrég kész (az írás — munkaidő, anyag, fotó, megjegyzés — továbbra is csak futó feladatra megy)
drop policy if exists wt_select on public.worker_tasks;
create policy wt_select on public.worker_tasks for select to authenticated
  using (public.fn_is_partner() or id = any((select public.fn_my_visible_task_ids())::uuid[]));

drop policy if exists ta_select on public.task_assignees;
create policy ta_select on public.task_assignees for select to authenticated
  using (public.fn_is_partner() or worker_id = public.fn_my_worker_id()
         or task_id = any((select public.fn_my_visible_task_ids())::uuid[]));

drop policy if exists ts_select on public.task_subtasks;
create policy ts_select on public.task_subtasks for select to authenticated
  using (public.fn_is_partner() or task_id = any((select public.fn_my_visible_task_ids())::uuid[]));

drop policy if exists tn_select on public.task_notes;
create policy tn_select on public.task_notes for select to authenticated
  using (public.fn_is_partner() or (visible_to_workers and task_id = any((select public.fn_my_visible_task_ids())::uuid[])
    and exists (select 1 from public.task_assignees a where a.task_id = task_notes.task_id and a.worker_id = public.fn_my_worker_id()
                and a.deleted_at is null and a.acknowledged_at is not null)));

-- a feladat leírásához csatolt képek és a részfeladat-fotók a kész feladatnál is megnyithatók
drop policy if exists tasks_read on storage.objects;
create policy tasks_read on storage.objects for select to authenticated
  using (bucket_id = 'tasks' and (public.fn_is_partner() or owner = auth.uid()
    or ((storage.foldername(name))[2] = any (array['brief', 'sub'])
        and (storage.foldername(name))[1] in (select x::text from unnest(public.fn_my_visible_task_ids()) x))));

-- munkavállalói nézet: a nemrég kész feladat teljes tartalommal megy le; ami kifutott az időablakból,
-- az „törölve” jelzést kap — a jelzés időbélyege a kifutás pillanata, így a készülék növekményes
-- lehúzása is észreveszi, hogy el kell tüntetnie
create or replace view public.worker_tasks_v
with (security_barrier = true, security_invoker = false) as
with me as (select public.fn_is_partner() as partner, public.fn_my_worker_id() as wid, public.fn_my_visible_task_ids() as vis,
                   (select worker_done_visible_days from public.app_settings where id = 1) as days)
select t.id, t.worker_id, t.site_id, t.code, t.title, t.details, t.status, t.acknowledged_at, t.done_at,
       t.fail_reason, t.fail_photo_path, t.created_by, t.created_at, t.updated_at, t.deleted_at,
       t.quote_requested,
       case when me.partner then t.quote_amount end as quote_amount,
       case when me.partner then t.quote_note end as quote_note,
       case when me.partner then t.quote_submitted_at end as quote_submitted_at,
       t.quote_accepted_at,
       case when me.partner then t.quote_accepted_by end as quote_accepted_by,
       t.photo_paths, t.fail_photo_paths, t.priority, t.due_date, t.overdue_notified_at,
       t.item_code_id, t.closed_at
from public.worker_tasks t cross join me
where me.partner or t.id = any(me.vis)
union all
-- tombstone: volt kiosztása, de már nem látható (törölt / levett / visszavont / kifutott az időablakból)
select t.id, null::uuid, null::uuid, null::text, ''::text, null::text, 'cancelled'::text, null::timestamptz, null::timestamptz,
       null::text, null::text, t.created_by, t.created_at,
       greatest(t.updated_at, a.updated_at, coalesce(t.deleted_at, a.deleted_at, t.updated_at),
                case when a.done_at + make_interval(days => me.days) < now() then a.done_at + make_interval(days => me.days) end) as updated_at,
       greatest(t.updated_at, a.updated_at, coalesce(t.deleted_at, a.deleted_at, t.updated_at),
                case when a.done_at + make_interval(days => me.days) < now() then a.done_at + make_interval(days => me.days) end) as deleted_at,
       false, null::numeric, null::text, null::timestamptz, null::timestamptz, null::uuid,
       '{}'::text[], '{}'::text[], 0::smallint, null::date, null::timestamptz, null::uuid, null::timestamptz
from public.worker_tasks t cross join me
join public.task_assignees a on a.task_id = t.id and a.worker_id = me.wid
where not me.partner and me.wid is not null and not (t.id = any(me.vis));
revoke all on public.worker_tasks_v from public, anon, authenticated;
grant select on public.worker_tasks_v to authenticated;
