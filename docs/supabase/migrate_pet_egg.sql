-- ============================================================
-- 宠物蛋持久化：pet_egg 表（增量迁移，只跑一次）
-- 对应《游戏数据地图 v1》实体 8 pet_egg：id / owner_id / status / pet_id / created_at
-- 用法：Supabase Dashboard → SQL Editor → 整段粘贴 → Run
-- ============================================================

create table if not exists public.pet_egg (
  id         uuid primary key default gen_random_uuid(),
  owner_id   text not null,
  egg_type   text,
  status     text not null default '未孵化' check (status in ('未孵化', '已孵化')),
  pet_id     uuid,
  created_at timestamptz not null default now()
);

-- 兼容已创建过旧表的数据库：补齐品种列，否则掉蛋 insert 会失败且刷新后丢失
alter table public.pet_egg add column if not exists egg_type text;

create index if not exists pet_egg_owner_idx
  on public.pet_egg (owner_id, status, created_at);

alter table public.pet_egg enable row level security;
drop policy if exists "pet_egg_open_all" on public.pet_egg;
drop policy if exists "pet_egg_select_own" on public.pet_egg;
drop policy if exists "pet_egg_insert_own" on public.pet_egg;
drop policy if exists "pet_egg_update_own" on public.pet_egg;
create policy "pet_egg_select_own" on public.pet_egg
  for select to authenticated using (owner_id = auth.uid()::text);
create policy "pet_egg_insert_own" on public.pet_egg
  for insert to authenticated with check (owner_id = auth.uid()::text);
create policy "pet_egg_update_own" on public.pet_egg
  for update to authenticated using (owner_id = auth.uid()::text)
  with check (owner_id = auth.uid()::text);
