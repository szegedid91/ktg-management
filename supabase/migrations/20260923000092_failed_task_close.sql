-- „Nem sikerült” feladat vezetői lezárása (2026-09-23, Daniel kérése): a nem sikerült
-- feladat addig marad nyitva (a munkavállalónál folytatható, a vezetőnél teendő), amíg
-- vagy készre jelentik, vagy a VEZETŐ lezárja „nem tudták megoldani” döntéssel
-- (worker_tasks.closed_at). Lezárás után a munkavállaló már nem látja, nem folytathatja.

alter table public.worker_tasks add column if not exists closed_at timestamptz;

-- 1) láthatóság: a lezárt nem sikerült feladat a munkavállalónak már nem látszik
drop policy if exists wt_select on public.worker_tasks;
create policy wt_select on public.worker_tasks for select to authenticated
  using (public.fn_is_partner() or (
    (status in ('assigned', 'acknowledged') or (status = 'failed' and closed_at is null))
    and exists (select 1 from public.task_assignees a
                where a.task_id = worker_tasks.id and a.worker_id = public.fn_my_worker_id() and a.deleted_at is null)));

create or replace function public.fn_my_active_task_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct a.task_id), '{}'::uuid[])
  from public.task_assignees a join public.worker_tasks t on t.id = a.task_id
  where a.worker_id = public.fn_my_worker_id() and a.deleted_at is null
    and t.deleted_at is null and (t.status in ('assigned', 'acknowledged') or (t.status = 'failed' and t.closed_at is null));
$$;

-- 2) lezárt nem sikerült feladaton nincs kész / új indok
do $$
declare v_def text; v_old text := 'if v_task.status not in (''assigned'', ''acknowledged'', ''failed'') then';
begin
  v_def := pg_get_functiondef('public.worker_task_action(uuid,text,text,text,numeric,text[])'::regprocedure);
  if position(v_old in v_def) = 0 then raise exception 'worker_task_action: a várt szövegrész nem található'; end if;
  execute replace(v_def, v_old, 'if v_task.status not in (''assigned'', ''acknowledged'', ''failed'') or v_task.closed_at is not null then');
end $$;

-- 3) anyagköltség: lezárt nem sikerült feladaton a munkavállaló már nem módosít
do $$
declare v_def text; v_old text := 't.deleted_at is null and t.status in (''assigned'', ''acknowledged'', ''failed''))';
begin
  v_def := pg_get_functiondef('public.fn_task_material_guard()'::regprocedure);
  if position(v_old in v_def) = 0 then raise exception 'fn_task_material_guard: a várt szövegrész nem található'; end if;
  execute replace(v_def, v_old, 't.deleted_at is null and (t.status in (''assigned'', ''acknowledged'') or (t.status = ''failed'' and t.closed_at is null)))');
end $$;

-- 4) a maszkoló nézet is adja az új oszlopot
create or replace view public.worker_tasks_v
with (security_barrier = true, security_invoker = false) as
with me as (select public.fn_is_partner() as partner, public.fn_my_active_task_ids() as act)
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
where me.partner or t.id = any(me.act);
revoke all on public.worker_tasks_v from public, anon, authenticated;
grant select on public.worker_tasks_v to authenticated;
