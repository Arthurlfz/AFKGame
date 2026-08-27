-- ============================================================
-- 市场冷启动第二步：假买家（流浪商人）购买玩家挂单
-- 前提：已执行 migrate_material_trade.sql（materials 唯一约束 + 材料列 + trade_records + buy_equip）
-- 用法：Supabase Dashboard → SQL Editor → 整段粘贴 → Run
-- 注意：本文件的税率常量【必须】与 js/config.js 的 Config.trade 保持一致（每满 8 收 1）
-- ============================================================

-- ---------- bot_buy_equip / bot_buy_pet：流浪商人（系统假买家）购买玩家挂单 ----------
-- 语义：
--   1. 锁定挂单（行锁防并发），校验在售；不存在/已售出返回 'notfound'
--   2. 交易税与 buy_equip / buy_pet 一致：v_tax = floor(material_qty / 8) * 1（taxPer=8, taxAmount=1）
--   3. 卖家材料到账 = 标价 - 税（upsert 累加）
--   4. 双写交易记录：买家 player_id 记「流浪商人」（保留字符串，非真实玩家账号）、卖家记 sell
--   5. 被 NPC 买走的对象：装备删除 equip_items 行（级联删挂单）；宠物删除 pet_listings 行后保留宠物本体
-- 返回：'ok' | 'notfound'
drop function if exists public.bot_buy_equip(uuid);
drop function if exists public.bot_buy_pet(uuid);
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

  insert into public.trade_records (player_id, role, item_name, material_type, price_qty, tax_qty, net_qty)
  values
    ('流浪商人',                          'buy',  v_listing.item_name, v_listing.material_type, v_listing.material_qty, 0,    v_listing.material_qty),
    (v_listing.seller_id::text, 'sell', v_listing.item_name, v_listing.material_type, v_listing.material_qty, v_tax, v_net);

  delete from public.equip_items where id = v_listing.item_id;

  return 'ok';
end;
$$;
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

  insert into public.trade_records (player_id, role, item_name, material_type, price_qty, tax_qty, net_qty)
  values
    ('流浪商人',                          'buy',  v_listing.pet_name, v_listing.material_type, v_listing.material_qty, 0,    v_listing.material_qty),
    (v_listing.seller_id::text, 'sell', v_listing.pet_name, v_listing.material_type, v_listing.material_qty, v_tax, v_net);

  delete from public.pet_listings where id = p_listing_id;

  return 'ok';
end;
$$;
grant execute on function public.bot_buy_equip(uuid) to anon, authenticated;
grant execute on function public.bot_buy_pet(uuid) to anon, authenticated;
