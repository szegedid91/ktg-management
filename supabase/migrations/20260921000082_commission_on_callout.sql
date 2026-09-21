-- Közvetítői díj a kiszállásra is jár (2026-09-21, Daniel kérése): a kiszállást 1 órának
-- számoljuk, ezért százalékos jutaléknál a kiszállási díj után, óránkénti fix díjnál
-- +1 óra jutalék jár. Napi / projekt egységű fix díjnál nincs változás.
CREATE OR REPLACE FUNCTION public.fn_attendance_compute()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  w public.workers%rowtype;
  s public.app_settings%rowtype;
  v_rate numeric(14,2);
  v_base numeric(14,2);
begin
  select * into w from public.workers where id = new.worker_id;
  select * into s from public.app_settings where id = 1;

  -- munkás-csere: a közvetítő-pillanatkép az ÚJ munkásról készül újra
  if tg_op = 'UPDATE' and new.worker_id is distinct from old.worker_id then
    new.referrer_user_id := w.referrer_user_id;
    new.referrer_external_id := w.referrer_external_id;
  end if;

  -- díj feloldása: tétel-felülírás > munkavállalói díj > globális alapértelmezés
  if new.applied_rate is null then
    if new.pay_basis = 'hourly' then
      v_rate := coalesce(w.hourly_rate, case when w.worker_type = 'company' then s.company_hourly_rate else s.individual_hourly_rate end);
    elsif new.pay_basis = 'daily' then
      v_rate := coalesce(w.daily_rate, case when w.worker_type = 'company' then s.company_daily_rate else s.individual_daily_rate end);
    elsif new.pay_basis = 'project' then
      v_rate := coalesce(w.project_rate, case when w.worker_type = 'company' then s.company_project_rate else s.individual_project_rate end);
    else
      v_rate := 0;
    end if;
    new.applied_rate := v_rate;
  end if;

  -- alapbér (kiszállási díj nélkül)
  v_base := case new.pay_basis
    when 'hourly'  then round(new.applied_rate * coalesce(new.hours, 0), 2)
    when 'daily'   then round(new.applied_rate * new.day_multiplier, 2)
    when 'project' then new.applied_rate
    else 0
  end;
  v_base := greatest(v_base, 0);

  -- kiszállási díj (jelenlét-sornál nincs)
  new.callout_fee := case when new.pay_basis = 'presence' then 0 else greatest(coalesce(new.callout_fee, 0), 0) end;

  -- közvetítő pillanatkép a munkavállalóról (csak ha a tételen még nincs)
  if new.referrer_user_id is null and new.referrer_external_id is null then
    new.referrer_user_id := w.referrer_user_id;
    new.referrer_external_id := w.referrer_external_id;
  end if;

  -- közvetítői díj: a bér része (osztódik, nem adódik hozzá). A kiszállás 1 órának számít,
  -- ezért arra is jár: százaléknál a kiszállási díj után, óránkénti fix díjnál +1 óra.
  new.commission_amount := 0;
  if (new.referrer_user_id is not null or new.referrer_external_id is not null)
     and w.commission_mode is not null and new.pay_basis <> 'presence' then
    if w.commission_mode = 'percent' then
      new.commission_amount := round((v_base + new.callout_fee) * coalesce(w.commission_value, 0) / 100.0, 2);
    else -- fix összeg
      new.commission_amount := case w.commission_unit
        when 'hour'    then round(coalesce(w.commission_value, 0) * (coalesce(new.hours, 0) + case when new.callout_fee > 0 then 1 else 0 end), 2)
        when 'day'     then round(coalesce(w.commission_value, 0) * new.day_multiplier, 2)
        when 'project' then case when new.pay_basis = 'project' then coalesce(w.commission_value, 0) else 0 end
        else 0
      end;
    end if;
    new.commission_amount := greatest(0, least(new.commission_amount, v_base + new.callout_fee));
  end if;

  -- bérköltség = alapbér + kiszállási díj
  new.amount := v_base + new.callout_fee;

  return new;
end;
$function$;

-- a még KI NEM FIZETETT, kiszállási díjas, közvetítős napok újraszámolása (a kifizetettekhez nem nyúlunk)
-- (a számoló trigger csak bizonyos oszlopok írására fut — a hours önmagára állítása elindítja)
update public.attendance a set hours = a.hours
where a.deleted_at is null and a.paid_at is null and a.commission_paid_at is null and a.callout_fee > 0
  and (a.referrer_user_id is not null or a.referrer_external_id is not null);
