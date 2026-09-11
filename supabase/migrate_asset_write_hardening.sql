-- ============================================================
-- 资产表写权限加固（2026-09-11 审计第 2 批）—— 幂等，可重复执行
--
-- 🔴 问题背景：
--   本项目当前是「客户端权威」架构：客户端直接 update/insert 自己的行。
--   RLS 只做了**行归属**控制（auth.uid() = user_id），**没有做列/值控制**，
--   而这些表里没有任何 CHECK 约束、没有任何触发器。
--   → 任何登录玩家都能绕开前端，直接对 REST 接口发一条 PATCH 改自己的数据：
--
--     PATCH /rest/v1/materials?user_id=eq.<自己>
--     {"quantity": 999999}
--
--   因为游戏有**跨玩家真实交易**（材料计价的市场），这不是"自欺欺人"，
--   而是可以「凭空造货 → 挂单卖出 → 换走别人真材料」的资产窃取路径。
--
--   本文件只处理**能立刻安全收口、且不会打断任何现有功能**的两张表。
--   其余（pets / equip_items / pet_egg / quest_progress / *_listings）客户端确实在直写，
--   收掉会直接炸掉功能 —— 那些属于「服务端权威」大工程（宪法 E1 / 上线前必做 #1），
--   不在本文件范围，详见 docs/代码审计_2026-09-11.md。
--
-- 用法：Supabase Dashboard → SQL Editor → 整段粘贴 → Run
-- ============================================================

-- ============================================================
-- 1. materials —— 客户端【只读】，写入一律走 RPC
--
-- 依据（2026-09-11 全仓核对）：客户端对 materials 表只有 2 处用法，
-- 都是 select（core/materials.js:170 的 loadCloudMaterials、
-- ui/ui-shop.js:190 的商品材料展示）。
-- 所有写入都走 security definer 的 RPC：
--   add_material     （掉落上报 / 结算发奖 / 任务奖励 / 商店发货）
--   spend_material   （打造、合成、涅槃等消耗）
-- 这两个函数以 owner 身份执行，不受 RLS 与列级权限限制 → 收掉策略不影响它们。
--
-- 收益：堵住「直接 PATCH materials.quantity 凭空造材料」这条路径。
-- ============================================================
drop policy if exists materials_insert_own on public.materials;
drop policy if exists materials_update_own on public.materials;
drop policy if exists materials_delete_own on public.materials;
-- 保留 materials_select_own（客户端要读自己的余额）

-- 表级授权也一起收（Supabase 默认给 public schema 的新表授了 ALL）。
-- 只删策略也能挡住（RLS 无策略 = 默认拒绝），但两层不一致会让以后审计误判
-- —— has_table_privilege 返回 true 而实际被 RLS 拦住，看的人是懵的。
revoke insert, update, delete on public.materials from authenticated;
revoke insert, update, delete on public.materials from anon;

-- ============================================================
-- 2. profiles —— 列级收紧：玩家只能改自己的【昵称/头像】，不能改封禁状态
--
-- 🔴 这是本批第二严重的问题：profiles_update_own 的策略条件是
--   `with_check (auth.uid() = id)`，只保证"只能改自己那行"，
--   **不限制改哪些列**。所以玩家可以：
--     PATCH /rest/v1/profiles?id=eq.<自己>   {"banned": false}
--   而 bot_buy_guard() 正是用 `select banned from profiles where id = auth.uid()`
--   来做封禁拦截 → **封禁形同虚设，被封的号自己解封即可。**
--
-- 依据（2026-09-11 全仓核对）：客户端对 profiles 只写 { id, nickname }
--   （core/supabase.js 的 setMyNickname 与登录时 upsert），
--   banned / ban_reason / invite_code / created_at / last_seen_at 全部只读。
--
-- 注意：admin_ban_user / admin_* 都是 security definer（以 owner 身份执行），
--       本文件只 revoke authenticated 的列权限，**不影响管理员封禁功能**。
-- ⚠️ 以后若新增「玩家可自己编辑」的 profile 列，必须同步加进下面的 grant，
--    否则会得到一个看不懂的权限错误。
-- ============================================================
revoke update on public.profiles from authenticated;
revoke insert on public.profiles from authenticated;
-- id 要给：PostgREST 的 upsert 生成 ON CONFLICT DO UPDATE 时会把 id 一起写回；
-- 且 profiles_update_own 的 with_check(auth.uid() = id) 保证改不成别人的行。
grant update (id, nickname, avatar_url) on public.profiles to authenticated;
grant insert (id, nickname, avatar_url) on public.profiles to authenticated;

-- ============================================================
-- 3. 复核用查询（执行后可手动跑一遍确认）
--
--   select has_table_privilege('authenticated','public.materials','UPDATE')  as materials_update,
--          has_table_privilege('authenticated','public.materials','INSERT')  as materials_insert,
--          has_column_privilege('authenticated','public.profiles','banned','UPDATE')   as can_unban,   -- 应为 false
--          has_column_privilege('authenticated','public.profiles','nickname','UPDATE') as can_nick;    -- 应为 true
-- ============================================================
