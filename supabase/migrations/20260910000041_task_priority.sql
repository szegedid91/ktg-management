-- Feladat prioritás: 0 = normál, 1 = prioritásos (sürgős)
alter table public.worker_tasks add column if not exists priority smallint not null default 0
  check (priority in (0, 1));
create index if not exists ix_tasks_priority on public.worker_tasks (priority desc, updated_at desc);
