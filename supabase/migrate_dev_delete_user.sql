-- ============================================================
-- 开发者工具：删除账号（自测一键清号，替代手动去 Dashboard 删）
-- 用法：Supabase Dashboard → SQL Editor → 整段粘贴 → Run（幂等，可重复执行）
-- 安全：仅管理员邮箱（与 grant_gems / admin_* 一致）可调用；管理员主账号不可删。
-- 清理范围：级联删净该用户在全部业务表的数据（宠物/装备/材料/蛋/挂单/交易/任务/聊天/钱包），
--           最后删 auth.users（profiles/wallets 若有 FK 则 cascade，无 FK 也已在上面手删）。
-- 依赖：本文件假定业务表已存在（pets/equip_items/materials/pet_egg/pet_listings/
--        equip_listings/egg_listings/trade_records/wallet_ledger/orders/wallets/profiles）。
--       quest_progress / chat_messages 用 to_regclass 判存在再删，老库缺表不报错。
-- 返回：'ok' / 'forbidden' / 'protected' / 'notfound'
-- ============================================================

drop function if exists public.admin_delete_user(uuid);

create or replace function public.admin_delete_user(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_email text := '776492620@qq.com';
  v_email text;
  v_uid  uuid;
begin
  -- ① 管理员鉴权：调用者邮箱必须 = 管理员邮箱
  if auth.jwt() ->> 'email' <> v_admin_email then return 'forbidden'; end if;
  if p_user_id is null then return 'notfound'; end if;

  -- ② 不能删自己（当前管理员会话）：要删也轮不到删自己，直接拒绝
  if auth.uid() = p_user_id then return 'self'; end if;

  -- ② 目标账号存在性
  select id::uuid, email::text into v_uid, v_email from auth.users where id = p_user_id;
  if v_uid is null then return 'notfound'; end if;

  -- ③ 管理员主账号永不可删（防手滑把自己管理后台删掉）
  if v_email = v_admin_email then return 'protected'; end if;

  -- ④ 逐表清理（owner 列 text/uuid 混用，统一按 ::text 比较最稳；即使有 FK cascade 也不冲突）
  delete from public.egg_listings  where seller_id::text = p_user_id::text;
  delete from public.equip_listings where seller_id::text = p_user_id::text;
  delete from public.pet_listings   where seller_id::text = p_user_id::text;

  -- 交易记录：删「该账号自己视角」的全部行；
  -- 对手是 NPC「流浪商人」的买入行（纯机器人产生）也一并清，避免残留空壳记录。
  delete from public.trade_records where player_id::text = p_user_id::text;
  delete from public.trade_records where counterparty::text = p_user_id::text and player_id = '流浪商人';

  delete from public.equip_items  where user_id::text = p_user_id::text;
  delete from public.pet_egg      where owner_id::text = p_user_id::text;
  delete from public.pets         where user_id::text = p_user_id::text;
  delete from public.materials    where user_id::text = p_user_id::text;

  -- 可能不存在的表（老库未建）：先判存在再删，缺表不报错
  if to_regclass('public.quest_progress') is not null then
    delete from public.quest_progress where user_id::text = p_user_id::text;
  end if;
  if to_regclass('public.chat_messages') is not null then
    delete from public.chat_messages where user_id::text = p_user_id::text;
  end if;

  -- 钱包/订单（wallets 若有 FK 到 auth.users 会 cascade，这里保险手删）
  delete from public.wallet_ledger where user_id::text = p_user_id::text;
  delete from public.orders       where user_id::text = p_user_id::text;
  delete from public.wallets      where user_id::text = p_user_id::text;
  delete from public.profiles     where id::text = p_user_id::text;

  -- ⑤ 最后删 auth 账号（触发未手删的 FK cascade）
  delete from auth.users where id = p_user_id;

  return 'ok';
end; $$;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- ============================================================
-- 完成提示：执行后，开发者面板「玩家管理」行的删除按钮即可调用 admin_delete_user。
-- 若前端提示 "RPC not found" 或 400，按 Ctrl+Shift+R 硬刷新页面。
-- ============================================================
