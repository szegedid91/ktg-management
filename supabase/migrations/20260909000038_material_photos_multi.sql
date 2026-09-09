-- Anyagköltséghez több fotó (a photo_path az első marad a kompatibilitás miatt)
alter table public.task_materials add column if not exists photo_paths text[] not null default '{}';
update public.task_materials set photo_paths = array[photo_path] where photo_paths = '{}' and photo_path is not null;
