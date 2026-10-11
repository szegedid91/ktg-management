-- Kiosztás beszúrása meglévő (levett) kiosztásra (2026-10-11, hibanapló: „duplicate key value violates unique
-- constraint task_assignees_task_id_worker_id_key”). Ha egy munkavállalót újra ráosztanak egy feladatra,
-- amelyről korábban levették, a régi sor marad és visszaáll (törlés-jelzés és a korábbi elfogadás / kész
-- jelölés törlődik) — az új sor beszúrása nem hiba többé, hanem visszaállítás.
create or replace function public.fn_task_assignee_insert_restore()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old public.task_assignees%rowtype;
begin
  select * into v_old from public.task_assignees where task_id = new.task_id and worker_id = new.worker_id;
  if v_old.id is null then return new; end if;
  if v_old.deleted_at is not null then
    update public.task_assignees
    set deleted_at = null, acknowledged_at = new.acknowledged_at, done_at = null
    where id = v_old.id;
  end if;
  -- élő kiosztás már van: a beszúrás csendben kimarad (nincs duplikátum)
  return null;
end $$;
revoke all on function public.fn_task_assignee_insert_restore() from public, anon, authenticated;
drop trigger if exists trg_task_assignee_insert_restore on public.task_assignees;
create trigger trg_task_assignee_insert_restore before insert on public.task_assignees
  for each row execute function public.fn_task_assignee_insert_restore();
