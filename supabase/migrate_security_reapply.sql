-- ============================================================
-- 安全守卫收口重放（2026-09-11）—— 幂等，可重复执行
--
-- 为什么存在（2026-09-11 审计发现）：
--   1. bot_buy_material 是 09-10 才加的函数，而安全收口脚本
--      migrate_security_hardening.sql 是 09-03 的 —— 那句
--      "revoke execute on all functions ... from anon" 从没覆盖过它。
--      实测（anon 直调）：bot_buy_equip/pet 返回 401，bot_buy_material 返回
--      200 "notfound" —— anon 能调，且没撞到守卫（撞到会抛 ERR_BOT_BUY_ANON）。
--      = 玩家可自己挂单自己召唤商人，无限把垃圾材料换成稀缺材料。
--   2. bot_buy_guard() 目前只被 equip/pet 调用，material 版没有。
--   3. 同一函数被多个脚本 create or replace，重放旧脚本会静默覆盖掉守卫。
--
-- 本文件的作用：把三个 bot_buy_* 一次性重定义成【带守卫】版本，并收回 anon 权限。
-- 不管线上现在是哪个版本，跑完这个文件都是对的 —— 不需要先诊断。
--
-- 用法：Supabase Dashboard → SQL Editor → 整段粘贴 → Run
-- 常量约定【必须】与 docs/js/core/config.js 的 Config.security.botBuy 一致：
--   minAccountAgeSec=600 / dailyCap=30
-- ============================================================

-- ---------- 0. 守卫日志表（兜底建表；已存在则跳过） ----------
create table if not exists public.security_bot_buy_log (
  id         bigserial primary key,
  user_id    uuid not null,
  listing_id uuid not null,
  kind       text not null default 'pet' check (kind in ('pet', 'equip', 'material')),
  created_at timestamptz not null default now()
);
create index if not exists security_bot_buy_log_user_idx
  on public.security_bot_buy_log (user_id, created_at desc);
alter table public.security_bot_buy_log enable row level security; -- 无策略：只允许安全定义者函数写入

-- 表可能是 hardening 建的（kind 只允许 pet/equip）→ 幂等补上 material
alter table public.security_bot_buy_log
  drop constraint if exists security_bot_buy_log_kind_check;
alter table public.security_bot_buy_log
  add constraint security_bot_buy_log_kind_check
  check (kind in ('pet', 'equip', 'material'));

-- ============================================================
-- 1. 守卫函数：身份 / 封禁 / 账号年龄 / 每日额度
-- ============================================================
drop function if exists public.bot_buy_guard();
create or replace function public.bot_buy_guard()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_email     text := auth.email();
  v_banned    boolean;
  v_created   timestamptz;
  v_day_count bigint;
  v_min_age   interval := interval '10 minutes';  -- 与 Config.security.botBuy.minAccountAgeSec 同步
  v_daily_cap bigint := 30;                       -- 与 Config.security.botBuy.dailyCap 同步
begin
  -- ① 身份层
  if v_uid is null or v_email is null or v_email = '' then
    raise exception 'ERR_BOT_BUY_ANON 请先登录后再召唤流浪商人';
  end if;
  -- ② 封禁层
  select banned into v_banned from public.profiles where id = v_uid;
  if v_banned then
    raise exception 'ERR_BOT_BUY_BANNED 账号已被封禁，无法召唤流浪商人';
  end if;
  -- ③ 账号年龄（新建账号前 10 分钟不允许 NPC 收购，压小号刷材料窗口）
  select created_at into v_created from auth.users where id = v_uid;
  if v_created is null or v_created > now() - v_min_age then
    raise exception 'ERR_BOT_BUY_TOO_NEW 账号创建未满10分钟，暂时无法召唤流浪商人';
  end if;
  -- ④ 每日额度
  select count(*) into v_day_count from public.security_bot_buy_log
  where user_id = v_uid and created_at >= date_trunc('day', now());
  if v_day_count >= v_daily_cap then
    raise exception 'ERR_BOT_BUY_DAILY_CAP 今日召唤流浪商人次数已达上限（30次/天）';
  end if;
end;
$$;
revoke execute on function public.bot_buy_guard() from public, anon; -- 内部守卫，不对外暴露

-- ============================================================
-- 2. bot_buy_equip：NPC 收购玩家装备挂单
-- ============================================================
drop function if exists public.bot_buy_equip(uuid);
create or replace function public.bot_buy_equip(p_listing_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.equip_listings%rowtype;
  v_tax     int;
  v_net     int;
begin
  perform public.bot_buy_guard();

  select * into v_listing from public.equip_listings
  where id = p_listing_id and status = 'active'
  for update;
  if not found then return 'notfound'; end if;

  -- 不能自己召唤商人买自己的单（防材料凭空刷）
  if v_listing.seller_id::text = auth.uid()::text then
    return 'self';
  end if;

  v_tax := floor(v_listing.material_qty / 8) * 1;
  v_net := v_listing.material_qty - v_tax;

  insert into public.materials (user_id, name, quantity)
  values (v_listing.seller_id, v_listing.material_type, v_net)
  on conflict (user_id, name) do update
    set quantity = public.materials.quantity + excluded.quantity;

  insert into public.trade_records
    (player_id, role, item_name, material_type, price_qty, tax_qty, net_qty, listing_id, counterparty)
  values
    ('流浪商人',                 'buy',  v_listing.item_name, v_listing.material_type, v_listing.material_qty, 0,    v_listing.material_qty, v_listing.id, v_listing.seller_id::text),
    (v_listing.seller_id::text,  'sell', v_listing.item_name, v_listing.material_type, v_listing.material_qty, v_tax, v_net,                 v_listing.id, '流浪商人');

  insert into public.security_bot_buy_log (user_id, listing_id, kind)
  values (auth.uid(), p_listing_id, 'equip');

  delete from public.equip_items where id = v_listing.item_id;
  -- 显式删挂单行（不依赖外键级联，防孤儿行被重复购买刷材料）
  delete from public.equip_listings where id = p_listing_id;

  return 'ok';
end;
$$;
grant execute on function public.bot_buy_equip(uuid) to authenticated;

-- ============================================================
-- 3. bot_buy_pet：NPC 收购玩家宠物挂单
-- ============================================================
drop function if exists public.bot_buy_pet(uuid);
create or replace function public.bot_buy_pet(p_listing_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.pet_listings%rowtype;
  v_tax     int;
  v_net     int;
begin
  perform public.bot_buy_guard();

  select * into v_listing from public.pet_listings
  where id = p_listing_id and status = 'active'
  for update;
  if not found then return 'notfound'; end if;

  if v_listing.seller_id::text = auth.uid()::text then
    return 'self';
  end if;

  v_tax := floor(v_listing.material_qty / 8) * 1;
  v_net := v_listing.material_qty - v_tax;

  insert into public.materials (user_id, name, quantity)
  values (v_listing.seller_id, v_listing.material_type, v_net)
  on conflict (user_id, name) do update
    set quantity = public.materials.quantity + excluded.quantity;

  insert into public.trade_records
    (player_id, role, item_name, material_type, price_qty, tax_qty, net_qty, listing_id, counterparty)
  values
    ('流浪商人',                 'buy',  v_listing.pet_name, v_listing.material_type, v_listing.material_qty, 0,    v_listing.material_qty, v_listing.id, v_listing.seller_id::text),
    (v_listing.seller_id::text,  'sell', v_listing.pet_name, v_listing.material_type, v_listing.material_qty, v_tax, v_net,                 v_listing.id, '流浪商人');

  insert into public.security_bot_buy_log (user_id, listing_id, kind)
  values (auth.uid(), p_listing_id, 'pet');

  -- 显式删挂单行（防孤儿行被重复购买刷材料）
  delete from public.pet_listings where id = p_listing_id;

  return 'ok';
end;
$$;
grant execute on function public.bot_buy_pet(uuid) to authenticated;

-- ============================================================
-- 4. bot_buy_material：NPC 收购玩家材料挂单 ★ 本次重点
--    原实现（migrate_material_listings.sql）缺守卫 / 缺 self 校验 /
--    只把挂单标 sold（这里保持标 sold，与 list_material 扣库存配套）
-- ============================================================
drop function if exists public.bot_buy_material(uuid);
create or replace function public.bot_buy_material(p_listing_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.material_listings%rowtype;
  v_tax     int;
  v_net     int;
  v_item    text;
begin
  perform public.bot_buy_guard();

  select * into v_listing from public.material_listings
  where id = p_listing_id and status = 'active'
  for update;
  if not found then return 'notfound'; end if;

  -- 不能自己召唤商人买自己的单（防材料凭空刷）—— 这正是原实现缺的那一行
  if v_listing.seller_id::text = auth.uid()::text then
    return 'self';
  end if;

  v_tax := floor(v_listing.material_qty / 8) * 1;
  v_net := v_listing.material_qty - v_tax;

  insert into public.materials (user_id, name, quantity)
  values (v_listing.seller_id, v_listing.material_type, v_net)
  on conflict (user_id, name) do update
    set quantity = public.materials.quantity + excluded.quantity;

  v_item := v_listing.good_name || ' ×' || v_listing.good_qty;
  insert into public.trade_records
    (player_id, role, item_name, material_type, price_qty, tax_qty, net_qty, listing_id, counterparty)
  values
    ('流浪商人',                'buy',  v_item, v_listing.material_type, v_listing.material_qty, 0,    v_listing.material_qty, p_listing_id, v_listing.seller_id::text),
    (v_listing.seller_id::text, 'sell', v_item, v_listing.material_type, v_listing.material_qty, v_tax, v_net,                 p_listing_id, '流浪商人');

  insert into public.security_bot_buy_log (user_id, listing_id, kind)
  values (auth.uid(), p_listing_id, 'material');

  update public.material_listings set status = 'sold' where id = p_listing_id;
  return 'ok';
end;
$$;
grant execute on function public.bot_buy_material(uuid) to authenticated;

-- ============================================================
-- 5. 末尾统一收口：anon 一律不能执行任何 public 函数
-- ============================================================
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from public;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.bot_buy_guard() from authenticated; -- 守卫函数内部专用
