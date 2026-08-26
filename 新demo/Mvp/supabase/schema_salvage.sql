-- ============================================================
-- schema_salvage.sql —— 装备管理：锁定 + 一键分解
-- 1. equip_items 表加 locked 列（锁定防分解，默认 false）
-- 说明：equip_items 的 RLS（select/insert/update/delete own）在
--       schema_items.sql 已建，无需重复添加策略。
-- ============================================================

alter table public.equip_items
  add column if not exists locked boolean not null default false;
