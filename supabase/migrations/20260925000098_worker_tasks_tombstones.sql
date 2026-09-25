-- Törölt / levett feladat a munkavállaló készülékén (2026-09-25, Daniel: a dnl4 teszt-fiók törölt
-- feladatokat mutatott). A munkavállalói nézet eddig a törölt vagy róla levett feladatot egyszerűen
-- nem adta vissza, ezért a helyi tükörben ott maradt a régi példány. Mostantól az ilyen feladathoz
-- „törölve” jelzést (tombstone) ad: a tartalom nélkül, deleted_at kitöltve — a kliens elrejti.
create or replace view public.worker_tasks_v
with (security_barrier = true, security_invoker = false) as
with me as (select public.fn_is_partner() as partner, public.fn_my_worker_id() as wid, public.fn_my_active_task_ids() as act)
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
where me.partner or t.id = any(me.act)
union all
-- tombstone: volt kiosztása, de már nem futó / törölt / levett — tartalom nélkül, törölve jelzéssel
select t.id, null::uuid, null::uuid, null::text, ''::text, null::text, 'cancelled'::text, null::timestamptz, null::timestamptz,
       null::text, null::text, t.created_by, t.created_at,
       greatest(t.updated_at, a.updated_at, coalesce(t.deleted_at, a.deleted_at, t.updated_at)) as updated_at,
       greatest(t.updated_at, a.updated_at, coalesce(t.deleted_at, a.deleted_at, t.updated_at)) as deleted_at,
       false, null::numeric, null::text, null::timestamptz, null::timestamptz, null::uuid,
       '{}'::text[], '{}'::text[], 0::smallint, null::date, null::timestamptz, null::uuid, null::timestamptz
from public.worker_tasks t cross join me
join public.task_assignees a on a.task_id = t.id and a.worker_id = me.wid
where not me.partner and me.wid is not null and not (t.id = any(me.act));
revoke all on public.worker_tasks_v from public, anon, authenticated;
grant select on public.worker_tasks_v to authenticated;
