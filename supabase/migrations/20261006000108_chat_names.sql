-- Chat: nevek (2026-10-06, Daniel: „olyan nevek is látszanak a chatben, akik már nincsenek a munkavállalók
-- között”). (1) A profilok nézete jelzi, ki aktív: vezető, vagy olyan munkavállaló, akinek a törzsadata
-- él és jóvá van hagyva — a megemlítés-ajánló csak őket kínálja. (2) A munkavállaló eddig csak a saját és a
-- vezetők profilját látta, így a chatben a többi munkavállaló neve nem jelent meg neki, és meg sem tudta
-- említeni őket: mostantól az aktív munkavállalók profilját (név, azonosító) is látja — az érzékeny mezők
-- (e-mail, részesedés, értesítési beállítások) továbbra is csak a sajátnál / vezetőnek látszanak.
-- (3) Az üzenet a szerző nevét pillanatképként is őrzi (fiók törlése után is olvasható marad, ki írta).

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
       -- aktív: vezető, vagy élő és jóváhagyott munkavállaló (a megemlítés-ajánló csak őket kínálja)
       (p.worker_id is null or exists (select 1 from public.workers w where w.id = p.worker_id and w.deleted_at is null and w.approved_at is not null)) as active
from public.profiles p
where auth.uid() is not null
  and (p.id = auth.uid() or p.worker_id is null or public.fn_is_partner()
       or exists (select 1 from public.workers w where w.id = p.worker_id and w.deleted_at is null and w.approved_at is not null));
revoke all on public.profiles_v from public, anon;
grant select on public.profiles_v to authenticated;

alter table public.chat_messages add column if not exists author_name text;
create or replace function public.fn_chat_message_author()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select p.display_name into new.author_name from public.profiles p where p.id = new.created_by;
  return new;
end $$;
revoke all on function public.fn_chat_message_author() from public, anon, authenticated;
drop trigger if exists trg_chat_message_author on public.chat_messages;
create trigger trg_chat_message_author before insert on public.chat_messages
  for each row execute function public.fn_chat_message_author();
update public.chat_messages m set author_name = p.display_name from public.profiles p where p.id = m.created_by and m.author_name is null;
