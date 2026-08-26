-- Kifizetési megjegyzés: a bér- és közvetítőidíj-kifizetéshez opcionális
-- megjegyzés rögzíthető (pl. "készpénzben, előleggel együtt").
-- Az RPC-k új, opcionális p_note paramétert kapnak — a régi 2 paraméteres
-- változatot el kell dobni, különben kétértelmű lenne a hívás.

alter table public.attendance add column if not exists paid_note text;
alter table public.attendance add column if not exists commission_paid_note text;

drop function if exists public.mark_attendance_paid(uuid[], boolean);
create function public.mark_attendance_paid(p_ids uuid[], p_paid boolean, p_note text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Bejelentkezés szükséges.'; end if;
  perform set_config('app.allow_paid_tick', 'on', true);
  update public.attendance
     set paid_at = case when p_paid then now() end,
         paid_by = case when p_paid then auth.uid() end,
         paid_note = case when p_paid then nullif(trim(coalesce(p_note, '')), '') end
   where id = any(p_ids) and deleted_at is null;
end;
$$;

drop function if exists public.mark_commission_paid(uuid[], boolean);
create function public.mark_commission_paid(p_ids uuid[], p_paid boolean, p_note text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Bejelentkezés szükséges.'; end if;
  perform set_config('app.allow_paid_tick', 'on', true);
  update public.attendance
     set commission_paid_at = case when p_paid then now() end,
         commission_paid_by = case when p_paid then auth.uid() end,
         commission_paid_note = case when p_paid then nullif(trim(coalesce(p_note, '')), '') end
   where id = any(p_ids) and deleted_at is null and referrer_external_id is not null;
end;
$$;
