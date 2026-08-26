-- ============================================================
-- materials 表：玩家材料（当前仅「涅磐兽」一种，结构通用）
-- 用途：以后用于宠物融合（本次不做融合逻辑）
-- 字段：id / user_id / name / quantity / created_at
-- 唯一约束 (user_id, name)：同一玩家同一材料只有一行，掉落时 RPC 原子累加
-- 注意：本表名与 trade-market 的表无冲突（materials 从未被占用）
-- ============================================================

create table if not exists public.materials (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  quantity   integer not null default 1,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.materials enable row level security;

-- 行级安全：玩家只能读写自己的材料
create policy "materials_select_own" on public.materials
  for select using (auth.uid() = user_id);
create policy "materials_insert_own" on public.materials
  for insert with check (auth.uid() = user_id);
create policy "materials_update_own" on public.materials
  for update using (auth.uid() = user_id);
create policy "materials_delete_own" on public.materials
  for delete using (auth.uid() = user_id);

-- 原子累加 RPC：掉落材料时 +p_amount（防并发重复写；归属取 auth.uid()）
-- 调用：select add_material('涅磐兽', 1);
create or replace function public.add_material(p_name text, p_amount integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  insert into public.materials (user_id, name, quantity)
  values (auth.uid(), p_name, p_amount)
  on conflict (user_id, name)
  do update set quantity = materials.quantity + excluded.quantity;
end;
$$;

grant execute on function public.add_material(text, integer) to authenticated;
grant execute on function public.add_material(text, integer) to anon;
