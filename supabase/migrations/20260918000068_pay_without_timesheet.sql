-- Kifizetés óralap-jóváhagyás nélkül (2026-09-18, Daniel kérése):
-- a fő felhasználó a Kifizetetlen bérek oldalon akkor is kifizetettre
-- állíthat egy tételt, ha a munkavállaló hetének óralapja még nincs
-- jóváhagyva. (A kifizetett sort a bér-újraszámolás nem módosítja.)
create or replace function public.mark_attendance_paid(p_ids uuid[], p_paid boolean, p_note text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or not public.fn_is_partner() then raise exception 'Csak fő felhasználó jelölhet kifizetést.'; end if;
  perform set_config('app.allow_paid_tick', 'on', true);
  update public.attendance
     set paid_at = case when p_paid then now() end,
         paid_by = case when p_paid then auth.uid() end,
         paid_note = case when p_paid then nullif(trim(coalesce(p_note, '')), '') end
   where id = any(p_ids) and deleted_at is null;
end $$;
revoke all on function public.mark_attendance_paid(uuid[], boolean, text) from public, anon;
grant execute on function public.mark_attendance_paid(uuid[], boolean, text) to authenticated;
