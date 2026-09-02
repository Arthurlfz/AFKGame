-- ============================================================
-- 追加迁移：equip_items 表补 identified 列（未鉴定状态持久化）
-- 在 Supabase SQL Editor 执行一次（幂等，可重复执行）
--
-- 背景（Bug 修复 2026-09-02）：
--   items.js saveItem 写入 identified 字段，但表里没有这一列 →
--   PostgREST 报 PGRST204「列不存在」→ 整条 INSERT 失败 →
--   掉落装备（尤其未鉴定）保存失败，刷新后丢失。
--   本迁移补上该列，默认 true（已鉴定）；历史已存装备视为已鉴定，不受影响。
-- ============================================================

alter table public.equip_items
  add column if not exists identified boolean not null default true;

create index if not exists equip_items_identified_idx
  on public.equip_items (identified);
