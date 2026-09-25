-- A vezető által rögzített munkaidő mindig érvényes (2026-09-25, Daniel kérése): a kifizetett
-- nap bére is újraszámolódik, ha a munkaidőt utólag módosítják. Hogy a különbözet ne vesszen
-- el, a kifizetéskor pillanatképet mentünk (paid_amount = a munkavállalónak kifizetett rész);
-- a túlfizetés / hiány = paid_amount − aktuális (amount − commission_amount).

alter table public.attendance add column if not exists paid_amount numeric(14,2);

create or replace function public.fn_attendance_paid_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.paid_at is not null and old.paid_at is null then
    new.paid_amount := new.amount - coalesce(new.commission_amount, 0);
  elsif new.paid_at is null and old.paid_at is not null then
    new.paid_amount := null;
  end if;
  return new;
end $$;
revoke all on function public.fn_attendance_paid_snapshot() from public, anon, authenticated;
drop trigger if exists trg_attendance_paid_snapshot on public.attendance;
create trigger trg_attendance_paid_snapshot before update of paid_at on public.attendance
  for each row execute function public.fn_attendance_paid_snapshot();

-- meglévő kifizetett sorok: a pillanatkép a mostani érték (ismert eltéréseket külön rögzítünk)
update public.attendance set paid_amount = amount - coalesce(commission_amount, 0) where paid_at is not null and paid_amount is null;

-- újraszámolás kifizetett napon is; ha a nap összes menete törlődött, a kifizetett sor marad 0 órával
do $$
declare v_def text;
  v_old1 text := E'    if v_row.paid_at is not null then return; end if;\n';
  v_old2 text := E'    if v_row.id is not null and v_row.paid_at is null then\n      begin\n        update public.attendance set deleted_at = now() where id = v_row.id;';
  v_new2 text := E'    if v_row.id is not null and v_row.paid_at is not null then\n      begin\n        update public.attendance set hours = case when pay_basis = ''hourly'' then 0 else hours end, day_multiplier = 0,\n          note = ''munkaidő alapján (automatikus) · a nap munkamenetei törölve — a kifizetett összeg túlfizetés'' where id = v_row.id;\n      exception when others then raise notice ''session wage zero skipped: %'', sqlerrm; end;\n    elsif v_row.id is not null then\n      begin\n        update public.attendance set deleted_at = now() where id = v_row.id;';
begin
  v_def := pg_get_functiondef('public.fn_recalc_session_wage(uuid,uuid,date)'::regprocedure);
  if position(v_old1 in v_def) = 0 or position(v_old2 in v_def) = 0 then raise exception 'fn_recalc_session_wage: a várt szövegrész nem található'; end if;
  execute replace(replace(v_def, v_old1, ''), v_old2, v_new2);
end $$;

-- a maszkoló nézet: a pillanatkép is csak vezetőnek
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
       a.source, case when me.partner then a.task_id end as task_id,
       case when me.partner then a.callout_fee else 0 end as callout_fee,
       case when me.partner then a.paid_amount end as paid_amount
from public.attendance a cross join me
where me.partner or a.worker_id = any(me.mine);
revoke all on public.attendance_v from public, anon, authenticated;
grant select on public.attendance_v to authenticated;
