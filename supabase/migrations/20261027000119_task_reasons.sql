-- Indoklás a feladatoknál (2026-10-27, Daniel kérése): a munkavállaló beírhatja, miért került annyiba egy
-- anyagköltség (task_materials.reason), és készre jelentéskor azt, miért tartott annyi ideig a feladat
-- (task_assignees.done_note — emberenként, mert több emberes feladatnál mindenki a saját részét jelenti).
-- Mindkettő nem kötelező. A vezető a feladat oldalán és az értesítésben látja.

alter table public.task_materials add column if not exists reason text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'task_materials_reason_len') then
    alter table public.task_materials add constraint task_materials_reason_len check (reason is null or char_length(reason) <= 500);
  end if;
end $$;
-- a tábla oszloponként van kiadva: az új oszlopot a munkavállaló írja (saját sor), mindenki olvassa
grant select (reason), insert (reason), update (reason) on public.task_materials to authenticated;

alter table public.task_assignees add column if not exists done_note text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'task_assignees_done_note_len') then
    alter table public.task_assignees add constraint task_assignees_done_note_len check (done_note is null or char_length(done_note) <= 1000);
  end if;
end $$;
-- a munkavállaló a worker_task_action-ön át írja (a kiosztás sorát közvetlenül csak a vezető módosíthatja)
grant select (done_note), update (done_note) on public.task_assignees to authenticated;

-- worker_task_action 'done': a p_reason a készre jelentés megjegyzése lesz (eddig csak a 'fail' használta),
-- és az értesítés szövegébe is bekerül
do $$
declare src text; n0 integer;
begin
  select pg_get_functiondef('public.worker_task_action'::regproc) into src;
  n0 := length(src);
  src := replace(src,
    $r$update public.task_assignees a set done_at = now()
      where a.task_id = p_id and a.deleted_at is null and a.done_at is null$r$,
    $r$update public.task_assignees a set done_at = now(), done_note = nullif(trim(coalesce(p_reason, '')), '')
      where a.task_id = p_id and a.deleted_at is null and a.done_at is null$r$);
  if length(src) = n0 then raise exception 'worker_task_action: a done ág nem található (kiosztás frissítése)'; end if;
  n0 := length(src);
  src := replace(src,
    $r$coalesce(v_name, 'A munkavállaló') || ' elkészült: ' || v_task.title,$r$,
    $r$coalesce(v_name, 'A munkavállaló') || ' elkészült: ' || v_task.title || coalesce(' — ' || nullif(trim(coalesce(p_reason, '')), ''), ''),$r$);
  if length(src) = n0 then raise exception 'worker_task_action: a kész értesítés nem található'; end if;
  n0 := length(src);
  src := replace(src,
    $r$|| ' — még ' || v_pending || ' fő dolgozik rajta',$r$,
    $r$|| ' — még ' || v_pending || ' fő dolgozik rajta' || coalesce(' · ' || nullif(trim(coalesce(p_reason, '')), ''), ''),$r$);
  if length(src) = n0 then raise exception 'worker_task_action: a részben kész értesítés nem található'; end if;
  execute src;
end $$;
