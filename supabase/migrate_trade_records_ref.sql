-- ============================================================
-- 交易记录补「挂单 id + 交易对手」
-- 幂等，可重复执行；建议在 Supabase SQL Editor 执行一次，再部署前端代码。
--
-- 背景：
--   trade_records 原来只有 player_id（自己）+ role（buy/sell），
--   玩家查交易记录时看不到「我卖给了谁 / 我从谁那买的」，也关联不回挂单。
--   补两列：
--     listing_id    —— 对应的挂单 id（pet_listings / equip_listings / egg_listings）
--     counterparty  —— 交易对手：真实玩家 = 对方 user_id（text）；NPC 收购 = '流浪商人'
--
-- 兼容性：
--   1. 两列都可为 null，历史记录保持 null，不回填（无法可靠追溯）。
--   2. 下面重定义 5 个会写 trade_records 的函数，让新交易都带上这两列。
-- ============================================================
-- 🔴 【禁止重放】2026-09-11 审计发现：上面那句「函数体与现有版本一致，行为不变」是错的。
--    这 5 个函数（buy_equip / buy_pet / buy_egg / bot_buy_equip / bot_buy_pet）的副本是在
--    bot_buy 守卫上线（09-03）之后抄的旧版本，**抄丢了 4 个强制点**：
--      · perform public.bot_buy_guard()   （每日 30 次 / 账号年龄 10 分钟 / 封禁检查）
--      · seller_id = auth.uid() 的 self 校验（防自己挂单自己召唤商人刷材料）
--      · insert into security_bot_buy_log （每日额度计数）
--      · delete from equip_listings/pet_listings（防同一挂单被反复收购）
--    且末尾 grant 回了 anon。重放本文件 = 上面全部失效。
--    两个字段（listing_id / counterparty）的列定义是安全的，那两行可以单独执行；
--    5 个函数体请以 supabase/migrate_security_reapply.sql 为准。
-- ============================================================

alter table public.trade_records add column if not exists listing_id   uuid;
alter table public.trade_records add column if not exists counterparty text;

create index if not exists trade_records_listing_idx
  on public.trade_records (listing_id);

comment on column public.trade_records.listing_id   is '成交对应的挂单 id（宠物/装备/蛋挂单表通用）';
comment on column public.trade_records.counterparty is '交易对手：真实玩家 user_id 文本，或 NPC 名「流浪商人」';

-- ---------- 1. buy_pet：玩家买宠物（材料支付 + 税 + 归属转移 + 双写记录） ----------
create or replace function public.buy_pet(p_listing_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.pet_listings%rowtype;
  v_buyer   uuid := auth.uid();
  v_tax     int;
  v_net     int;
begin
  if v_buyer is null then return 'nologin'; end if;

  select * into v_listing from public.pet_listings
  where id = p_listing_id and status = 'active'
  for update;
  if not found then return 'notfound'; end if;

  if v_listing.seller_id = v_buyer or v_listing.seller_id::text = v_buyer::text then
    return 'self';
  end if;

  -- 交易税：每满 8 收 1（与 config.js Config.trade 同步）
  v_tax := floor(v_listing.material_qty / 8) * 1;
  v_net := v_listing.material_qty - v_tax;

  update public.materials set quantity = quantity - v_listing.material_qty
  where user_id = v_buyer and name = v_listing.material_type
    and quantity >= v_listing.material_qty;
  if not found then return 'insufficient'; end if;

  insert into public.materials (user_id, name, quantity)
  values (v_listing.seller_id, v_listing.material_type, v_net)
  on conflict (user_id, name) do update
    set quantity = public.materials.quantity + excluded.quantity;

  update public.pets set user_id = v_buyer where id = v_listing.pet_id;
  update public.pet_listings set status = 'sold' where id = p_listing_id;

  -- 双写：买家视角 counterparty = 卖家；卖家视角 counterparty = 买家
  insert into public.trade_records
    (player_id, role, item_name, material_type, price_qty, tax_qty, net_qty, listing_id, counterparty)
  values
    (v_buyer::text,             'buy',  v_listing.pet_name, v_listing.material_type, v_listing.material_qty, 0,    v_listing.material_qty, v_listing.id, v_listing.seller_id::text),
    (v_listing.seller_id::text, 'sell', v_listing.pet_name, v_listing.material_type, v_listing.material_qty, v_tax, v_net,                 v_listing.id, v_buyer::text);

  return 'ok';
end;
$$;
grant execute on function public.buy_pet(uuid) to anon, authenticated;

-- ---------- 2. buy_equip：玩家买装备（同上，装备版） ----------
create or replace function public.buy_equip(p_listing_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.equip_listings%rowtype;
  v_buyer   uuid := auth.uid();
  v_tax     int;
  v_net     int;
begin
  if v_buyer is null then return 'nologin'; end if;

  select * into v_listing from public.equip_listings
  where id = p_listing_id and status = 'active'
  for update;
  if not found then return 'notfound'; end if;

  if v_listing.seller_id = v_buyer or v_listing.seller_id::text = v_buyer::text then
    return 'self';
  end if;

  v_tax := floor(v_listing.material_qty / 8) * 1;
  v_net := v_listing.material_qty - v_tax;

  update public.materials set quantity = quantity - v_listing.material_qty
  where user_id = v_buyer and name = v_listing.material_type
    and quantity >= v_listing.material_qty;
  if not found then return 'insufficient'; end if;

  insert into public.materials (user_id, name, quantity)
  values (v_listing.seller_id, v_listing.material_type, v_net)
  on conflict (user_id, name) do update
    set quantity = public.materials.quantity + excluded.quantity;

  update public.equip_items set user_id = v_buyer where id = v_listing.item_id;
  update public.equip_listings set status = 'sold' where id = p_listing_id;

  insert into public.trade_records
    (player_id, role, item_name, material_type, price_qty, tax_qty, net_qty, listing_id, counterparty)
  values
    (v_buyer::text,             'buy',  v_listing.item_name, v_listing.material_type, v_listing.material_qty, 0,    v_listing.material_qty, v_listing.id, v_listing.seller_id::text),
    (v_listing.seller_id::text, 'sell', v_listing.item_name, v_listing.material_type, v_listing.material_qty, v_tax, v_net,                 v_listing.id, v_buyer::text);

  return 'ok';
end;
$$;
grant execute on function public.buy_equip(uuid) to anon, authenticated;

-- ---------- 3. buy_egg：玩家买宠物蛋 ----------
create or replace function public.buy_egg(p_listing_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.egg_listings%rowtype;
  v_buyer   uuid := auth.uid();
  v_tax     int;
  v_net     int;
begin
  if v_buyer is null then return 'nologin'; end if;

  select * into v_listing from public.egg_listings
  where id = p_listing_id and status = 'active'
  for update;
  if not found then return 'notfound'; end if;

  if v_listing.seller_id = v_buyer or v_listing.seller_id::text = v_buyer::text then
    return 'self';
  end if;

  v_tax := floor(v_listing.material_qty / 8) * 1;
  v_net := v_listing.material_qty - v_tax;

  update public.materials set quantity = quantity - v_listing.material_qty
  where user_id = v_buyer and name = v_listing.material_type
    and quantity >= v_listing.material_qty;
  if not found then return 'insufficient'; end if;

  insert into public.materials (user_id, name, quantity)
  values (v_listing.seller_id, v_listing.material_type, v_net)
  on conflict (user_id, name) do update
    set quantity = public.materials.quantity + excluded.quantity;

  insert into public.pet_egg (owner_id, egg_type, status) values (v_buyer::text, v_listing.egg_type, '未孵化');
  update public.egg_listings set status = 'sold' where id = p_listing_id;

  insert into public.trade_records
    (player_id, role, item_name, material_type, price_qty, tax_qty, net_qty, listing_id, counterparty)
  values
    (v_buyer::text,             'buy',  v_listing.egg_type || '蛋', v_listing.material_type, v_listing.material_qty, 0,    v_listing.material_qty, v_listing.id, v_listing.seller_id::text),
    (v_listing.seller_id::text, 'sell', v_listing.egg_type || '蛋', v_listing.material_type, v_listing.material_qty, v_tax, v_net,                 v_listing.id, v_buyer::text);

  return 'ok';
end;
$$;
grant execute on function public.buy_egg(uuid) to anon, authenticated;

-- ---------- 4. bot_buy_equip：流浪商人（NPC）收购玩家装备 ----------
-- 买家行 player_id = '流浪商人'，其 counterparty 记卖家；卖家行 counterparty 记 '流浪商人'
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
  select * into v_listing from public.equip_listings
  where id = p_listing_id and status = 'active'
  for update;
  if not found then return 'notfound'; end if;

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

  delete from public.equip_items where id = v_listing.item_id;

  return 'ok';
end;
$$;
grant execute on function public.bot_buy_equip(uuid) to anon, authenticated;

-- ---------- 5. bot_buy_pet：流浪商人（NPC）收购玩家宠物 ----------
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
  select * into v_listing from public.pet_listings
  where id = p_listing_id and status = 'active'
  for update;
  if not found then return 'notfound'; end if;

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

  delete from public.pet_listings where id = p_listing_id;

  return 'ok';
end;
$$;
grant execute on function public.bot_buy_pet(uuid) to anon, authenticated;
