-- Kiszállási díj és közvetítő (2026-09-25, Daniel kérése): munkavállalónként állítható,
-- hogy a közvetítő a kiszállási díjból is részesül-e (workers.callout_commission).
-- Alapértelmezés: igen (eddigi működés — a kiszállás 1 órának számít). Ha nem: a százalékos
-- jutalék csak az alapbér után jár, az óránkénti fix díj nem kap +1 órát.
-- A vállalkozó embereinél a vállalkozó beállítása érvényes (mint a többi jutalék-adat).

alter table public.workers add column if not exists callout_commission boolean not null default true;

do $$
declare v_def text;
  v_old1 text := 'round((v_base + new.callout_fee) * coalesce(w.commission_value, 0) / 100.0, 2)';
  v_new1 text := 'round((v_base + case when w.callout_commission then new.callout_fee else 0 end) * coalesce(w.commission_value, 0) / 100.0, 2)';
  v_old2 text := '(coalesce(new.hours, 0) + case when new.callout_fee > 0 then 1 else 0 end)';
  v_new2 text := '(coalesce(new.hours, 0) + case when w.callout_commission and new.callout_fee > 0 then 1 else 0 end)';
  v_old3 text := E'    w.commission_unit := c.commission_unit;\n';
  v_new3 text := E'    w.commission_unit := c.commission_unit;\n    w.callout_commission := c.callout_commission;\n';
begin
  v_def := pg_get_functiondef('public.fn_attendance_compute()'::regprocedure);
  if position(v_old1 in v_def) = 0 or position(v_old2 in v_def) = 0 or position(v_old3 in v_def) = 0 then
    raise exception 'fn_attendance_compute: a várt szövegrész nem található';
  end if;
  v_def := replace(replace(replace(v_def, v_old1, v_new1), v_old2, v_new2), v_old3, v_new3);
  execute v_def;
end $$;

-- a maszkoló nézet is adja (csak vezetőnek, mint a többi díj-adatot)
do $$
declare d text := pg_get_viewdef('public.workers_v'::regclass, true);
begin
  if position('callout_commission' in d) = 0 then
    d := regexp_replace(d, E'\\s+FROM workers w', E',\n        CASE WHEN me.partner THEN w.callout_commission ELSE NULL::boolean END AS callout_commission\n   FROM workers w');
    execute 'create or replace view public.workers_v with (security_barrier = true, security_invoker = false) as ' || d;
  end if;
end $$;

-- a kapcsoló váltásakor a ki nem fizetett napok újraszámolódnak
create or replace function public.fn_workers_rate_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.callout_fee is distinct from old.callout_fee
     or new.hourly_rate is distinct from old.hourly_rate
     or new.daily_rate is distinct from old.daily_rate
     or new.project_rate is distinct from old.project_rate
     or new.default_pay_basis is distinct from old.default_pay_basis
     or new.worker_type is distinct from old.worker_type
     or new.commission_mode is distinct from old.commission_mode
     or new.commission_value is distinct from old.commission_value
     or new.commission_unit is distinct from old.commission_unit
     or new.callout_commission is distinct from old.callout_commission then
    perform public.fn_recalc_worker_unpaid(new.id);
  end if;
  return null;
end $$;
