-- ============================================================
-- 追加迁移：pets 表补 equipment 列（穿在宠物身上的装备 cloudId 列表）
-- 在 Supabase SQL Editor 执行一次（幂等，可重复执行）
--
-- 背景（Bug 修复）：
--   装备槽（pet.equipment）之前只存在内存里，F5 刷新 / 换设备后全部脱落。
--   本迁移给 pets 加 jsonb 列 equipment，存 { 部位: 装备cloudId }：
--     - 穿/脱装备时更新 pets.equipment
--     - 刷新后按 cloudId 从 equip_items 找回装备穿上
--   装备本体只存一份（equip_items 表），pets.equipment 只存引用。
-- ============================================================

alter table public.pets
  add column if not exists equipment jsonb not null default '{}'::jsonb;
