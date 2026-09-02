-- ============================================================
-- 迁移：宠物任务进度（evolve/kill 类任务，存出战宠物行的 jsonb）
-- 幂等，可重复执行；执行后再部署前端代码。
-- ============================================================

-- quest_progress：存 { [questId]: 累计次数 }（evolve/kill 任务进度）
alter table public.pets
  add column if not exists quest_progress jsonb;
