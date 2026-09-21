-- A vállalkozó emberének napjaira a VÁLLALKOZÓ közvetítője és közvetítői díja érvényes
-- (a kifizetés is a vállalkozóhoz megy) — ha az embernél nincs saját közvetítő beállítva.
do $mig$
declare
  d text := pg_get_functiondef('public.fn_attendance_compute'::regproc);
  v_old text := E'  select * into s from public.app_settings where id = 1;\n';
  v_new text := E'  select * into s from public.app_settings where id = 1;\n\n'
    || E'  -- vállalkozó embere: saját közvetítő híján a vállalkozóé érvényes\n'
    || E'  if w.contractor_id is not null and w.referrer_user_id is null and w.referrer_external_id is null then\n'
    || E'    select * into c from public.workers where id = w.contractor_id;\n'
    || E'    w.referrer_user_id := c.referrer_user_id;\n'
    || E'    w.referrer_external_id := c.referrer_external_id;\n'
    || E'    w.commission_mode := c.commission_mode;\n'
    || E'    w.commission_value := c.commission_value;\n'
    || E'    w.commission_unit := c.commission_unit;\n'
    || E'  end if;\n';
  v_decl_old text := E'  w public.workers%rowtype;\n';
  v_decl_new text := E'  w public.workers%rowtype;\n  c public.workers%rowtype;\n';
begin
  if position('c public.workers%rowtype' in d) > 0 then return; end if;
  if position(v_old in d) = 0 or position(v_decl_old in d) = 0 then
    raise exception 'fn_attendance_compute: a várt szövegrész nem található';
  end if;
  d := replace(replace(d, v_decl_old, v_decl_new), v_old, v_new);
  execute d;
end $mig$;

-- a még ki nem fizetett, közvetítő nélküli napok újraszámolása azoknál az embereknél,
-- akiknek a vállalkozójához közvetítő tartozik (a kifizetett napokhoz nem nyúlunk)
update public.attendance a set hours = a.hours
from public.workers w join public.workers c on c.id = w.contractor_id
where a.worker_id = w.id and a.deleted_at is null and a.paid_at is null
  and a.referrer_user_id is null and a.referrer_external_id is null
  and w.referrer_user_id is null and w.referrer_external_id is null
  and (c.referrer_user_id is not null or c.referrer_external_id is not null) and c.commission_mode is not null;
