-- ============================================================
-- 血脉特质 + 魂铸系统 数据迁移
-- 对应《宠物特质与魂铸系统·设计方案v1》与《实施提示词》
-- 兼容旧库：列缺失时前端 pets 查询/写入会自动降级（见 supabase.js queryPets/buildPetRow），
-- 但建议执行本迁移以获得完整特质/魂铸/市场快照功能。
-- ============================================================

-- pets 表：血脉特质 / 觉醒特质槽 / 来源标记
ALTER TABLE pets ADD COLUMN IF NOT EXISTS traits jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS awaken_trait text;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'normal';

-- equip_items 表：魂铸词缀（随装备走，可交易，每装备仅 1 条）
ALTER TABLE equip_items ADD COLUMN IF NOT EXISTS soul_affix jsonb;

-- 市场在售快照（不影响装备/宠物本体，纯展示用）
ALTER TABLE pet_listings ADD COLUMN IF NOT EXISTS pet_traits jsonb;
ALTER TABLE equip_listings ADD COLUMN IF NOT EXISTS item_soul jsonb;

-- 可选：为旧数据回填默认空，确保 NOT NULL 列干净（新库无需）
-- UPDATE pets SET traits = '[]'::jsonb WHERE traits IS NULL;
-- UPDATE pets SET source = 'normal' WHERE source IS NULL OR source = '';
