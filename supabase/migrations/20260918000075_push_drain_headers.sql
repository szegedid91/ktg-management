-- A Supabase edge-átjáró Authorization fejléc nélkül 401-et ad (verify_jwt
-- nélkül is), ezért a cron/trigger hívás a nyilvános (publishable) kulcsot
-- küldi apikey + Authorization fejlécben; a tényleges azonosítás továbbra is
-- az x-cron-secret Vault-titok. A kulcs a Vaultban: 'push_anon_key'
-- (élesben kézzel beszúrva; a migráció nem tartalmaz környezetfüggő értéket).
create or replace function public.fn_push_dispatch_call()
returns void language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_secret text; v_url text; v_anon text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_cron_secret';
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_dispatch_url';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'push_anon_key';
  if v_secret is null or v_url is null or v_anon is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_anon,
                                  'Authorization', 'Bearer ' || v_anon, 'x-cron-secret', v_secret),
    body := '{"job":"drain"}'::jsonb,
    timeout_milliseconds := 15000);
exception when others then null;
end $$;
revoke all on function public.fn_push_dispatch_call() from public, anon, authenticated;
