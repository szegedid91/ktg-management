-- Elszámolási mód váltása csak előre hat + napi díjasok ledolgozott ideje (2026-11-16, Daniel kérése).
--
-- 1) Ha egy munkavállaló elszámolási módja menet közben változik (órabéres ↔ napi díjas), a KORÁBBI napok a
--    régi mód szerint maradnak, az új számítás csak a váltás napjától érvényes. Eddig a váltás a még ki nem
--    fizetett korábbi napokat is átszámolta. A váltásokat napra pontosan naplózzuk (worker_pay_basis_changes),
--    és a nap bérének számítása az adott napon érvényes módot használja.
-- 2) A napi díjas munkavállalónál is rögzül a ledolgozott idő (attendance.worked_hours — a tényleges, nem
--    felkerekített óraszám). A bért ez NEM befolyásolja: a pénzügyben a tétel továbbra is „napi díjas”,
--    az idő csak tájékoztatás (melyik napon / feladaton mennyit dolgozott).

-- ---------- 1) a váltások naplója ----------
create table if not exists public.worker_pay_basis_changes (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  changed_on date not null,              -- ettől a naptól (Europe/Budapest) érvényes az új mód
  old_basis text,
  new_basis text,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now(),
  unique (worker_id, changed_on)
);
alter table public.worker_pay_basis_changes enable row level security;
revoke all on public.worker_pay_basis_changes from public, anon, authenticated;
grant select on public.worker_pay_basis_changes to authenticated;
drop policy if exists wpbc_select on public.worker_pay_basis_changes;
create policy wpbc_select on public.worker_pay_basis_changes for select to authenticated using (public.fn_is_partner());

create or replace function public.fn_workers_basis_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_day date := (now() at time zone 'Europe/Budapest')::date; r public.worker_pay_basis_changes%rowtype;
begin
  if new.default_pay_basis is distinct from old.default_pay_basis then
    select * into r from public.worker_pay_basis_changes where worker_id = new.id and changed_on = v_day;
    if found then
      if r.old_basis is not distinct from new.default_pay_basis then
        -- ugyanaznap visszaállították: nincs váltás
        delete from public.worker_pay_basis_changes where id = r.id;
      else
        update public.worker_pay_basis_changes set new_basis = new.default_pay_basis, changed_at = now(), changed_by = auth.uid() where id = r.id;
      end if;
    else
      insert into public.worker_pay_basis_changes (worker_id, changed_on, old_basis, new_basis)
      values (new.id, v_day, old.default_pay_basis, new.default_pay_basis);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.fn_workers_basis_history() from public, anon, authenticated;
-- BEFORE: a napló már megvan, mire a díjváltozás-trigger (AFTER) újraszámolja a ki nem fizetett napokat
drop trigger if exists trg_workers_basis_history on public.workers;
create trigger trg_workers_basis_history before update of default_pay_basis on public.workers
  for each row execute function public.fn_workers_basis_history();

-- az adott NAPON érvényes elszámolási mód: ha a nap után volt váltás, a legkorábbi ilyen váltás ELŐTTI mód;
-- különben a mostani. A díj-alapú tartalék-szabály ugyanaz, mint a fn_worker_auto_basis-ban.
create or replace function public.fn_worker_auto_basis_at(p_worker uuid, p_date date)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  w public.workers%rowtype;
  s public.app_settings%rowtype;
  v_h numeric; v_d numeric;
  v_raw text; v_pref text; v_old text;
begin
  select * into w from public.workers where id = p_worker;
  select * into s from public.app_settings where id = 1;
  v_raw := w.default_pay_basis;
  select c.old_basis into v_old from public.worker_pay_basis_changes c
   where c.worker_id = p_worker and c.changed_on > p_date order by c.changed_on limit 1;
  if found then v_raw := v_old; end if;
  v_h := coalesce(w.hourly_rate, case when w.worker_type = 'company' then s.company_hourly_rate else s.individual_hourly_rate end, 0);
  v_d := coalesce(w.daily_rate, case when w.worker_type = 'company' then s.company_daily_rate else s.individual_daily_rate end, 0);
  v_pref := case when v_raw = 'project' then 'daily' else v_raw end;
  if v_pref = 'hourly' and v_h > 0 then return 'hourly'; end if;
  if v_pref = 'daily' and v_d > 0 then return 'daily'; end if;
  if v_h > 0 then return 'hourly'; end if;
  if v_d > 0 then return 'daily'; end if;
  return coalesce(v_pref, 'hourly');
end $$;
revoke all on function public.fn_worker_auto_basis_at(uuid, date) from public, anon, authenticated;

-- ---------- 2) ledolgozott idő a bér-soron ----------
alter table public.attendance add column if not exists worked_hours numeric(5,2);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_worked_hours_check') then
    alter table public.attendance add constraint attendance_worked_hours_check check (worked_hours is null or worked_hours >= 0);
  end if;
end $$;
-- a tábla oszloponként van kiadva: az új oszlopot csak a szerver írja, a kliens olvassa
grant select (worked_hours) on public.attendance to authenticated;

-- a nap bérének számítása: az adott napon érvényes mód + a tényleges idő rögzítése
do $$
declare src text; n0 integer;
  procedure_missing constant text := 'fn_recalc_session_wage: a várt kódrészlet nem található — ';
begin
  select pg_get_functiondef('public.fn_recalc_session_wage'::regproc) into src;
  if position('v_actual' in src) > 0 then return; end if; -- már alkalmazva

  n0 := length(src);
  src := replace(src, E'  v_first_site uuid;\n', E'  v_first_site uuid;\n  v_actual numeric := 0;\n');
  if length(src) = n0 then raise exception '%', procedure_missing || 'deklaráció'; end if;

  n0 := length(src);
  src := replace(src, 'v_hours := least(ceil(round(v_hours, 4)), 16);',
    E'v_actual := least(round(v_hours, 2), 24); -- tényleges (nem felkerekített) idő\n  v_hours := least(ceil(round(v_hours, 4)), 16);');
  if length(src) = n0 then raise exception '%', procedure_missing || 'óraszám'; end if;

  n0 := length(src);
  src := replace(src, 'v_basis := public.fn_worker_auto_basis(p_worker);', 'v_basis := public.fn_worker_auto_basis_at(p_worker, p_date);');
  if length(src) = n0 then raise exception '%', procedure_missing || 'elszámolási mód'; end if;

  n0 := length(src);
  src := replace(src, E'day_multiplier = v_mult,\n        callout_fee = v_fee,', E'day_multiplier = v_mult,\n        worked_hours = v_actual,\n        callout_fee = v_fee,');
  if length(src) = n0 then raise exception '%', procedure_missing || 'frissítés'; end if;

  n0 := length(src);
  src := replace(src, 'applied_rate, source, task_id, callout_fee, note)', 'applied_rate, source, task_id, callout_fee, note, worked_hours)');
  src := replace(src, E'v_mult, null, \'session\', v_task, v_fee, v_note);', E'v_mult, null, \'session\', v_task, v_fee, v_note, v_actual);');
  if length(src) < n0 + 20 then raise exception '%', procedure_missing || 'beszúrás'; end if;

  n0 := length(src);
  src := replace(src, E'set hours = case when v_basis = \'hourly\' then v_hours else null end, day_multiplier = v_mult,\n',
    E'set hours = case when v_basis = \'hourly\' then v_hours else null end, day_multiplier = v_mult, worked_hours = v_actual,\n');
  if length(src) = n0 then raise exception '%', procedure_missing || 'versenyhelyzet-ág'; end if;

  n0 := length(src);
  src := replace(src, E'to_char(v_hours, \'FM990\') || \' óra (megkezdett órák)\'',
    E'case when v_basis = \'daily\' then \'napi díjas · \' || replace(trim(to_char(v_actual, \'FM990.00\')), \'.\', \',\') || \' óra munkaidő\' else to_char(v_hours, \'FM990\') || \' óra (megkezdett órák)\' end');
  if length(src) = n0 then raise exception '%', procedure_missing || 'megjegyzés'; end if;

  execute src;
end $$;

-- a munkavállalói / vezetői nézet is adja ki az új oszlopot (a többi oszlop és a jogosultsági szűrés változatlan)
do $$
declare v text;
begin
  select pg_get_viewdef('public.attendance_v'::regclass) into v;
  if position('worked_hours' in v) > 0 then return; end if;
  if position('END AS paid_amount' in v) = 0 then raise exception 'attendance_v: a várt oszlop nem található'; end if;
  v := replace(v, 'END AS paid_amount', E'END AS paid_amount,\n    a.worked_hours');
  execute 'create or replace view public.attendance_v with (security_barrier = true, security_invoker = false) as ' || v;
end $$;
revoke all on public.attendance_v from public, anon, authenticated;
grant select on public.attendance_v to authenticated;

-- a még ki nem fizetett napi díjas napok ledolgozott idejének pótlása (a szokásos újraszámolással;
-- a kifizetett napokhoz nem nyúlunk — azoknál a ledolgozott idő üres marad)
do $$
declare r record;
begin
  for r in select distinct a.worker_id, a.site_id, a.work_date from public.attendance a
            where a.source = 'session' and a.pay_basis = 'daily' and a.paid_at is null and a.deleted_at is null and a.worked_hours is null
  loop
    perform public.fn_recalc_session_wage(r.worker_id, r.site_id, r.work_date);
  end loop;
end $$;
