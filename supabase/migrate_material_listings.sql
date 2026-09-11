-- ============================================================
-- 材料挂单交易 —— 玩家之间以物易物买卖材料（万物皆可交易）
-- 前提：已执行 migrate_material_trade.sql（materials 唯一约束） / migrate_trade_records_ref.sql
-- 用法：Supabase Dashboard → SQL Editor → 整段粘贴 → Run
-- 注意：本文件税率常量【必须】与 docs/js/core/config.js 的 Config.trade 保持一致（每满 8 收 1）
-- 对应前端：js/core/market.js / js/core/supabase.js / js/ui/ui-market.js / js/ui/ui-market-sell.js
--
-- 🔴 【仅 list/buy/cancel_material 可重放，bot_buy_material 禁止】
--    2026-09-11 审计实测确认：本文件里的 bot_buy_material **没有**任何守卫
--    （anon 直调返回 200 "notfound"，而不是 ERR_BOT_BUY_ANON）——
--    玩家可自己挂单自己召唤商人，无限把垃圾材料换成稀缺材料。
--    带守卫的版本在 supabase/migrate_security_reapply.sql，以那份为准。
--    其余三个函数（list_material / buy_material / cancel_material_listing）未受影响。
--
-- 背景（2026-09-10）：
--   此前材料只能由 AI 假卖家挂单，玩家**只能买不能卖** —— 通天塔/守关 Boss/委托打出来的
--   高价值材料（至尊神石、腐印…）在交易行里根本没有出口。
--   本表让玩家材料也能上架，走与宠物/装备/蛋完全相同的「材料计价 + 每满 8 收 1」规则。
-- 语义：good_qty 份 good_name  ←→  material_qty 份 material_type（买家付，卖家收 net = 标价 − 税）
--
-- ⚠️ 类型口径（血泪，2026-09-10 实测踩中两个 42883/42804）：
--   materials.user_id 是 uuid；本表 seller_id 必须也是 **uuid**。
--   若照抄 egg_listings 的 text，会在 `v_listing.seller_id = v_buyer`（无 text = uuid 操作符）
--   和 `insert into materials ... values (text变量)`（无法隐式转 uuid）两处直接抛错。
--   pet_listings / equip_listings 都是 uuid，本表与它们对齐。
-- ============================================================

-- ---------- 1. 材料挂单表 ----------
create table if not exists public.material_listings (
  id            uuid primary key default gen_random_uuid(),
  seller_id     uuid not null,
  good_name     text not null,               -- 卖的是什么材料（materials.name）
  good_qty      int  not null check (good_qty > 0),
  material_type text not null,               -- 收什么材料
  material_qty  int  not null check (material_qty > 0),
  status        text not null default 'active' check (status in ('active', 'sold')),
  created_at    timestamptz not null default now()
);
create index if not exists material_listings_active_idx
  on public.material_listings (status, created_at desc);
create index if not exists material_listings_seller_idx
  on public.material_listings (seller_id, status);

comment on table public.material_listings is
  '玩家材料挂单：good_qty 份 good_name 换 material_qty 份 material_type；取回也置 sold（与 egg_listings 同口径）';

alter table public.material_listings enable row level security;
drop policy if exists "material_listings_select_all" on public.material_listings;
drop policy if exists "material_listings_insert_own" on public.material_listings;
drop policy if exists "material_listings_update_own" on public.material_listings;
create policy "material_listings_select_all" on public.material_listings
  for select to anon, authenticated using (true);
create policy "material_listings_insert_own" on public.material_listings
  for insert to authenticated with check (seller_id = auth.uid());
create policy "material_listings_update_own" on public.material_listings
  for update to authenticated using (seller_id = auth.uid())
  with check (seller_id = auth.uid());

-- ---------- 2. 上架：扣卖家商品材料（原子）→ 建挂单 ----------
drop function if exists public.list_material(text, int, text, int);
create or replace function public.list_material(
  p_good text, p_good_qty int, p_material_type text, p_material_qty int
)
returns public.material_listings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid := auth.uid();
  v_row    public.material_listings;
begin
  if v_seller is null then raise exception '请先登录'; end if;
  if p_good is null or p_good = '' then raise exception '请选择要卖的材料'; end if;
  if p_material_type is null or p_material_type = '' then raise exception '请选择收什么材料'; end if;
  if p_good_qty is null or p_good_qty < 1 or p_good_qty > 9999 then raise exception '出售数量不合法'; end if;
  if p_material_qty is null or p_material_qty < 1 or p_material_qty > 9999 then raise exception '标价不合法'; end if;

  -- 扣库存（条件更新：余额不足 not found → 整单失败，不会出现"挂了单但材料还在"）
  update public.materials set quantity = quantity - p_good_qty
  where user_id = v_seller and name = p_good and quantity >= p_good_qty;
  if not found then
    raise exception '材料不足：需要 % 份「%」', p_good_qty, p_good;
  end if;

  insert into public.material_listings (seller_id, good_name, good_qty, material_type, material_qty)
  values (v_seller, p_good, p_good_qty, p_material_type, p_material_qty)
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.list_material(text, int, text, int) to authenticated;

-- ---------- 3. 购买：买家付收款材料 → 拿到货 → 卖家收 net → 标记 sold → 双写记录 ----------
drop function if exists public.buy_material(uuid);
create or replace function public.buy_material(p_listing_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.material_listings%rowtype;
  v_buyer   uuid := auth.uid();
  v_tax     int;
  v_net     int;
  v_item    text;
begin
  if v_buyer is null then return 'nologin'; end if;

  select * into v_listing from public.material_listings
  where id = p_listing_id and status = 'active'
  for update;
  if not found then return 'notfound'; end if;

  if v_listing.seller_id = v_buyer then return 'self'; end if;

  v_tax := floor(v_listing.material_qty / 8) * 1;
  v_net := v_listing.material_qty - v_tax;

  -- 扣买家收款材料（原子：余额不足 → insufficient）
  update public.materials set quantity = quantity - v_listing.material_qty
  where user_id = v_buyer and name = v_listing.material_type
    and quantity >= v_listing.material_qty;
  if not found then return 'insufficient'; end if;

  -- 卖家收 net（标价 1~7 时税为 0，实收 = 标价）
  insert into public.materials (user_id, name, quantity)
  values (v_listing.seller_id, v_listing.material_type, v_net)
  on conflict (user_id, name) do update
    set quantity = public.materials.quantity + excluded.quantity;

  -- 买家拿货
  insert into public.materials (user_id, name, quantity)
  values (v_buyer, v_listing.good_name, v_listing.good_qty)
  on conflict (user_id, name) do update
    set quantity = public.materials.quantity + excluded.quantity;

  update public.material_listings set status = 'sold' where id = p_listing_id;

  v_item := v_listing.good_name || ' ×' || v_listing.good_qty;
  insert into public.trade_records
    (player_id, role, item_name, material_type, price_qty, tax_qty, net_qty, listing_id, counterparty)
  values
    (v_buyer::text,             'buy',  v_item, v_listing.material_type, v_listing.material_qty, 0,    v_listing.material_qty, p_listing_id, v_listing.seller_id::text),
    (v_listing.seller_id::text, 'sell', v_item, v_listing.material_type, v_listing.material_qty, v_tax, v_net,                 p_listing_id, v_buyer::text);

  return 'ok';
end;
$$;
grant execute on function public.buy_material(uuid) to anon, authenticated;

-- ---------- 4. 取回：撤销自己的 active 挂单，材料退回 ----------
drop function if exists public.cancel_material_listing(uuid);
create or replace function public.cancel_material_listing(p_listing_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.material_listings%rowtype;
  v_owner   uuid := auth.uid();
begin
  if v_owner is null then return 'nologin'; end if;
  select * into v_listing from public.material_listings
  where id = p_listing_id and status = 'active' for update;
  if not found then return 'notfound'; end if;
  if v_listing.seller_id <> v_owner then return 'notowner'; end if;

  insert into public.materials (user_id, name, quantity)
  values (v_owner, v_listing.good_name, v_listing.good_qty)
  on conflict (user_id, name) do update
    set quantity = public.materials.quantity + excluded.quantity;

  update public.material_listings set status = 'sold' where id = p_listing_id;
  return 'ok';
end;
$$;
grant execute on function public.cancel_material_listing(uuid) to authenticated;

-- ---------- 5. 假买家（流浪商人）收购玩家材料挂单 ----------
-- 与 bot_buy_equip 同口径：卖家收 net，货物离场（挂单置 sold，不做库存回流 → 天然 sink）。
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
  select * into v_listing from public.material_listings
  where id = p_listing_id and status = 'active'
  for update;
  if not found then return 'notfound'; end if;

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

  update public.material_listings set status = 'sold' where id = p_listing_id;
  return 'ok';
end;
$$;
grant execute on function public.bot_buy_material(uuid) to anon, authenticated;
