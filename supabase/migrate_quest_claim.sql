-- ============================================================
-- migrate_quest_claim.sql —— 任务奖励「服务端权威领取记录」
-- 目的：堵住「改本地 quest_progress 的 completed → 无限重领任务奖励」
--
-- 背景（2026-09-11 审计第 5 批 P1-5）：
--   quest_progress 的 RLS 是 upsert_own（cmd=ALL），只控「是自己的行」不控内容，
--   玩家一条 PATCH 把 progress.completed 清空 → 刷新 → 任务显示未完成 → 再领一次。
--   材料奖励有 add_material 的 1000/60s 限流兜着，但装备奖励走 Items.saveItem
--   没有任何服务端限流。
--
-- 思路（最小改动）：把「这条任务领过没有」这个**判定事实**搬到服务端，
--   客户端写不了它。任务进度（打怪计数等）仍归客户端，不搬 —— 那是另一个量级的工程。
--
-- ⚠️ 向后兼容：
--   · 只 ADD COLUMN，不动现有列；老行 claimed 默认 '{}'，不追溯历史领取记录
--     （代价：本次上线后，玩家可以把【上线之前】已领过的一次性任务再领一次，仅一次）
--   · 客户端 upsert 只传 {user_id, progress, updated_at} —— 不含 claimed，
--     所以 upsert 不会把 claimed 冲掉
-- ============================================================

-- 1) 新列：已领取记录。key = 任务 id（一次性）或 任务id@周期键（日常/周常），value = 领取时间戳
alter table public.quest_progress
  add column if not exists claimed jsonb not null default '{}'::jsonb;

-- 2) 收掉表级写权限，改成【列级】：客户端只能写 progress / updated_at，
--    claimed 由 complete_quest RPC（security definer）写。
--    ⚠️ INSERT 也要收成列级，否则客户端 insert 时可以自带 claimed 值。
revoke insert, update, delete on public.quest_progress from authenticated, anon;
grant select on public.quest_progress to authenticated;
grant insert (user_id, progress, updated_at) on public.quest_progress to authenticated;
grant update (progress, updated_at) on public.quest_progress to authenticated;

-- 3) 领取：占位成功才允许客户端继续发奖
create or replace function public.complete_quest(p_quest_id text, p_period_key text default '')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_key  text;
  v_row  public.quest_progress;
begin
  if v_uid is null then return 'ERR_NO_LOGIN'; end if;
  if p_quest_id is null or btrim(p_quest_id) = '' then return 'ERR_BAD_ID'; end if;

  -- 一次性任务：p_period_key 为空 → 键就是任务 id，永久唯一。
  -- 日常/周常：客户端传周期键 → 键 = 任务id@周期（见文件头「已知边界」）。
  v_key := case
    when p_period_key is null or btrim(p_period_key) = '' then left(btrim(p_quest_id), 64)
    else left(btrim(p_quest_id), 64) || '@' || left(btrim(p_period_key), 32)
  end;

  insert into public.quest_progress (user_id, progress)
  values (v_uid, '{}'::jsonb)
  on conflict (user_id) do nothing;

  select * into v_row from public.quest_progress where user_id = v_uid for update;
  if not found then return 'ERR_NO_ROW'; end if;

  -- 已领过 → 拒绝（这是堵漏洞的那一句）
  if coalesce(v_row.claimed, '{}'::jsonb) ? v_key then return 'ALREADY_CLAIMED'; end if;

  update public.quest_progress
     set claimed = coalesce(claimed, '{}'::jsonb) || jsonb_build_object(v_key, extract(epoch from now())::bigint),
         updated_at = now()
   where user_id = v_uid;

  return 'OK';
end;
$$;

-- 只给登录用户调用；anon 与 PUBLIC 一律收回
revoke execute on function public.complete_quest(text, text) from public, anon;
grant execute on function public.complete_quest(text, text) to authenticated;

-- 4) 撤销（管理员/测试用）：删掉某条领取记录
--    不给 authenticated，避免玩家自己解封（与 profiles.banned 同款教训）
create or replace function public.admin_unclaim_quest(p_user_id uuid, p_quest_id text, p_period_key text default '')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  -- 与 migrate_admin_tools / migrate_shop 同口径：项目里没有 is_admin()，直接比管理员邮箱
  if auth.jwt() ->> 'email' <> '776492620@qq.com' then return 'ERR_NOT_ADMIN'; end if;
  v_key := case
    when p_period_key is null or btrim(p_period_key) = '' then left(btrim(p_quest_id), 64)
    else left(btrim(p_quest_id), 64) || '@' || left(btrim(p_period_key), 32)
  end;
  update public.quest_progress
     set claimed = coalesce(claimed, '{}'::jsonb) - v_key
   where user_id = p_user_id;
  return 'OK';
end;
$$;
revoke execute on function public.admin_unclaim_quest(uuid, text, text) from public, anon, authenticated;

-- ============================================================
-- 已知边界（如实记录，别当成已解决）：
--   1. 日常/周常的周期键由【客户端】传。玩家改前端伪造一个新周期键，可以在同一天
--      多领一次日常。收益低（日常 100 经验 + 少量材料）且需要改代码，
--      彻底堵需要把 task 定义（id → reset）同步到服务端 —— 下一步。
--   2. 一次性任务（主线 / 成就 / 新手 / 宠物）被彻底堵死：它们用任务 id 做键，
--      玩家伪造周期键也没用（键里没有可变部分）。奖励最厚的正是这一类。
--   3. 不追溯历史：上线前已领过的一次性任务，每人还能再领一次。
--   4. 任务【进度】（打怪计数）仍是客户端权威，改前端可以伪造进度达标。
--      本脚本不解决这个问题 —— 那要把整个任务系统搬服务端。
-- ============================================================
