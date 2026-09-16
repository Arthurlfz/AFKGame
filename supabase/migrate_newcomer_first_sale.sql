-- ============================================================
-- 新人「第一笔成交」优先（2026-09-17）
--
-- 要解决的问题：
--   这游戏对外主打的一句话是「你打到的东西，能卖给真实的玩家」。
--   但服务端常驻买家挑单的规则是【便宜优先、先挂先卖】—— 新人挂出去的单，
--   前面排着一堆老玩家的便宜货，要等 5 分钟一轮的定时扫描，前面还可能一直有人，
--   结果就是：新人在前十分钟根本等不到成交，宣传里那句话兑现不了。
--
-- 做法：给「还没做成过第一笔买卖的卖家」的挂单加一个排序优先级。
--   判据：这个卖家在 trade_records 里【从来没有 sell 记录】= 他还没卖出过任何东西。
--   对每个玩家来说这辈子只有一次，所以总量天然有界（= 新玩家数），不会被刷。
--
-- ⚠️ 不改配额、不改漏桶：漏桶（按当天进度匀速释放）是防"系统秒收"的，继续保留。
--   只是同一个时刻里，新人的单排在前面。
--
-- ⚠️ 本文件只重定义挑单排序，收购/记账/销毁那段逻辑原样照搬自
--   migrate_market_bot_service.sql（2026-09-13 版），没动一个字。
--   按宪法维护规则 6：改函数请新建文件，别回头改已执行过的文件。
-- ============================================================

-- ---------- 1) 装备：market_bot_sweep ----------
create or replace function public.market_bot_sweep()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg      jsonb;
  v_on       boolean;
  v_cap      int;
  v_maxprice int;
  v_done     int;
  v_quota    int;
  v_listing  public.equip_listings%rowtype;
  v_tax      int;
  v_net      int;
  v_buyer    text;
begin
  select config into v_cfg from public.game_config_overrides where id = true;
  v_on := coalesce((v_cfg->'bot'->>'enabled')::boolean, false);
  if not v_on then return 0; end if;

  v_cap      := greatest(0, coalesce((v_cfg->'bot'->>'dailyCap')::int, 30));
  v_maxprice := greatest(0, coalesce((v_cfg->'bot'->>'maxPrice')::int, 10));

  -- 今日已收几件：数自己的账本（不新建计数列、不依赖买家名）
  select count(*) into v_done
    from public.market_bot_sweep_log
   where created_at >= date_trunc('day', now())
     and (kind is null or kind = 'equip');   -- 材料单走另一个函数、另一套配额

  -- 漏桶：配额按当天进度匀速释放（不是开闸秒光）。
  -- 秒光有两个害处：① 玩家发现"系统秒收"，会挂高价来试探；② 前两小时用完全天额度，后面全没人收。
  v_quota := floor(v_cap * (extract(hour from now()) * 60 + extract(minute from now())) / 1440.0);
  if v_done >= v_quota then return 0; end if;

  -- 挑单：**新人第一笔成交优先**，然后才是便宜优先、旧的先出（先挂的先卖，跟真人市集一个感觉）
  select l.* into v_listing
    from public.equip_listings l
   where l.status = 'active'
     and l.seller_id is not null
     /* 只看价钱，**不看稀有度**。
      * ⚠️ 2026-09-13 撤掉原写的 `item_rarity in ('white','blue')`（"金装留给真人交易"）——
      *    那是我自己加的设计、用户没拍过，副作用是**玩家最值钱的金装反而卖不掉**（实测卡住）。
      *    价格门槛本身就管住了价值：贵的（金装参考价 8~20）自然被 maxPrice 挡在外面。
      *    想恢复稀有度限制，在这里加回 `and l.item_rarity in ('white','blue')`。 */
     and l.material_qty <= v_maxprice
   order by
     /* ⭐ 2026-09-17：还没卖出过任何东西的卖家 = 0，排在最前面。
      *   这样新人的第一单不会被老玩家的便宜货一直挤到后面。 */
     case when exists (
            select 1 from public.trade_records t
             where t.role = 'sell' and t.player_id = l.seller_id::text
             limit 1
          ) then 1 else 0 end,
     l.material_qty asc, l.created_at asc
   limit 1
   for update skip locked;                  -- 跳锁：别跟真人购买打架
  if not found then return 0; end if;

  -- 买家名：随机 persona 昵称（**不标 "流浪商人"**，宪法 §二 B-2；词库见 market_bot_nickname）
  v_buyer := public.market_bot_nickname();

  v_tax := floor(v_listing.material_qty / 8) * 1;   -- 与 Config.trade 同口径（每满 8 收 1）
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

  insert into public.market_bot_sweep_log
    (listing_id, seller_id, item_name, material_type, material_qty, net_qty, buyer_name, kind)
  values
    (v_listing.id, v_listing.seller_id, v_listing.item_name, v_listing.material_type, v_listing.material_qty, v_net, v_buyer, 'equip');

  -- 收走即销毁（不回流库存）：装备离场 = 天然 sink，防"机器人左手倒右手"
  delete from public.equip_items where id = v_listing.item_id;
  delete from public.equip_listings where id = v_listing.id;

  return 1;
end;
$$;

-- 只给服务端/定时任务用，**不给玩家**（玩家走 bot_buy_equip，那条路有守卫和每日额度）
revoke all on function public.market_bot_sweep() from public, anon, authenticated;


-- ---------- 2) 材料：market_bot_sweep_material（同样加新人优先） ----------
create or replace function public.market_bot_sweep_material()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg      jsonb;
  v_on       boolean;
  v_cap      int;
  v_maxprice int;
  v_done     int;
  v_quota    int;
  v_listing  public.material_listings%rowtype;
  v_tax      int;
  v_net      int;
  v_buyer    text;
  v_item     text;
begin
  select config into v_cfg from public.game_config_overrides where id = true;
  v_on := coalesce((v_cfg->'bot'->>'enabled')::boolean, false);
  if not v_on then return 0; end if;

  v_cap      := greatest(0, coalesce((v_cfg->'bot'->>'materialDailyCap')::int, 20));
  v_maxprice := greatest(0, coalesce((v_cfg->'bot'->>'maxPrice')::int, 10));

  select count(*) into v_done
    from public.market_bot_sweep_log
   where created_at >= date_trunc('day', now()) and kind = 'material';

  v_quota := floor(v_cap * (extract(hour from now()) * 60 + extract(minute from now())) / 1440.0);
  if v_done >= v_quota then return 0; end if;

  -- 挑单：**新人优先**，然后按「每份单价 = 要价 ÷ 份数」最便宜优先（与前端 tryBuyOnce 同一个直觉）
  -- ⚠️ 不按 created_at 排（material_listings 有没有这一列没核实过，别赌）；用 id 兜底保证排序稳定
  select l.* into v_listing
    from public.material_listings l
   where l.status = 'active'
     and l.seller_id is not null
     and l.material_qty <= v_maxprice
     and l.good_qty > 0
   order by
     case when exists (
            select 1 from public.trade_records t
             where t.role = 'sell' and t.player_id = l.seller_id::text
             limit 1
          ) then 1 else 0 end,
     (l.material_qty::numeric / l.good_qty) asc, l.id asc
   limit 1
   for update skip locked;
  if not found then return 0; end if;

  v_buyer := public.market_bot_nickname();
  v_tax   := floor(v_listing.material_qty / 8) * 1;   -- 与 Config.trade 同口径（每满 8 收 1）
  v_net   := v_listing.material_qty - v_tax;
  v_item  := v_listing.good_name || ' ×' || v_listing.good_qty;

  insert into public.materials (user_id, name, quantity)
  values (v_listing.seller_id, v_listing.material_type, v_net)
  on conflict (user_id, name) do update
    set quantity = public.materials.quantity + excluded.quantity;

  insert into public.trade_records
    (player_id, role, item_name, material_type, price_qty, tax_qty, net_qty, listing_id, counterparty)
  values
    (v_buyer,                    'buy',  v_item, v_listing.material_type, v_listing.material_qty, 0,     v_listing.material_qty, v_listing.id, v_listing.seller_id::text),
    (v_listing.seller_id::text,  'sell', v_item, v_listing.material_type, v_listing.material_qty, v_tax, v_net,                  v_listing.id, v_buyer);

  insert into public.market_bot_sweep_log
    (listing_id, seller_id, item_name, material_type, material_qty, net_qty, buyer_name, kind)
  values
    (v_listing.id, v_listing.seller_id, v_item, v_listing.material_type, v_listing.material_qty, v_net, v_buyer, 'material');

  -- 材料挂单不删行、置 sold（与 bot_buy_material 一致，留档对账）
  update public.material_listings set status = 'sold' where id = v_listing.id;

  return 1;
end;
$$;
revoke all on function public.market_bot_sweep_material() from public, anon, authenticated;
