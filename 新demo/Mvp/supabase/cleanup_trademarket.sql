-- ============================================================
-- 清理：误执行旧 schema_items.sql 对 trade-market 造成的副作用
-- 1) 删除误加在 items 表上的 4 个 RLS 策略（原策略 items_open_all 保留）
-- 2) 删除误建的单参 buy_item(uuid)（当前原型已改用 buy_equip，不受影响）
-- 3) 删除孤儿表 item_listings（当前原型已改用 equip_listings）
-- 4) 恢复 trade-market 原版 buy_item(p_listing_id uuid, p_buyer_id text)
-- 用法：Supabase SQL Editor → 整段粘贴 → Run
-- ============================================================

-- 1. 删除误加的 RLS 策略
drop policy if exists items_select_own on public.items;
drop policy if exists items_insert_own on public.items;
drop policy if exists items_update_own on public.items;
drop policy if exists items_delete_own on public.items;

-- 2. 删除误建的单参 buy_item（当前原型用 buy_equip，不受影响）
drop function if exists public.buy_item(uuid);

-- 3. 删除孤儿表 item_listings（当前原型用 equip_listings）
drop table if exists public.item_listings;

-- 4. 恢复 trade-market 原版 buy_item（钱包版：扣买家加卖家 + 双方交易记录）
drop function if exists public.buy_item(uuid, text);
create or replace function public.buy_item(p_listing_id uuid, p_buyer_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price      numeric;
  v_seller     text;
  v_item_id    uuid;
  v_item_name  text;
  v_buyer_bal  numeric;
  v_seller_bal numeric;
begin
  -- 锁定在售挂单，防并发双买
  select l.price, l.seller_id, l.item_id, i.name
    into v_price, v_seller, v_item_id, v_item_name
  from public.listings l
  join public.items i on i.id = l.item_id
  where l.id = p_listing_id and l.status = 'active'
  for update of l;

  if not found then
    return false;  -- 不存在或已售出
  end if;

  if v_seller = p_buyer_id then
    return false;  -- 不能买自己挂的单
  end if;

  -- 确保双方钱包存在（首次访问各给 1000）
  insert into public.wallets (player_id, balance)
  values (p_buyer_id, 1000), (v_seller, 1000)
  on conflict (player_id) do nothing;

  select balance into v_buyer_bal  from public.wallets where player_id = p_buyer_id for update;
  select balance into v_seller_bal from public.wallets where player_id = v_seller    for update;

  if v_buyer_bal < v_price then
    return false;  -- 余额不足
  end if;

  -- 扣买家、加卖家
  update public.wallets set balance = v_buyer_bal  - v_price, updated_at = now() where player_id = p_buyer_id;
  update public.wallets set balance = v_seller_bal + v_price, updated_at = now() where player_id = v_seller;

  -- 转移物品、标记挂单
  update public.items    set owner_id = p_buyer_id where id = v_item_id;
  update public.listings set status   = 'sold'      where id = p_listing_id;

  -- 双方各写一条交易记录（买家=买，卖家=卖）
  insert into public.transactions (player_id, type, item_name, price, balance_after)
  values
    (p_buyer_id, 'buy',  v_item_name, v_price, v_buyer_bal  - v_price),
    (v_seller,   'sell', v_item_name, v_price, v_seller_bal + v_price);

  return true;
end;
$$;

grant execute on function public.buy_item(uuid, text) to anon, authenticated;
