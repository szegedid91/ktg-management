-- =============================================================
-- Fázis 1 — Row Level Security minden táblán
-- Olvasás: minden bejelentkezett felhasználó.
-- Írás/törlés: csak a rekord létrehozója.
-- Kivételek: komment (bárki írhat), app_settings (közös),
-- kifizetés-pipák (security definer RPC-n keresztül).
-- =============================================================

-- ---------- profiles ----------
alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- insert/delete: csak a signup-trigger (security definer) hozza létre

-- ---------- app_settings: közös beállítások, bárki módosíthatja ----------
alter table public.app_settings enable row level security;
create policy app_settings_select on public.app_settings for select to authenticated using (true);
create policy app_settings_update on public.app_settings for update to authenticated
  using (true) with check (true);

-- ---------- audit_log: csak olvasható ----------
alter table public.audit_log enable row level security;
create policy audit_select on public.audit_log for select to authenticated using (true);

-- ---------- általános minta: select mindenkinek, write a létrehozónak ----------
do $$
declare t text;
begin
  foreach t in array array[
    'expense_categories','sites','external_people','workers',
    'expenses','expense_photos','attendance','invoices','settlements',
    'equipment','equipment_moves'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_select on public.%I for select to authenticated using (true)', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (created_by = auth.uid())', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid())', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (created_by = auth.uid())', t, t);
  end loop;
end;
$$;

-- ---------- comments: bárki bárhova írhat, szerkeszteni/törölni a sajátját ----------
alter table public.comments enable row level security;
create policy comments_select on public.comments for select to authenticated using (true);
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = auth.uid());
create policy comments_update on public.comments for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = auth.uid());

-- ---------- beépített kategóriák védelme ----------
create or replace function public.fn_protect_builtin_category()
returns trigger language plpgsql as $$
begin
  if old.is_builtin and (tg_op = 'DELETE' or new.deleted_at is not null or new.name <> old.name) then
    raise exception 'A beépített kategóriák nem módosíthatók és nem törölhetők.';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger trg_protect_builtin before update or delete on public.expense_categories
  for each row execute function public.fn_protect_builtin_category();
