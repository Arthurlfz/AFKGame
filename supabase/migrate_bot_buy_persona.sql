-- ============================================================
-- 假买家身份改为 persona 昵称（2026-09-11）—— 幂等，可重复执行
--
-- 为什么存在：
--   宪法 B2「AI 不标 "AI / 流浪商人"，全部以昵称作为真实玩家呈现」。
--   但 bot_buy_* 三个 RPC 里把买家身份写死成字符串 '流浪商人'，
--   玩家在「交易记录」里看到的就是这个 NPC 标签（2026-09-11 审计发现）。
--
-- 为什么让客户端传名字（而不是服务端自己挑）：
--   1. persona 是「阶段 1 前端沙箱」概念，名单在 docs/js/core/config.js
--      的 nickname 词库里**运行时随机生成**、不落库、每次会话都不同 ——
--      服务端没有任何权威来源可以查到"这次是谁来买"。
--   2. 把 20 个名单抄一份进 SQL = 两份维护，改 config 必漏（本项目已有先例）。
--   3. 买家身份只是**展示字段**，不参与任何结算 —— 钱和物的出入仍由服务端
--      用 p_listing_id 查库决定。客户端能传的只有"这条记录显示谁买的"。
--
-- 注意：参数带 default，且**先 drop 旧的单参版本**，否则 create or replace
--       会留下 (uuid) 和 (uuid, text) 两个重载，调用哪一个取决于参数个数 ——
--       正是本仓库已经踩过的那类坑。
--
-- 用法：Supabase Dashboard → SQL Editor → 整段粘贴 → Run
-- ============================================================

-- ============================================================
-- 0. 历史数据回填：把已写死的 '流浪商人' 换成 persona 风格昵称
--    分两条 UPDATE：买家行改 player_id，卖家行改 counterparty，
--    合在一起写会把卖家的 player_id（真实 uuid）也冲掉。
-- ============================================================
update public.trade_records set player_id    = '幽冥拾荒者7312' where player_id    = '流浪商人';
update public.trade_records set counterparty = '幽冥拾荒者7312' where counterparty = '流浪商人';

-- ============================================================
-- 1. bot_buy_equip
-- ============================================================
drop function if exists public.bot_buy_equip(uuid);
drop function if exists public.bot_buy_equip(uuid, text);
create or replace function public.bot_buy_equip(p_listing_id uuid, p_buyer_name text default '市场')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.equip_listings%rowtype;
  v_tax     int;
  v_net     int;
  v_buyer   text;
begin
  perform public.bot_buy_guard();

  -- 买家显示名：去空格、截断 24 字、空值退回中性名（信任边界，必须收口）
  v_buyer := left(btrim(coalesce(nullif(p_buyer_name, ''), '市场')), 24);

  select * into v_listing from public.equip_listings
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
    (v_buyer,                    'buy',  v_listing.item_name, v_listing.material_type, v_listing.material_qty, 0,    v_listing.material_qty, v_listing.id, v_listing.seller_id::text),
    (v_listing.seller_id::text,  'sell', v_listing.item_name, v_listing.material_type, v_listing.material_qty, v_tax, v_net,                 v_listing.id, v_buyer);

  insert into public.security_bot_buy_log (user_id, listing_id, kind)
  values (auth.uid(), p_listing_id, 'equip');

  delete from public.equip_items where id = v_listing.item_id;
  delete from public.equip_listings where id = p_listing_id;

  return 'ok';
end;
$$;
grant execute on function public.bot_buy_equip(uuid, text) to authenticated;

-- ============================================================
-- 2. bot_buy_pet
-- ============================================================
drop function if exists public.bot_buy_pet(uuid);
drop function if exists public.bot_buy_pet(uuid, text);
create or replace function public.bot_buy_pet(p_listing_id uuid, p_buyer_name text default '市场')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.pet_listings%rowtype;
  v_tax     int;
  v_net     int;
  v_buyer   text;
begin
  perform public.bot_buy_guard();

  v_buyer := left(btrim(coalesce(nullif(p_buyer_name, ''), '市场')), 24);

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
    (v_buyer,                    'buy',  v_listing.pet_name, v_listing.material_type, v_listing.material_qty, 0,    v_listing.material_qty, v_listing.id, v_listing.seller_id::text),
    (v_listing.seller_id::text,  'sell', v_listing.pet_name, v_listing.material_type, v_listing.material_qty, v_tax, v_net,                 v_listing.id, v_buyer);

  insert into public.security_bot_buy_log (user_id, listing_id, kind)
  values (auth.uid(), p_listing_id, 'pet');

  delete from public.pet_listings where id = p_listing_id;

  return 'ok';
end;
$$;
grant execute on function public.bot_buy_pet(uuid, text) to authenticated;

-- ============================================================
-- 3. bot_buy_material
-- ============================================================
drop function if exists public.bot_buy_material(uuid);
drop function if exists public.bot_buy_material(uuid, text);
create or replace function public.bot_buy_material(p_listing_id uuid, p_buyer_name text default '市场')
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
  v_buyer   text;
begin
  perform public.bot_buy_guard();

  v_buyer := left(btrim(coalesce(nullif(p_buyer_name, ''), '市场')), 24);

  select * into v_listing from public.material_listings
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

  v_item := v_listing.good_name || ' ×' || v_listing.good_qty;
  insert into public.trade_records
    (player_id, role, item_name, material_type, price_qty, tax_qty, net_qty, listing_id, counterparty)
  values
    (v_buyer,                    'buy',  v_item, v_listing.material_type, v_listing.material_qty, 0,    v_listing.material_qty, p_listing_id, v_listing.seller_id::text),
    (v_listing.seller_id::text,  'sell', v_item, v_listing.material_type, v_listing.material_qty, v_tax, v_net,                 p_listing_id, v_buyer);

  insert into public.security_bot_buy_log (user_id, listing_id, kind)
  values (auth.uid(), p_listing_id, 'material');

  update public.material_listings set status = 'sold' where id = p_listing_id;
  return 'ok';
end;
$$;
grant execute on function public.bot_buy_material(uuid, text) to authenticated;

-- ============================================================
-- 4. 收口：anon 一律不能执行（新建函数默认授给 public，要再收一次）
-- ============================================================
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from public;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.bot_buy_guard() from authenticated;
