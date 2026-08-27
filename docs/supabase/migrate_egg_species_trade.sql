-- ============================================================
-- 宠物蛋按品种化 + 市场交易（增量迁移，只跑一次）
-- 前提：已执行 migrate_pet_egg.sql / migrate_material_trade.sql
-- 用法：Supabase Dashboard → SQL Editor → 整段粘贴 → Run
-- 注意：本文件税率常量【必须】与 js/config.js 的 Config.trade 保持一致（每满 8 收 1）
-- 对应前端：drop.js(蛋按品种/只基础怪掉蛋)、pet.js(定向孵化)、ui-market.js(蛋上架/购买)
-- ============================================================

-- ---------- 1. pet_egg 表加品种列（egg_type = 基础宠名，如'血狐'） ----------
alter table public.pet_egg add column if not exists egg_type text;

-- ---------- 2. 新建蛋挂单表（蛋可上架交易） ----------
create table if not exists public.egg_listings (
  id            uuid primary key default gen_random_uuid(),
  seller_id     text not null,
  egg_type      text not null,
  material_type text,
  material_qty  int  not null default 0,
  status        text not null default 'active' check (status in ('active', 'sold')),
  created_at    timestamptz not null default now()
);
create index if not exists egg_listings_active_idx
  on public.egg_listings (status, created_at desc);

alter table public.egg_listings enable row level security;
drop policy if exists "egg_listings_select_all" on public.egg_listings;
drop policy if exists "egg_listings_insert_own" on public.egg_listings;
drop policy if exists "egg_listings_update_own" on public.egg_listings;
create policy "egg_listings_select_all" on public.egg_listings
  for select to anon, authenticated using (true);
create policy "egg_listings_insert_own" on public.egg_listings
  for insert to authenticated with check (seller_id = auth.uid()::text);
create policy "egg_listings_update_own" on public.egg_listings
  for update to authenticated using (seller_id = auth.uid()::text)
  with check (seller_id = auth.uid()::text);

-- ---------- 3. 上架蛋：扣卖家一颗该品种蛋 + 建挂单 ----------
-- 返回挂单行；蛋不足/未登录返回错误提示
drop function if exists public.list_egg(text, text, int);
create or replace function public.list_egg(p_egg_type text, p_material_type text, p_material_qty int)
returns public.egg_listings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid := auth.uid();
  v_row   public.egg_listings;
  v_del   uuid;
begin
  if v_seller is null then raise exception '请先登录'; end if;
  if p_egg_type is null or p_egg_type = '' then raise exception '缺少蛋品种'; end if;
  if p_material_type is null or p_material_type = '' then raise exception '请选择收什么材料'; end if;
  if not (p_material_qty >= 1) then raise exception '材料数量需为正整数'; end if;

  -- 扣一颗该品种蛋（原子：先锁未孵化蛋）
  select id into v_del from public.pet_egg
  where owner_id = v_seller::text and egg_type = p_egg_type and status = '未孵化'
  for update limit 1;
  if v_del is null then raise exception '没有可上架的该品种蛋'; end if;
  delete from public.pet_egg where id = v_del;

  insert into public.egg_listings (seller_id, egg_type, material_type, material_qty)
  values (v_seller::text, p_egg_type, p_material_type, p_material_qty)
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.list_egg(text, text, int) to authenticated;

-- ---------- 4. 买蛋 RPC（交易+税+给买家蛋+双写记录） ----------
drop function if exists public.buy_egg(uuid);
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

  -- 买家获得一颗该品种蛋
  insert into public.pet_egg (owner_id, egg_type, status) values (v_buyer::text, v_listing.egg_type, '未孵化');
  update public.egg_listings set status = 'sold' where id = p_listing_id;

  insert into public.trade_records (player_id, role, item_name, material_type, price_qty, tax_qty, net_qty)
  values
    (v_buyer::text,             'buy',  v_listing.egg_type || '蛋', v_listing.material_type, v_listing.material_qty, 0,    v_listing.material_qty),
    (v_listing.seller_id::text, 'sell', v_listing.egg_type || '蛋', v_listing.material_type, v_listing.material_qty, v_tax, v_net);

  return 'ok';
end;
$$;
grant execute on function public.buy_egg(uuid) to anon, authenticated;

-- ---------- 5. 取回蛋挂单（撤销自己的 active 挂单，蛋退回） ----------
drop function if exists public.cancel_egg_listing(uuid);
create or replace function public.cancel_egg_listing(p_listing_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.egg_listings%rowtype;
  v_owner   uuid := auth.uid();
begin
  if v_owner is null then return 'nologin'; end if;
  select * into v_listing from public.egg_listings
  where id = p_listing_id and status = 'active' for update;
  if not found then return 'notfound'; end if;
  if v_listing.seller_id::text <> v_owner::text then return 'notowner'; end if;

  update public.egg_listings set status = 'sold' where id = p_listing_id;
  insert into public.pet_egg (owner_id, egg_type, status) values (v_owner::text, v_listing.egg_type, '未孵化');
  return 'ok';
end;
$$;
grant execute on function public.cancel_egg_listing(uuid) to authenticated;
