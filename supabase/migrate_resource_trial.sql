-- ============================================================
-- 资源试炼服务端正式化（2026-09-09）
-- 目的：试炼的成败与奖励由服务器判定并原子发放，客户端只播放结果。
--   · run_id = 客户端每次点击生成的 nonce（uuid），唯一约束挡住重复提交/重放
--   · 扣票走 spend_material（原子），发奖走 add_material（原子）
--   · 结算先插 run 行占位，扣票失败即删除，避免留下幽灵记录
-- 用法：Supabase Dashboard → SQL Editor → 整段执行（幂等，可重复跑）
-- ============================================================

create table if not exists public.resource_trial_runs (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null,
  user_id       uuid not null references auth.users(id) on delete cascade,
  pet_id        uuid,
  route_id      text not null,
  cleared       boolean,
  rounds        jsonb,
  reward        jsonb,
  created_at    timestamptz not null default now()
);

-- 防重复结算的核心：同一个 run_id 只能成功一次
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'resource_trial_runs_run_id_key'
  ) then
    alter table public.resource_trial_runs
      add constraint resource_trial_runs_run_id_key unique (run_id);
  end if;
end $$;

create index if not exists resource_trial_runs_user_idx
  on public.resource_trial_runs (user_id, created_at desc);

alter table public.resource_trial_runs enable row level security;

-- 只可见/可写自己的记录（service_role 不受 RLS 限制，维护脚本仍可查全部）
drop policy if exists "trial_runs_select_own" on public.resource_trial_runs;
create policy "trial_runs_select_own" on public.resource_trial_runs
  for select using (auth.uid() = user_id);

drop policy if exists "trial_runs_insert_own" on public.resource_trial_runs;
create policy "trial_runs_insert_own" on public.resource_trial_runs
  for insert with check (auth.uid() = user_id);

drop policy if exists "trial_runs_update_own" on public.resource_trial_runs;
create policy "trial_runs_update_own" on public.resource_trial_runs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 说明：不开放 delete 策略 —— 扣票失败时由 Edge Function 用
-- service_role / 或同一个已鉴权客户端删除自己刚插入的占位行（update 策略已放行写入结果，
-- 删除占位行走 Edge Function 的客户端请求，RLS 需要 delete 才能删）。
drop policy if exists "trial_runs_delete_own" on public.resource_trial_runs;
create policy "trial_runs_delete_own" on public.resource_trial_runs
  for delete using (auth.uid() = user_id);
