-- Utólag kiosztott feladat nem jutott el a munkavállaló készülékére (2026-10-05, Daniel: „van amit megkap,
-- van amit nem”). A készülék növekményesen húzza le a feladatokat (updated_at szerint). Ha a vezető (vagy a
-- vállalkozó) egy RÉGEBBI feladatra tesz rá valakit, csak a kiosztás sora új — maga a feladat sora nem
-- változik, így a készülék kurzora már túl van rajta, és a feladat nem érkezik meg (az értesítés igen).
-- Javítás: a munkavállalói nézetben a feladat időbélyege a saját kiosztásom változását is követi —
-- kiosztás, visszarakás, elfogadás, készre jelentés után a feladat sora biztosan újra lejön.
create or replace view public.worker_tasks_v
with (security_barrier = true, security_invoker = false) as
with me as (select public.fn_is_partner() as partner, public.fn_my_worker_id() as wid, public.fn_my_visible_task_ids() as vis,
                   (select worker_done_visible_days from public.app_settings where id = 1) as days)
select t.id, t.worker_id, t.site_id, t.code, t.title, t.details, t.status, t.acknowledged_at, t.done_at,
       t.fail_reason, t.fail_photo_path, t.created_by, t.created_at,
       case when me.partner then t.updated_at else greatest(t.updated_at, mine.updated_at) end as updated_at, t.deleted_at,
       t.quote_requested,
       case when me.partner then t.quote_amount end as quote_amount,
       case when me.partner then t.quote_note end as quote_note,
       case when me.partner then t.quote_submitted_at end as quote_submitted_at,
       t.quote_accepted_at,
       case when me.partner then t.quote_accepted_by end as quote_accepted_by,
       t.photo_paths, t.fail_photo_paths, t.priority, t.due_date, t.overdue_notified_at,
       t.item_code_id, t.closed_at
from public.worker_tasks t cross join me
left join public.task_assignees mine on not me.partner and mine.task_id = t.id and mine.worker_id = me.wid
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
