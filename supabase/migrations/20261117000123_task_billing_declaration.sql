-- Elszámolás a készre jelentéskor (2026-11-17, Daniel kérése): amikor a munkavállaló készre jelenti a
-- feladatot, átnézi és jóváhagyja, ami az ügyfél felé megy — a munkaórát és a kiszállások számát (az app
-- előre kitölti a mért adatokból, ő javíthat). Az „Elszámolás az ügyfél felé” Excel ezekkel a számokkal
-- készül. A BÉRT EZ NEM ÉRINTI: a munkavállaló bére továbbra is az appban mért munkaidőből számolódik.
-- Emberenként tároljuk (task_assignees), mert több emberes feladatnál mindenki a saját részét jelenti;
-- a vállalkozó a fiók nélküli embereiét is megadja. A vezető a számokat utólag javíthatja.
-- Ha a feladat szövege több külön munkát sorol fel, a munkavállaló tételenként adja meg az időt
-- (bill_items: [{"label": "…", "hours": 1.5}, …]); a bill_hours ezek összege, egész órára felkerekítve.

alter table public.task_assignees
  add column if not exists bill_hours numeric(6,2),
  add column if not exists bill_callouts integer,
  add column if not exists bill_confirmed_at timestamptz,
  add column if not exists bill_items jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'task_assignees_bill_hours_check') then
    alter table public.task_assignees add constraint task_assignees_bill_hours_check check (bill_hours is null or (bill_hours >= 0 and bill_hours <= 999));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'task_assignees_bill_callouts_check') then
    alter table public.task_assignees add constraint task_assignees_bill_callouts_check check (bill_callouts is null or (bill_callouts >= 0 and bill_callouts <= 99));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'task_assignees_bill_items_check') then
    alter table public.task_assignees add constraint task_assignees_bill_items_check check (bill_items is null or jsonb_typeof(bill_items) = 'array');
  end if;
end $$;
-- a tábla oszloponként van kiadva; írni csak a vezető tud közvetlenül (ta_update szabály), a munkavállaló a
-- worker_task_action-ön át
grant select (bill_hours, bill_callouts, bill_confirmed_at, bill_items), update (bill_hours, bill_callouts, bill_confirmed_at, bill_items)
  on public.task_assignees to authenticated;

-- worker_task_action: új, hetedik paraméter (p_parts) — a készre jelentők elszámolási adatai:
-- [{"worker_id": "...", "hours": 6, "callouts": 1, "items": [{"label": "…", "hours": 2}]}, ...]. A régi (hat paraméteres) változatot lecseréljük;
-- a régebbi appok hívása (p_parts nélkül) változatlanul működik.
do $$
declare src text; n0 integer;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'worker_task_action';
  if position('p_parts' in src) > 0 then return; end if; -- már alkalmazva

  n0 := length(src);
  src := replace(src, 'p_photo_paths text[] DEFAULT NULL::text[])', 'p_photo_paths text[] DEFAULT NULL::text[], p_parts jsonb DEFAULT NULL::jsonb)');
  if length(src) = n0 then raise exception 'worker_task_action: a paraméterlista nem található'; end if;

  n0 := length(src);
  src := replace(src, 'where p.worker_id = a.worker_id)));',
    E'where p.worker_id = a.worker_id)));\n'
    || E'      -- elszámolás az ügyfél felé: csak azoknak a sora írható, akiknek a részét ez a hívás készre jelentheti\n'
    || E'      if p_parts is not null and jsonb_typeof(p_parts) = \'array\' then\n'
    || E'        update public.task_assignees a\n'
    || E'           set bill_hours = least(greatest(coalesce((x.v->>\'hours\')::numeric, 0), 0), 999),\n'
    || E'               bill_callouts = least(greatest(coalesce((x.v->>\'callouts\')::integer, 0), 0), 99),\n'
    || E'               bill_items = case when jsonb_typeof(x.v->\'items\') = \'array\' and jsonb_array_length(x.v->\'items\') between 1 and 30\n'
    || E'                                      and length((x.v->\'items\')::text) <= 6000 then x.v->\'items\' else null end,\n'
    || E'               bill_confirmed_at = now()\n'
    || E'          from jsonb_array_elements(p_parts) as x(v)\n'
    || E'         where a.task_id = p_id and a.deleted_at is null\n'
    || E'           and a.worker_id::text = x.v->>\'worker_id\'\n'
    || E'           and (a.worker_id = v_wid or (a.worker_id = any(public.fn_my_worker_ids())\n'
    || E'                and not exists (select 1 from public.profiles p2 where p2.worker_id = a.worker_id)));\n'
    || E'      end if;');
  if length(src) = n0 then raise exception 'worker_task_action: a készre jelentő ág nem található'; end if;

  drop function public.worker_task_action(uuid, text, text, text, numeric, text[]);
  execute src;
end $$;
revoke all on function public.worker_task_action(uuid, text, text, text, numeric, text[], jsonb) from public, anon;
grant execute on function public.worker_task_action(uuid, text, text, text, numeric, text[], jsonb) to authenticated;
