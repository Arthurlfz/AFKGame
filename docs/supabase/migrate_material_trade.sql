-- ============================================================
-- 交易市场改造：材料计价 + 交易税 + 交易记录（增量迁移，只跑一次）
-- 前提：已有 pet_listings / equip_listings / materials / pets / equip_items 表
-- 用法：Supabase Dashboard → SQL Editor → 整段粘贴 → Run
-- 注意：本文件的税率常量【必须】与 js/config.js 的 Config.trade 保持一致
-- ============================================================

-- ---------- 1. materials 表 (user_id, name) 唯一约束 ----------
-- 加卖家材料要用 upsert 累加，必须有唯一约束。表当前为空，直接加安全。
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'materials_user_name_uniq') then
    alter table public.materials add constraint materials_user_name_uniq unique (user_id, name);
  end if;
exception when others then
  raise notice 'materials 唯一约束添加失败：%', SQLERRM;
end $$;

-- ---------- 2. 挂单表加材料列（price 列保留不再使用，旧单显示为「旧版挂单」） ----------
alter table public.pet_listings   add column if not exists material_type text;
alter table public.pet_listings   add column if not exists material_qty  int not null default 0;
alter table public.equip_listings add column if not exists material_type text;
alter table public.equip_listings add column if not exists material_qty  int not null default 0;

-- 旧 price 列改为默认 0：上架不再写通货价格，否则 not null 约束报
-- "null value in column price violates not-null constraint"
-- 已跑过本文件的库，单独执行下面这两条即可（重跑整份文件也安全）
alter table public.pet_listings   alter column price set default 0;
alter table public.equip_listings alter column price set default 0;

-- ---------- 3. 交易记录表 ----------
-- price_qty = 标价材料数量；tax_qty = 扣税数量（买入为 0）；net_qty = 卖家实收 / 买家实付
create table if not exists public.trade_records (
  id            uuid primary key default gen_random_uuid(),
  player_id     text not null,
  role          text not null check (role in ('buy', 'sell')),
  item_name     text not null,
  material_type text not null,
  price_qty     int  not null,
  tax_qty       int  not null default 0,
  net_qty       int  not null,
  created_at    timestamptz not null default now()
);
create index if not exists trade_records_player_idx
  on public.trade_records (player_id, created_at desc);

alter table public.trade_records enable row level security;
drop policy if exists "trade_records_open_all" on public.trade_records;
create policy "trade_records_open_all" on public.trade_records
  for all to anon, authenticated using (true) with check (true);

-- ---------- 4. 重写 buy_pet：材料支付 + 税 + 归属转移 + 双写记录 ----------
-- 买家 = auth.uid()（登录才能买）；返回 'ok' | 'nologin' | 'notfound' | 'self' | 'insufficient'
drop function if exists public.buy_pet(uuid);
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

  -- 交易税：每满 taxPer 个材料收 taxAmount 个（taxPer=8, taxAmount=1，与 config.js 同步）
  v_tax := floor(v_listing.material_qty / 8) * 1;
  v_net := v_listing.material_qty - v_tax;

  -- 扣买家材料（原子，防超扣；不足返回 insufficient）
  update public.materials set quantity = quantity - v_listing.material_qty
  where user_id = v_buyer and name = v_listing.material_type
    and quantity >= v_listing.material_qty;
  if not found then return 'insufficient'; end if;

  -- 加卖家材料（upsert 累加）
  insert into public.materials (user_id, name, quantity)
  values (v_listing.seller_id, v_listing.material_type, v_net)
  on conflict (user_id, name) do update
    set quantity = public.materials.quantity + excluded.quantity;

  -- 转移归属 + 标记售出
  update public.pets set user_id = v_buyer where id = v_listing.pet_id;
  update public.pet_listings set status = 'sold' where id = p_listing_id;

  -- 双写交易记录（买家=buy 实付=标价；卖家=sell 实收=标价-税）
  insert into public.trade_records (player_id, role, item_name, material_type, price_qty, tax_qty, net_qty)
  values
    (v_buyer::text,             'buy',  v_listing.pet_name, v_listing.material_type, v_listing.material_qty, 0,    v_listing.material_qty),
    (v_listing.seller_id::text, 'sell', v_listing.pet_name, v_listing.material_type, v_listing.material_qty, v_tax, v_net);

  return 'ok';
end;
$$;
grant execute on function public.buy_pet(uuid) to anon, authenticated;

-- ---------- 5. 重写 buy_equip：同上（装备版） ----------
drop function if exists public.buy_equip(uuid);
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

  insert into public.trade_records (player_id, role, item_name, material_type, price_qty, tax_qty, net_qty)
  values
    (v_buyer::text,             'buy',  v_listing.item_name, v_listing.material_type, v_listing.material_qty, 0,    v_listing.material_qty),
    (v_listing.seller_id::text, 'sell', v_listing.item_name, v_listing.material_type, v_listing.material_qty, v_tax, v_net);

  return 'ok';
end;
$$;
grant execute on function public.buy_equip(uuid) to anon, authenticated;
