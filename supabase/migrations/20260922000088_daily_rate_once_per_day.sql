-- Napi díjas munkavállaló: egy napra EGY napi díj jár, akárhány feladaton / helyszínen dolgozott
-- (2026-09-22, Daniel kérése). Eddig helyszínenként képződött egy-egy napi díj.
-- Megoldás: a nap első (legkorábban kezdett) helyszínének sora viszi a napi díjat, a többi helyszín
-- automatikus sora 0 szorzóval csak a kiszállási díjat (ha jár). A kifizetett sorokhoz nem nyúlunk.

alter table public.attendance drop constraint if exists attendance_day_multiplier_check;
alter table public.attendance add constraint attendance_day_multiplier_check check (day_multiplier >= 0);

-- 1) a bérszámolóban: napi díjnál csak a nap első helyszíne kap szorzót
do $mig$
declare d text := pg_get_functiondef('public.fn_recalc_session_wage'::regproc);
  v_old1 text := E'  v_basis := public.fn_worker_auto_basis(p_worker);\n';
  v_new1 text := E'  v_basis := public.fn_worker_auto_basis(p_worker);\n'
    || E'  -- napi díj: egy napra egy — a legkorábban kezdett helyszín sora viszi, a többi 0 szorzóval csak a kiszállást\n'
    || E'  v_mult := 1;\n'
    || E'  if v_basis = ''daily'' then\n'
    || E'    select s.site_id into v_first_site from public.work_sessions s\n'
    || E'    left join public.worker_tasks t on t.id = s.task_id\n'
    || E'    where s.worker_id = p_worker and s.deleted_at is null and s.ended_at is not null and s.site_id is not null\n'
    || E'      and (s.started_at at time zone ''Europe/Budapest'')::date = p_date\n'
    || E'      and (t.id is null or t.quote_accepted_at is null)\n'
    || E'      and not exists (select 1 from public.attendance m where m.worker_id = p_worker and m.site_id = s.site_id\n'
    || E'                      and m.work_date = p_date and m.source = ''manual'' and m.deleted_at is null)\n'
    || E'    order by s.started_at limit 1;\n'
    || E'    if v_first_site is not null and v_first_site <> p_site then v_mult := 0; end if;\n'
    || E'  end if;\n';
  v_old2 text := E'    || case when v_fee > 0 then '' + kiszállási díj '' || replace(trim(to_char(v_fee, ''FM999,999,999'')), '','', '' '') || '' Ft'' else '''' end;';
  v_new2 text := E'    || case when v_fee > 0 then '' + kiszállási díj '' || replace(trim(to_char(v_fee, ''FM999,999,999'')), '','', '' '') || '' Ft'' else '''' end\n'
    || E'    || case when v_mult = 0 then '' · a napi díj a nap első helyszínén van elszámolva'' else '''' end;';
  v_old3 text := E'          day_multiplier = 1,\n';
  v_new3 text := E'          day_multiplier = v_mult,\n';
  v_old4 text := E'            1, null, ''session'', v_task, v_fee, v_note);';
  v_new4 text := E'            v_mult, null, ''session'', v_task, v_fee, v_note);';
  v_decl_old text := E'  v_note text;\n';
  v_decl_new text := E'  v_note text;\n  v_mult numeric := 1;\n  v_first_site uuid;\n';
begin
  if position('v_first_site' in d) > 0 then return; end if;
  if position(v_old1 in d) = 0 or position(v_old2 in d) = 0 or position(v_old3 in d) = 0 or position(v_old4 in d) = 0 or position(v_decl_old in d) = 0 then
    raise exception 'fn_recalc_session_wage: a várt szövegrész nem található';
  end if;
  d := replace(d, v_decl_old, v_decl_new);
  d := replace(d, v_old1, v_new1);
  d := replace(d, v_old2, v_new2);
  d := replace(d, v_old3, v_new3);
  d := replace(d, v_old4, v_new4);
  execute d;
end $mig$;

-- 2) a trigger a nap ÖSSZES helyszínét újraszámolja (az „első helyszín” a többitől is függ)
create or replace function public.fn_ws_wage_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_w uuid; v_d date; r record;
begin
  v_w := coalesce(new.worker_id, old.worker_id);
  v_d := (coalesce(new.started_at, old.started_at) at time zone 'Europe/Budapest')::date;
  if tg_op = 'UPDATE' and (old.worker_id <> new.worker_id or (old.started_at at time zone 'Europe/Budapest')::date <> v_d) then
    perform public.fn_recalc_session_wage(old.worker_id, old.site_id, (old.started_at at time zone 'Europe/Budapest')::date);
  end if;
  for r in
    select distinct site_id from public.work_sessions s
    where s.worker_id = v_w and s.site_id is not null and (s.started_at at time zone 'Europe/Budapest')::date = v_d
    union select coalesce(new.site_id, old.site_id) where coalesce(new.site_id, old.site_id) is not null
  loop
    perform public.fn_recalc_session_wage(v_w, r.site_id, v_d);
  end loop;
  return coalesce(new, old);
end $$;
revoke execute on function public.fn_ws_wage_trigger() from public, anon, authenticated;

-- 3) a kifizetetlen, több helyszínes napi díjas napok újraszámolása
do $$
declare r record;
begin
  for r in
    select a.worker_id, a.work_date from public.attendance a
    where a.deleted_at is null and a.source = 'session' and a.pay_basis = 'daily'
    group by a.worker_id, a.work_date having count(*) > 1 and bool_and(a.paid_at is null)
  loop
    perform public.fn_recalc_session_wage(r.worker_id, s.site_id, r.work_date)
    from (select distinct site_id from public.work_sessions
          where worker_id = r.worker_id and deleted_at is null and site_id is not null
            and (started_at at time zone 'Europe/Budapest')::date = r.work_date) s;
  end loop;
end $$;
