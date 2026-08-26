-- ============================================================
-- 宠物养成循环原型 · 宠物存档表
-- 在 Supabase Dashboard → SQL Editor 里执行一次即可
-- 字段：id / user_id / name / growth / level / hp / attack / defense / speed
--       （另加 icon 表情、cur_hp 当前血量、created_at，用于完整还原宠物）
-- ============================================================

create table if not exists public.pets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  icon       text not null default '🟢',
  growth     numeric not null default 5,
  level      integer not null default 1,
  hp         integer not null,   -- 基础生命
  attack     integer not null,   -- 基础攻击
  defense    integer not null,   -- 基础防御
  speed      integer not null,   -- 基础速度
  cur_hp     integer not null,   -- 当前血量（跨场延续用）
  created_at timestamptz not null default now()
);

-- 行级安全：每个玩家只能读写自己的宠物
alter table public.pets enable row level security;

create policy "pets_select_own" on public.pets
  for select using (auth.uid() = user_id);
create policy "pets_insert_own" on public.pets
  for insert with check (auth.uid() = user_id);
create policy "pets_update_own" on public.pets
  for update using (auth.uid() = user_id);
create policy "pets_delete_own" on public.pets
  for delete using (auth.uid() = user_id);
