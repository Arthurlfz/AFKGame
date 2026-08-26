-- ============================================================
-- 挂单取回（下架）：宠物 + 装备
-- 在 Supabase SQL Editor 执行（追加迁移，幂等）
-- 只允许撤销「自己的」且「在售中」的挂单；已售出无法取回
-- ============================================================

-- 宠物挂单取回
create or replace function public.cancel_pet_listing(p_listing_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return false; end if;
  delete from public.pet_listings
  where id = p_listing_id and seller_id = auth.uid() and status = 'active';
  return found;
end;
$$;

grant execute on function public.cancel_pet_listing(uuid) to authenticated;

-- 装备挂单取回
create or replace function public.cancel_equip_listing(p_listing_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return false; end if;
  delete from public.equip_listings
  where id = p_listing_id and seller_id = auth.uid() and status = 'active';
  return found;
end;
$$;

grant execute on function public.cancel_equip_listing(uuid) to authenticated;
