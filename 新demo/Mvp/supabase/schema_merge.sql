-- ============================================================
-- 宠物融合（成长值吸收）：材料消耗 RPC
-- 在 Supabase SQL Editor 执行（追加迁移，幂等）
-- 融合规则：A 成长 = A 成长 + B 成长 × 0.5，消耗 1 只涅磐兽
-- 涅磐兽消耗用「原子减」：余额不足返回 false，防超扣
-- ============================================================

-- 消耗材料：quantity 减 p_amount，余额不足不动、返回 false
create or replace function public.spend_material(p_name text, p_amount integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return false; end if;
  if p_amount is null or p_amount <= 0 then return false; end if;
  update public.materials
  set quantity = quantity - p_amount
  where user_id = auth.uid() and name = p_name and quantity >= p_amount;
  return found;
end;
$$;

grant execute on function public.spend_material(text, integer) to authenticated;
