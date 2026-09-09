-- Az olvasott-jelöléshez (read_at) a bejelentkezett felhasználónak UPDATE jog
-- kell a táblán (az RLS csak a saját sorait engedi). Az anon szerepnek
-- semmi keresnivalója rajta.
grant select, update on public.notification_queue to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.notification_queue from anon;
