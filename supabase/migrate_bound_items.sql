-- ============================================================
-- 绑定物品（2026-09-16 策划拍板）
-- 需求来源：玩家反馈「升级太简单」→ 升级曲线降速后，任务奖励的经验要改成**经验包道具**
--   （残魂囊/聚魂囊/魂玉匣/幽冥魂髓），并且——
--   **任务产出（经验包 + 消耗品）全部绑定：能攒着用，但不能拿去卖。**
-- 为什么必须绑定：不绑定的话，任务奖励会直接冲击玩家市场经济
--   （这正是 2026-08-30 否决"可交易经验包"的原因；绑定后既保留了"攒着用"的手感，又不碰经济）。
--
-- 设计：
--   · materials  加 bound_qty  → 可交易数量 = quantity - bound_qty
--   · equip_items 加 bound      → bound=true 的装备不能上架 / 不能被买走
--
-- 用法：Supabase Dashboard → SQL Editor → 整段粘贴 → Run（幂等，可重复执行）
-- ⚠️ 配套（代码侧，跑完本文件后由 AI 接着做）：
--   1. materials.js：gain(绑定) / 消耗时优先扣绑定的
--   2. quest.js：任务发奖全部走 bound
--   3. 经验包：4 档配置 + 使用后转经验 + 背包显示
--   4. 市场：上架/购买时避开绑定数量（**收真钱前还要补服务端函数里的校验**）
-- ============================================================

-- 材料：绑定数量
alter table public.materials
  add column if not exists bound_qty integer not null default 0;

-- 绑定数量不能为负、也不能超过总数量（防止出现"绑定 5 / 总共 3"这种脏数据）
alter table public.materials drop constraint if exists materials_bound_range;
alter table public.materials
  add constraint materials_bound_range check (bound_qty >= 0 and bound_qty <= quantity);

-- 装备：绑定标记
alter table public.equip_items
  add column if not exists bound boolean not null default false;

create index if not exists equip_items_bound_idx on public.equip_items (bound);
