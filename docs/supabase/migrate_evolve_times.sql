-- ============================================================
-- 阶段二迁移：宠物进化次数 / 转生次数
-- 幂等，可重复执行；执行后再部署前端代码。
-- ============================================================

alter table public.pets
  add column if not exists evolve_times integer not null default 0;

alter table public.pets
  add column if not exists reborn_count integer not null default 0;
