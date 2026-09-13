-- ============================================================
-- 服务端常驻买家（流浪商人 24 小时扫货）—— 2026-09-13
-- ⚠️ 2026-09-13 修订：买家名不再写死 '流浪商人'，改随机 persona 昵称（见下 §2 说明）。
--    本文件幂等，**重跑一次即可完成升级**（函数 create or replace；表 if not exists）。
--
-- 解决什么问题：
--   前端机器人（js/core/market_bot.js）只跑在**玩家浏览器**里，且不买自己挂的单。
--   → 没有别的玩家在线时，玩家挂出去的东西**永远没人买**（"能卖给真人"这个卖点落空）。
--   本迁移把"扫货"搬到数据库定时任务里，不管有没有人在线都有人来收货。
--
-- 参数全部读 game_config_overrides.config -> 'bot'，改参数不用改函数：
--   { "bot": { "enabled": true, "dailyCap": 30, "maxPrice": 5 } }
--   · enabled  ：总开关。**默认关**（没配过就不动）—— 服务端默认保守，要开得显式配。
--                同一个键也被前端 server-config.js 读走（开关一关，浏览器里的机器人也停）。
--   · dailyCap ：每天最多收几件**装备**（全局）。默认 30 = 注入约 150 材料 ≈ 单玩家日产出的 10%。
--   · materialDailyCap ：每天最多收几笔**材料**（全局，独立于 dailyCap）。默认 20。
--                材料与装备分开配额的原因：共用一份额度会被装备吃满（材料产出是装备的 6 倍，更容易堆背包卖不掉）。
--   · maxPrice ：只收标价 ≤ 这个数的。**起步 10** —— 参考价（config.marketBot.prices）白装 2~6、
--                蓝装 4~10、金装 8~20，所以 10 能收下白装全档和蓝装中低价，贵的金装自然被挡住。
--
-- 为什么不动现有的 bot_buy_equip / bot_buy_pet / bot_buy_material：
--   那三个是「玩家主动召唤商人」的路径，带 bot_buy_guard（身份/封禁/账号年龄/每人每天 30 次）。
--   定时任务是**系统行为**，既没有 JWT 也不该占玩家的每日额度 —— 职责不同，所以单独一个函数，
--   只共用同一套口径（税每满 8 收 1 / trade_records 双写）。
--   ⚠️ 改了税率或记录字段，这里要跟着改（税率与 js/config.js Config.trade 同步）。
--
-- 幂等：可重复执行。用法：Supabase Dashboard → SQL Editor → 整段粘贴 → Run
-- ============================================================

-- 0) 定时器（Supabase 原生 pg_cron；已启用则跳过）
create extension if not exists pg_cron;

-- ============================================================
-- 1) 机器人自己的小账本（记录每次收购）
--    为什么需要它：买家名改成随机昵称后，就没有 `player_id = '流浪商人'` 这个稳定标记了，
--    「今天收了几件」和「今天注入多少材料」都得靠这本账。
--    ⚠️ 玩家读不到（不建 policy + revoke）；要看数用 SQL Editor 跑 §5 的查询。
-- ============================================================
create table if not exists public.market_bot_sweep_log (
  id            bigserial primary key,
  listing_id    uuid,
  seller_id     uuid,
  item_name     text,
  material_type text,
  material_qty  int,        -- 标价（含税）
  net_qty       int,        -- 卖家实收 = 注入材料量（**调参要盯的就是这个的当日合计**）
  buyer_name    text,       -- 当次使用的 persona 昵称（留档，方便对账）
  created_at    timestamptz not null default now()
);
alter table public.market_bot_sweep_log enable row level security;
revoke all on public.market_bot_sweep_log from anon, authenticated;
-- 2026-09-13 追加：区分收的是装备还是材料（装备/材料各有一套独立日配额，各数各的）
alter table public.market_bot_sweep_log add column if not exists kind text;

-- ============================================================
-- 1b) 随机买家昵称（装备/材料两个扫货函数共用一份词库）
--     宪法 §二 B-2：AI 不标 "AI / 流浪商人"，一律以真实玩家昵称呈现。
--     ⚠️ 词库抄自 docs/js/core/config.js 的 `auth.nickname`（14 前缀 × 10 后缀 + 4 位编号）。
--     改那边要同步这里 —— 这份重复是故意的：SQL 里读不到前端 config。
-- ============================================================
create or replace function public.market_bot_nickname()
returns text
language sql
security definer
set search_path = public
as $$
  select (array['灰烬','腐叶','白骨','暗影','血月','荒冢','锈铁','寒鸦','幽冥','枯荣','泣腐','幽影','血潮','腐变'])[1 + floor(random() * 14)]
      || (array['行者','术士','游侠','猎手','守夜人','拾荒者','铸魂者','引路人','掘墓人','游荡者'])[1 + floor(random() * 10)]
      || (1000 + floor(random() * 9000))::int::text;
$$;
revoke all on function public.market_bot_nickname() from public, anon, authenticated;

-- ============================================================
-- 2) 扫货函数：最多收 1 件装备，收不到返回 0
-- ============================================================
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

  -- 挑单：便宜优先、旧的先出（先挂的先卖，跟真人市集一个感觉）
  select * into v_listing
    from public.equip_listings
   where status = 'active'
     and seller_id is not null
     /* 只看价钱，**不看稀有度**。
      * ⚠️ 2026-09-13 撤掉原写的 `item_rarity in ('white','blue')`（"金装留给真人交易"）——
      *    那是我自己加的设计、用户没拍过，副作用是**玩家最值钱的金装反而卖不掉**（实测卡住）。
      *    价格门槛本身就管住了价值：贵的（金装参考价 8~20）自然被 maxPrice 挡在外面。
      *    想恢复稀有度限制，在这里加回 `and item_rarity in ('white','blue')`。 */
     and material_qty <= v_maxprice
   order by material_qty asc, created_at asc
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

-- ============================================================
-- 2b) 材料挂单收购（2026-09-13 追加）
--     为什么单独一个函数、单独配额：材料与装备的计价口径不同（材料按「每份单价 = 要价 ÷ 份数」挑），
--     且**共用一份配额会被装备吃满**（玩家装备产出 240 件/天 vs 材料 1400 件/天，材料更容易堆背包卖不掉）。
--     收购口径照抄 bot_buy_material：卖家收 net、货置 sold 不回流（天然 sink）、trade_records 双写。
-- ============================================================
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

  -- 挑单：按「每份单价 = 要价 ÷ 份数」最便宜优先（与前端 tryBuyOnce 同一个直觉：单价低的先被买走）
  -- ⚠️ 不按 created_at 排（material_listings 有没有这一列没核实过，别赌）；用 id 兜底保证排序稳定
  select * into v_listing
    from public.material_listings
   where status = 'active'
     and seller_id is not null
     and material_qty <= v_maxprice
     and good_qty > 0
   order by (material_qty::numeric / good_qty) asc, id asc
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

-- ============================================================
-- 3) 定时：装备每 5 分钟、材料每 5 分钟（错开 2 分钟）。每次最多 1 件；真正的闸门是配额，不是频率。
-- ============================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'market_bot_sweep') then
    perform cron.unschedule('market_bot_sweep');
  end if;
  if exists (select 1 from cron.job where jobname = 'market_bot_sweep_material') then
    perform cron.unschedule('market_bot_sweep_material');
  end if;
end $$;

select cron.schedule('market_bot_sweep', '*/5 * * * *', 'select public.market_bot_sweep();');
-- ⚠️ 用显式枚举而不是 `2-59/5`：跨 cron 解析器（pg_cron / 不同版本）对 range+step 的支持不一致，枚举最保险
select cron.schedule('market_bot_sweep_material', '2,7,12,17,22,27,32,37,42,47,52,57 * * * *', 'select public.market_bot_sweep_material();');

-- ============================================================
-- 4) 开启 / 调参（服务端配置，改完 1 分钟内对在线玩家生效）
-- ============================================================
-- 🔴 先只开 30 件/天跑几天，看 §5 的"当日注入材料量"再往上加：
insert into public.game_config_overrides (id, config)
values (true, '{"bot": {"enabled": true, "dailyCap": 30, "materialDailyCap": 20, "maxPrice": 10}}'::jsonb)
on conflict (id) do update
  set config = jsonb_set(public.game_config_overrides.config, '{bot}',
        '{"enabled": true, "dailyCap": 30, "materialDailyCap": 20, "maxPrice": 10}'::jsonb),
      updated_at = now();

-- ============================================================
-- 5) 验证 / 观测 / 回滚
-- ============================================================
-- 手动跑一次（返回 1 = 收了一件，0 = 没符合条件的单/配额用完）；注意会真的成交：
--   select public.market_bot_sweep();            -- 装备
--   select public.market_bot_sweep_material();   -- 材料
--
-- 今天收了多少（**调参盯这个**）—— 装备/材料分开看，配额也是分开的：
--   select coalesce(kind, 'equip') as 类型, count(*) as 件数, coalesce(sum(net_qty), 0) as 注入材料量
--     from public.market_bot_sweep_log
--    where created_at >= date_trunc('day', now())
--    group by 1 order by 1;
--
-- 最近几笔明细（看买家名是不是随机昵称、有没有"流浪商人"）：
--   select created_at, buyer_name, item_name, material_type, material_qty, net_qty
--     from public.market_bot_sweep_log order by id desc limit 10;
--
-- 定时任务有没有在跑（应有两条：装备 / 材料）：
--   select jobname, schedule, active from cron.job where jobname like 'market_bot_sweep%';
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
--
-- 关掉（立即生效，前端机器人也会一起停）：
--   update public.game_config_overrides
--      set config = jsonb_set(config, '{bot,enabled}', 'false'::jsonb), updated_at = now()
--    where id = true;
--
-- 彻底回滚：
--   select cron.unschedule('market_bot_sweep');
--   drop function if exists public.market_bot_sweep();
--   drop table if exists public.market_bot_sweep_log;
