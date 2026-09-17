-- Óralap-beküldés megszűnt (2026-09-18, Daniel kérése): a munkavállalónak
-- nem kell beküldenie a hetét — a bér a munkaidőből automatikusan képződik,
-- a heti/havi nézet csak áttekintés. A kliens már nem hív submit_timesheet-et,
-- a vasárnapi „küldd be az óralapod” emlékeztető megszűnik.
revoke execute on function public.submit_timesheet(date, text, uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'remind-timesheets';
  end if;
end $$;
