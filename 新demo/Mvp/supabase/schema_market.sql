-- ============================================================
-- 宠物交易 · 市场表 + 购买事务
-- 在 Supabase Dashboard → SQL Editor 执行（需先执行过 schema_pets.sql）
-- ============================================================

-- 1. 宠物挂单表（快照卖家宠物信息，市场列表无需 join pets 表）
create table if not exists public.pet_listings (
  id         uuid primary key default gen_random_uuid(),
  pet_id     uuid not null references public.pets(id) on delete cascade,
  seller_id  uuid not null references auth.users(id) on delete cascade,
  price      integer not null check (price >= 0),
  status     text not null default 'active' check (status in ('active', 'sold')),
  -- 展示快照（上架时定格，防止 RLS 读不到别人宠物）
  pet_name   text not null,
  pet_growth numeric not null,
  pet_level  integer not null,
  created_at timestamptz not null default now()
);

-- 同一只宠物同一时间只能有一个「在售」挂单
create unique index if not exists pet_listings_active_unique
  on public.pet_listings (pet_id) where status = 'active';

alter table public.pet_listings enable row level security;
-- 市场对所有人可见；挂单只能自己挂；状态变更走下方 RPC（不开放直接改）
create policy "pl_select_all" on public.pet_listings for select using (true);
create policy "pl_insert_own" on public.pet_listings for insert with check (auth.uid() = seller_id);

-- 2. 购买事务：校验在售 → 转移宠物归属 → 标记 sold（防并发双买）
create or replace function public.buy_pet(p_listing_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_pet_id  uuid;
  v_seller  uuid;
begin
  if auth.uid() is null then return false; end if;

  -- 行锁锁定在售挂单
  select pet_id, seller_id into v_pet_id, v_seller
  from public.pet_listings
  where id = p_listing_id and status = 'active'
  for update;

  if not found then return false; end if;   -- 不存在或已售出
  if v_seller = auth.uid() then return false; end if; -- 不能买自己的

  update public.pets set user_id = auth.uid() where id = v_pet_id;
  update public.pet_listings set status = 'sold' where id = p_listing_id;

  return true;
end;
$$;

-- ============================================================
-- 3. 流浪商人（系统假买家）收购玩家挂单 —— 玩家「卖出」的唯一真实通道
--    规则（与 config.js 的 marketBot.buyer 同步）：
--      每满 taxPer(8) 个材料收 taxAmount(1) 个交易税（税由卖家承担）
--      卖家到账 = 标价 - 税
--      双写 trade_records（买家=「流浪商人」NPC，卖家记 sell）
--    注：buy_pet/buy_equip（玩家买玩家）是历史残留空壳，实际交易走本函数。
-- ============================================================

-- 收购宠物：锁单 → 算税 → 卖家到账 → 双写记录 → 删除宠物（级联删挂单）
create or replace function public.bot_buy_pet(p_listing_id uuid)
returns text
language plpgsql security definer set search_path = public
as $function$
declare
  v_listing public.pet_listings%rowtype;
  v_tax int;
  v_net int;
begin
  select * into v_listing from public.pet_listings
  where id = p_listing_id and status = 'active'
  for update;
  if not found then return 'notfound'; end if;

  -- 交易税：每满 taxPer 个材料收 taxAmount 个
  v_tax := floor(v_listing.material_qty / 8) * 1;
  v_net := v_listing.material_qty - v_tax;

  -- 卖家材料到账（upsert 累加）
  insert into public.materials (user_id, name, quantity)
  values (v_listing.seller_id, v_listing.material_type, v_net)
  on conflict (user_id, name) do update
    set quantity = public.materials.quantity + excluded.quantity;

  -- 双写交易记录
  insert into public.trade_records (player_id, role, item_name, material_type, price_qty, tax_qty, net_qty)
  values
    ('流浪商人', 'buy', v_listing.pet_name, v_listing.material_type, v_listing.material_qty, 0, v_listing.material_qty),
    (v_listing.seller_id::text, 'sell', v_listing.pet_name, v_listing.material_type, v_listing.material_qty, v_tax, v_net);

  -- 宠物被流浪商人买走：删除宠物行（pet_listings 外键 on delete cascade 一并删挂单）
  delete from public.pets where id = v_listing.pet_id;

  return 'ok';
end;
$function$;

-- 收购装备：锁单 → 算税 → 卖家到账 → 双写记录 → 删除装备（级联删挂单）
create or replace function public.bot_buy_equip(p_listing_id uuid)
returns text
language plpgsql security definer set search_path = public
as $function$
declare
  v_listing public.equip_listings%rowtype;
  v_tax int;
  v_net int;
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
    ('流浪商人', 'buy', v_listing.item_name, v_listing.material_type, v_listing.material_qty, 0, v_listing.material_qty),
    (v_listing.seller_id::text, 'sell', v_listing.item_name, v_listing.material_type, v_listing.material_qty, v_tax, v_net);

  delete from public.equip_items where id = v_listing.item_id;

  return 'ok';
end;
$function$;

grant execute on function public.bot_buy_pet(uuid) to authenticated;
grant execute on function public.bot_buy_pet(uuid) to anon;
grant execute on function public.bot_buy_equip(uuid) to authenticated;
grant execute on function public.bot_buy_equip(uuid) to anon;
