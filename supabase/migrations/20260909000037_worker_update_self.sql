-- Munkavállaló a saját alapadatait (név, telefon) módosíthatja
create or replace function public.worker_update_self(p_name text, p_phone text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_wid uuid := public.fn_my_worker_id();
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
begin
  if auth.uid() is null or v_wid is null then
    raise exception 'Csak munkavállalói fiókkal használható.';
  end if;
  if v_name is null then raise exception 'A név nem lehet üres.'; end if;
  update public.workers
  set name = v_name,
      phones = case when v_phone is null then '{}'::text[] else array[v_phone] end
  where id = v_wid;
  update public.profiles set display_name = v_name where id = auth.uid();
end;
$$;
