-- A munkavállalói fiók telefonjára semmilyen pénzadat ne menjen le (2026-09-21, Daniel kérése):
--  * jelenléti napok: maszkoló nézet (attendance_v) — a munkavállaló csak dátumot, helyszínt,
--    órát, napot lát; az összegek, díjak, kifizetés, közvetítő nélkül. Az alap tábla csak vezetőnek olvasható
--    (így a security_invoker kimutatás-nézetek — v_attendance_detail stb. — sem adnak ki neki semmit).
--  * workers_v: díjak, kiszállási díj, közvetítő és jutalék csak vezetőnek; a workers alap tábla csak vezetőnek.
--  * timesheets (összeg oszlop): csak vezetőnek.

-- ---------- jelenlét ----------
create or replace view public.attendance_v
with (security_barrier = true, security_invoker = false) as
with me as (select public.fn_is_partner() as partner, public.fn_my_worker_ids() as mine)
select a.id, a.work_date, a.site_id, a.worker_id, a.created_by, a.pay_basis, a.hours, a.day_multiplier,
       case when me.partner then a.applied_rate end as applied_rate,
       case when me.partner then a.amount else 0 end as amount,
       case when me.partner then a.commission_amount else 0 end as commission_amount,
       case when me.partner then a.referrer_user_id end as referrer_user_id,
       case when me.partner then a.referrer_external_id end as referrer_external_id,
       case when me.partner then a.paid_at end as paid_at,
       case when me.partner then a.paid_by end as paid_by,
       case when me.partner then a.commission_paid_at end as commission_paid_at,
       case when me.partner then a.commission_paid_by end as commission_paid_by,
       case when me.partner then a.note end as note,
       a.created_at, a.updated_at, a.deleted_at,
       case when me.partner then a.paid_note end as paid_note,
       case when me.partner then a.commission_paid_note end as commission_paid_note,
       a.source, a.task_id,
       case when me.partner then a.callout_fee else 0 end as callout_fee
from public.attendance a cross join me
where me.partner or a.worker_id = any(me.mine);
revoke all on public.attendance_v from public, anon, authenticated;
grant select on public.attendance_v to authenticated;

drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated
  using (public.fn_is_partner());

-- a helyszín-láthatóság eddig a munkavállaló saját jelenlétére hivatkozott (RLS alatt) — definer függvénnyel pótoljuk
create or replace function public.fn_my_attendance_site_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x.site_id), '{}'::uuid[])
  from public.attendance x where x.worker_id = public.fn_my_worker_id();
$$;
revoke execute on function public.fn_my_attendance_site_ids() from public, anon;
grant execute on function public.fn_my_attendance_site_ids() to authenticated;

drop policy if exists sites_select on public.sites;
create policy sites_select on public.sites for select to authenticated
  using (public.fn_is_partner() or (deleted_at is null and public.fn_my_worker_id() is not null and (
    status = 'active'
    or exists (select 1 from public.task_assignees a join public.worker_tasks t on t.id = a.task_id
               where a.worker_id = public.fn_my_worker_id() and a.deleted_at is null and t.site_id = sites.id)
    or sites.id = any(public.fn_my_attendance_site_ids())
    or exists (select 1 from public.work_sessions w where w.worker_id = public.fn_my_worker_id() and w.site_id = sites.id))));

-- ---------- munkavállalói díjak ----------
do $mig$
declare
  d text := pg_get_viewdef('public.workers_v'::regclass, true);
  col text;
begin
  foreach col in array array['default_pay_basis', 'hourly_rate', 'daily_rate', 'project_rate', 'referrer_user_id',
                             'referrer_external_id', 'commission_mode', 'commission_value', 'commission_unit',
                             'callout_fee', 'is_vat_payer', 'vat_rate'] loop
    if position('WHEN f."full" THEN w.' || col in d) = 0 and position('WHEN me.partner THEN w.' || col in d) = 0 then
      raise exception 'workers_v: a(z) % oszlop maszkja nem található', col;
    end if;
    d := replace(d, 'WHEN f."full" THEN w.' || col, 'WHEN me.partner THEN w.' || col);
  end loop;
  execute 'create or replace view public.workers_v with (security_barrier = true, security_invoker = false) as ' || d;
end $mig$;

drop policy if exists workers_select on public.workers;
create policy workers_select on public.workers for select to authenticated
  using (public.fn_is_partner());

-- ---------- óralapok (összeg oszlop) ----------
drop policy if exists tsh_select on public.timesheets;
create policy tsh_select on public.timesheets for select to authenticated
  using (public.fn_is_partner());
