-- ============================================================
-- 安全加固收口迁移（2026-09-03，可重复执行 / 幂等）
-- 目标：
--   0. 全局最小权限：业务 RPC 一律只允许 authenticated 执行（anon 全部收回）
--   1. add_material 高频上报限流（security_rate_limits 计数表，60s 窗口）
--   2. bot_buy_equip / bot_buy_pet 三层守卫（身份 / 封禁 / 账号年龄+每日额度）
--   3. trade_records 只允许查自己的记录（删除 anon 可读的 trade_records_select_all）
--   4. quest_progress 的 RLS 从 public 收紧为 authenticated（幂等重建）
--   5. 删除 egg_listings update_own，改单一律走 cancel_egg_listing RPC
-- 常量约定【必须】与 js/config.js 的 Config.security 一致：
--   addMaterial.windowSec=60 / maxPerWindow=1000 / maxPerCall=5000 / lockSec=300
--   botBuy.minAccountAgeSec=600 / dailyCap=30
-- 用法：Supabase Dashboard → SQL Editor → 整段粘贴 → Run
-- ============================================================

-- ---------- 0. 全库函数执行权收口（先收，末尾统一补 authenticated） ----------
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from public;

-- ============================================================
-- 1. add_material 限流
-- ============================================================
create table if not exists public.security_rate_limits (
  user_id       uuid primary key,
  window_start  timestamptz not null default now(),   -- 当前窗口起点
  window_qty    bigint      not null default 0,        -- 窗口内已累计上报数量
  locked_until  timestamptz                            -- 超限锁定的到期时间（null=未锁定）
);
alter table public.security_rate_limits enable row level security; -- 无任何策略：REST 直接读写被拒，只走安全定义者函数

drop function if exists public.add_material(text, integer);
create or replace function public.add_material(p_name text, p_amount integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_row      public.security_rate_limits;
  v_window   interval := interval '60 seconds';  -- 与 Config.security.addMaterial.windowSec 同步
  v_max_qty  bigint := 1000;                     -- 窗口上限（同步 maxPerWindow）
  v_max_call bigint := 5000;                     -- 单次上限（同步 maxPerCall）
  v_lock     interval := interval '5 minutes';   -- 锁定（同步 lockSec）
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;
  if p_name is null or p_name = '' then
    raise exception '缺少材料名';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  if p_amount > v_max_call then
    raise exception 'ERR_RATE_LIMIT 单次上报材料数量过大';
  end if;

  -- 行锁串行化同一用户的并发上报（防多标签页同时加挤爆窗口）
  select * into v_row from public.security_rate_limits where user_id = v_uid for update;

  -- 锁定期内直接拒绝（正常玩家 60 秒远到不了上限，触发锁 = 脚本风暴）
  if v_row.locked_until is not null and v_row.locked_until > now() then
    raise exception 'ERR_RATE_LIMIT 材料上报过于频繁，请稍后再试';
  end if;

  -- 无记录 / 窗口过期 → 开新窗口
  if v_row is null or (v_row.window_start + v_window) <= now() then
    insert into public.security_rate_limits (user_id, window_start, window_qty, locked_until)
    values (v_uid, now(), 0, null)
    on conflict (user_id) do update
      set window_start = excluded.window_start, window_qty = 0, locked_until = null;
    v_row.window_qty := 0;
  end if;

  -- 超窗口上限 → 锁 5 分钟再拒（防止每 60 秒刷一次继续偷）
  if (coalesce(v_row.window_qty, 0) + p_amount) > v_max_qty then
    update public.security_rate_limits set locked_until = now() + v_lock where user_id = v_uid;
    raise exception 'ERR_RATE_LIMIT 材料上报过于频繁，请稍后再试';
  end if;

  update public.security_rate_limits set window_qty = window_qty + p_amount where user_id = v_uid;

  insert into public.materials (user_id, name, quantity)
  values (v_uid, p_name, p_amount)
  on conflict (user_id, name) do update
    set quantity = public.materials.quantity + excluded.quantity;
end;
$$;

-- ============================================================
-- 2. bot_buy 三层守卫（bot_buy_equip / bot_buy_pet 共用）
--    ① 身份：auth.uid() + auth.email() 非空（匿名 / 无邮箱账号禁调）
--    ② 封禁：profiles.banned 玩家禁调
--    ③ 账号年龄 ≥ 10 分钟 + 每账号每天最多 30 次（security_bot_buy_log 记账）
-- ============================================================
create table if not exists public.security_bot_buy_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  listing_id uuid not null,
  kind       text not null default 'pet' check (kind in ('pet', 'equip')),
  created_at timestamptz not null default now()
);
create index if not exists security_bot_buy_log_user_idx
  on public.security_bot_buy_log (user_id, created_at desc);
alter table public.security_bot_buy_log enable row level security; -- 无策略：只允许安全定义者函数写入

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
  -- ③ 每日额度
  select count(*) into v_day_count from public.security_bot_buy_log
  where user_id = v_uid and created_at >= date_trunc('day', now());
  if v_day_count >= v_daily_cap then
    raise exception 'ERR_BOT_BUY_DAILY_CAP 今日召唤流浪商人次数已达上限（30次/天）';
  end if;
end;
$$;
revoke execute on function public.bot_buy_guard() from public, anon; -- 内部守卫，不对外暴露

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

  delete from public.pet_listings where id = p_listing_id;

  return 'ok';
end;
$$;

-- ============================================================
-- 3. trade_records：只允许查自己（删除 anon 也能全量读的 select_all）
-- ============================================================
alter table public.trade_records enable row level security;
drop policy if exists "trade_records_open_all" on public.trade_records;
drop policy if exists "trade_records_select_all" on public.trade_records;
drop policy if exists "trade_records_select_own" on public.trade_records; -- 重建前先删旧名（幂等）
create policy "trade_records_select_own" on public.trade_records
  for select to authenticated using (player_id = auth.uid()::text);

-- ============================================================
-- 4. quest_progress：RLS 角色从 public 收紧为 authenticated（幂等重建）
--    表在部分库里已存在（CREATE TABLE IF NOT EXISTS 兜底），策略 DROP+CREATE
-- ============================================================
create table if not exists public.quest_progress (
  user_id    uuid primary key,
  progress   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.quest_progress enable row level security;
-- 云端旧策略名（public 角色）也一并幂等删除，否则旧的 public 读写残留
drop policy if exists "qp_select_own" on public.quest_progress;
drop policy if exists "qp_upsert_own" on public.quest_progress;
drop policy if exists "quest_progress_select_own" on public.quest_progress;
drop policy if exists "quest_progress_upsert_own" on public.quest_progress;
create policy "quest_progress_select_own" on public.quest_progress
  for select to authenticated using (user_id = auth.uid());
create policy "quest_progress_upsert_own" on public.quest_progress
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- 5. egg_listings：删除 update_own —— 改价/改状态一律走 cancel_egg_listing RPC
-- ============================================================
drop policy if exists "egg_listings_update_own" on public.egg_listings;

-- ============================================================
-- 6. 末尾统一授权：业务函数只给 authenticated（刚新建的函数默认授给 public，要再收一次）
-- ============================================================
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from public;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.bot_buy_guard() from authenticated; -- 守卫函数内部专用，收回外部执行权
