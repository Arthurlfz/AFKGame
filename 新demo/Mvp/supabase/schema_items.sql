-- ============================================================
-- 装备存档 + 装备交易（表名用 equip_items / equip_listings，
-- 避免与 trade-market 项目已有的 items 表冲突）
-- 在 Supabase Dashboard → SQL Editor 执行（需先执行 schema_pets.sql / schema_market.sql）
-- ============================================================

-- 1. 装备表（玩家拥有的装备）
create table if not exists public.equip_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  slot       text not null,          -- 武器 / 防具 / 饰品
  base_stat  jsonb not null,         -- { type, label, value }
  affixes    jsonb not null default '[]',  -- [{ type, label, value }, ...]
  tier       integer not null default 4,   -- T1 最高
  rarity     text not null default 'white', -- white / blue / gold
  created_at timestamptz not null default now()
);

alter table public.equip_items enable row level security;
create policy "equip_items_select_own" on public.equip_items for select using (auth.uid() = user_id);
create policy "equip_items_insert_own" on public.equip_items for insert with check (auth.uid() = user_id);
create policy "equip_items_update_own" on public.equip_items for update using (auth.uid() = user_id);
create policy "equip_items_delete_own" on public.equip_items for delete using (auth.uid() = user_id);

-- 2. 装备挂单表（快照展示信息，市场列表无需 join）
create table if not exists public.equip_listings (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references public.equip_items(id) on delete cascade,
  seller_id    uuid not null references auth.users(id) on delete cascade,
  price        integer not null check (price >= 0),
  status       text not null default 'active' check (status in ('active', 'sold')),
  -- 展示快照
  item_name    text not null,
  item_slot    text not null,
  item_rarity  text not null,
  item_tier    integer not null,
  item_affixes jsonb not null default '[]',
  created_at   timestamptz not null default now()
);

create unique index if not exists equip_listings_active_unique
  on public.equip_listings (item_id) where status = 'active';

alter table public.equip_listings enable row level security;
create policy "el_select_all" on public.equip_listings for select using (true);
create policy "el_insert_own" on public.equip_listings for insert with check (auth.uid() = seller_id);

-- 3. 购买事务：校验在售 → 转移装备归属 → 标记 sold（防并发双买）
create or replace function public.buy_equip(p_listing_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_item_id uuid;
  v_seller  uuid;
begin
  if auth.uid() is null then return false; end if;

  select item_id, seller_id into v_item_id, v_seller
  from public.equip_listings
  where id = p_listing_id and status = 'active'
  for update;

  if not found then return false; end if;
  if v_seller = auth.uid() then return false; end if;

  update public.equip_items set user_id = auth.uid() where id = v_item_id;
  update public.equip_listings set status = 'sold' where id = p_listing_id;

  return true;
end;
$$;
