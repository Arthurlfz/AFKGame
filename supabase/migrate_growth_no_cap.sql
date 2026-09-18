-- migrate_growth_no_cap.sql —— 取消宠物成长值上限 100（2026-09-17 用户拍板）
--
-- 背景：成长卡在 100 是【三处叠加】的结果，且三者互相矛盾：
--   ① 数据库本文件的 pets_growth_ck（growth <= 100）—— 最硬的一道，超 100 直接写库失败（23514）
--   ② 客户端合成软上限（config.synthesize.normalGrowthCap=100，超过部分减半）
--   ③ 神宠培育封顶（pet_merge.js cultivate：>= 100 拒绝、写入时 Math.min(100, …)）
--   而涅槃侧早已无上限（config.nirvana 没有 maxGrowth，节奏改由「分段阻尼」控制），
--   所以旧口径「成长无上限」只在神级宠身上成立，普通宠与培育都被 100 挡住。
--
-- 改法：放宽为「只保留下限 + 一道防脏数据的极宽上界」。
--   为什么不干脆去掉上界：本项目是**客户端权威**（DevTools 可改数值），
--   numeric 一旦被写成天文数字，战力计算（lv × growth × 系数）会溢出成 Infinity → 界面/战斗崩。
--   100 万 = 正常玩法几十年都到不了，实际等于无上限，但能挡住脏数据与手滑。
--
-- 幂等：drop ... if exists + add（可重复执行）。
-- 存量数据不受影响（此前没人能超过 100，因为写不进去）。

alter table public.pets drop constraint if exists pets_growth_ck;
alter table public.pets add constraint pets_growth_ck check (growth >= 1 and growth <= 1000000);
