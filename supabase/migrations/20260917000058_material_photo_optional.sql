-- Utólag rögzített munkánál a fő felhasználó fotó nélkül is felvehet
-- anyagköltséget (a munkavállalónál az app továbbra is kötelezővé teszi).
alter table public.task_materials alter column photo_path drop not null;
