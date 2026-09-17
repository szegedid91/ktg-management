-- Több főre kiosztott feladatnál a munkavállaló látja, ki van még rá
-- kiosztva: a társ-kiosztások sorai (task_assignees) és a társak alapadatai
-- (név, szakma, telefon) láthatók; a díjazás, becenév, e-mail, cégadatok NEM.
-- A kliens a workers_v nézetből szinkronizál (mint a profiles_v-nél).

create or replace function public.fn_my_task_ids()
returns uuid[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(distinct a.task_id), '{}'::uuid[])
  from public.task_assignees a
  where a.deleted_at is null and a.worker_id = any(public.fn_my_worker_ids());
$$;
create or replace function public.fn_my_coworker_ids()
returns uuid[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(distinct a.worker_id), '{}'::uuid[])
  from public.task_assignees a
  where a.deleted_at is null and a.task_id = any(public.fn_my_task_ids());
$$;
revoke execute on function public.fn_my_task_ids(), public.fn_my_coworker_ids() from public, anon;
grant execute on function public.fn_my_task_ids(), public.fn_my_coworker_ids() to authenticated;

drop policy if exists ta_select on public.task_assignees;
create policy ta_select on public.task_assignees for select to authenticated
  using (public.fn_is_partner() or worker_id = public.fn_my_worker_id() or task_id = any(public.fn_my_task_ids()));

create or replace view public.workers_v with (security_barrier = true) as
  with me as (
    select public.fn_is_partner() as partner, public.fn_my_worker_ids() as mine,
           public.fn_my_contractor_id() as boss, public.fn_my_coworker_ids() as co
  )
  select w.id, w.name,
         w.phones,
         case when f.full then w.email end as email,
         case when f.full then w.company_name end as company_name,
         case when f.full then w.tax_number end as tax_number,
         case when f.full then w.hq_address end as hq_address,
         null::text as bank_account_enc,
         case when f.full then w.note end as note,
         w.worker_type,
         case when f.full then w.is_vat_payer else false end as is_vat_payer,
         case when f.full then w.vat_rate else 0 end as vat_rate,
         case when f.full then w.default_pay_basis end as default_pay_basis,
         case when f.full then w.hourly_rate end as hourly_rate,
         case when f.full then w.daily_rate end as daily_rate,
         case when f.full then w.project_rate end as project_rate,
         case when f.full then w.referrer_user_id end as referrer_user_id,
         case when f.full then w.referrer_external_id end as referrer_external_id,
         case when f.full then w.commission_mode end as commission_mode,
         case when f.full then w.commission_value end as commission_value,
         case when f.full then w.commission_unit end as commission_unit,
         w.created_by, w.created_at, w.updated_at, w.deleted_at,
         w.trade,
         case when f.full then w.nickname end as nickname,
         w.approved_at,
         case when f.full then w.approved_by end as approved_by,
         w.is_contractor, w.contractor_id
  from public.workers w
  cross join me
  cross join lateral (select (me.partner or w.id = any(me.mine) or w.id = me.boss) as full) f
  where f.full or w.id = any(me.co);
alter view public.workers_v set (security_invoker = false);
revoke all on public.workers_v from public, anon;
grant select on public.workers_v to authenticated;
