-- ============================================================
-- 玩家档案表 profiles
-- 幂等，可重复执行；已在 Supabase 执行过（2026-08-29，通过集成直接应用）。
--
-- 背景：
--   之前游戏没有「玩家档案」这一层，显示名只能把邮箱前缀切出来
--   （getMyDisplayName：12311@qq.com → 12311），昵称 / 头像 / 封禁 / 最后在线都无处可放。
--
-- 建成后：
--   1. 注册自动生成档案（触发器 handle_new_user），昵称默认取邮箱前缀
--   2. 迁移前已注册的账号会自动补一份档案（下面的 insert，幂等）
--   3. 将来改名 / 头像框 / 封号 / 昵称系统都挂在这张表
--
-- 设计取舍（自测阶段）：
--   - nickname 不设唯一约束：身份靠 profiles.id（= auth.uid()）区分，昵称只是显示层。
--     等有真实玩家量、要做「昵称抢注」时再考虑唯一 + 付费改名。
--   - select 对所有人开放：聊天 / 市场要看别人的显示名。
--   - update 只允许改自己。
-- ============================================================

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  nickname     text,                        -- 显示名（自测阶段允许重名，身份靠 id 区分）
  avatar_url   text,                        -- 头像（将来卖头像框用）
  invite_code  text,                        -- 注册时填的邀请码
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,                 -- 最后在线（做日活/回归奖励用）
  banned       boolean not null default false,
  ban_reason   text
);

create index if not exists profiles_nickname_idx on public.profiles (nickname);

alter table public.profiles enable row level security;
-- 所有人可读（聊天/市场要看别人的显示名）
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles
  for select to anon, authenticated using (true);
-- 只能改自己的档案
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- 注册自动建档案：昵称默认取邮箱前缀（如 12311@qq.com → 12311）
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, split_part(coalesce(new.email, ''), '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 给迁移前已注册的账号补一份档案（幂等，重复跑不会覆盖已有昵称）
insert into public.profiles (id, nickname)
select u.id, split_part(coalesce(u.email, ''), '@', 1)
from auth.users u
on conflict (id) do nothing;
