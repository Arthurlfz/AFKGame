-- ============================================================
-- migrate_pet_icon_nullable.sql —— pets.icon 允许为 null（2026-09-10）
-- 背景：客户端移除 emoji（立绘/头像一律走 PetSprites）后，新建宠物的 icon 为 null，
--       而 pets.icon 是 NOT NULL（默认 '🟢'）→ 插入撞 23502 → PostgREST 400
--       → 新宠拿不到 cloudId → 补建档自愈每 30 秒重试，控制台刷屏 400。
-- 处理：① 客户端 petToRow 改为只在有值时带 icon（立即生效）
--       ② 本迁移放开 NOT NULL（icon 已是死数据，彻底断根）
-- 幂等：可重复执行
-- ============================================================
alter table public.pets alter column icon drop not null;
