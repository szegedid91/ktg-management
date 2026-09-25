-- Kifizetés visszavonása után újraszámolás (2026-09-25): a kifizetett nap bére szándékosan
-- befagy (a munkaidő utólagos módosítása nem változtatja). Ha a vezető visszavonja a kifizetést,
-- a munkaidőből képzett nap innentől az AKTUÁLIS munkamenetek alapján számolódik újra.
create or replace function public.fn_attendance_unpaid_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.paid_at is not null and new.paid_at is null and new.source = 'session' and new.deleted_at is null then
    perform public.fn_recalc_session_wage(new.worker_id, new.site_id, new.work_date);
  end if;
  return null;
end $$;
revoke all on function public.fn_attendance_unpaid_recalc() from public, anon, authenticated;
drop trigger if exists trg_attendance_unpaid_recalc on public.attendance;
create trigger trg_attendance_unpaid_recalc after update of paid_at on public.attendance
  for each row execute function public.fn_attendance_unpaid_recalc();
