-- Chat megemlíthetőség (2026-10-07, Daniel): az admin fiók ne legyen megemlíthető; munkavállalónként
-- beállítható, hogy megemlíthető-e (alapértelmezetten igen). A jelzők a nézetekben jönnek le a kliensnek.

alter table public.workers add column if not exists chat_mentionable boolean not null default true;

-- a munkavállalók nézete is adja (nem érzékeny, mindenki látja, aki a munkavállalót látja)
do $$
declare d text := pg_get_viewdef('public.workers_v'::regclass, true);
begin
  if position('chat_mentionable' in d) = 0 then
    d := regexp_replace(d, E'\\s+FROM workers w', E',\n    w.chat_mentionable\n   FROM workers w');
    execute 'create or replace view public.workers_v with (security_barrier = true, security_invoker = false) as ' || d;
  end if;
end $$;

-- profilok: megemlíthető = vezető (de nem admin), vagy élő, jóváhagyott, megemlíthetőre állított munkavállaló
create or replace view public.profiles_v
with (security_barrier = true, security_invoker = false) as
select p.id,
       p.display_name,
       case when p.id = auth.uid() or public.fn_is_partner() then p.email end as email,
       case when public.fn_is_partner() then p.is_admin else false end as is_admin,
       p.worker_id,
       case when p.id = auth.uid() or public.fn_is_partner() then p.profit_share_percent else 0::numeric end as profit_share_percent,
       case when p.id = auth.uid() then p.push_token end as push_token,
       case when p.id = auth.uid() or public.fn_is_partner() then p.notify_comments else false end as notify_comments,
       case when p.id = auth.uid() or public.fn_is_partner() then p.notify_big_expense else false end as notify_big_expense,
       case when p.id = auth.uid() or public.fn_is_partner() then p.big_expense_threshold else 0::numeric end as big_expense_threshold,
       case when p.id = auth.uid() or public.fn_is_partner() then p.notify_weekly else false end as notify_weekly,
       case when p.id = auth.uid() or public.fn_is_partner() then p.notify_overdue else false end as notify_overdue,
       case when p.id = auth.uid() or public.fn_is_partner() then p.overdue_days else 0 end as overdue_days,
       p.created_at,
       p.updated_at,
       (p.worker_id is null or exists (select 1 from public.workers w where w.id = p.worker_id and w.deleted_at is null and w.approved_at is not null)) as active,
       (case when p.worker_id is null then not coalesce(p.is_admin, false)
             else exists (select 1 from public.workers w where w.id = p.worker_id and w.deleted_at is null and w.approved_at is not null and w.chat_mentionable) end) as mentionable
from public.profiles p
where auth.uid() is not null
  and (p.id = auth.uid() or p.worker_id is null or public.fn_is_partner()
       or exists (select 1 from public.workers w where w.id = p.worker_id and w.deleted_at is null and w.approved_at is not null));
revoke all on public.profiles_v from public, anon;
grant select on public.profiles_v to authenticated;
