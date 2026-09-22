-- ============================================================
-- 副本「每日免费次数」服务端记账（2026-09-23）
-- 目的：免费次数以前只存在客户端 localStorage，服务端无条件扣 1 张门票
--       ⇒ 副本服务端权威化后，玩家的免费那一次会被白扣。
--       现在由服务端按「当天 该玩家 该路线 已跑几局」判定：没超过免费额度就不扣票。
-- 用法：Supabase Dashboard → SQL Editor → 整段执行（幂等，可重复跑）
-- ============================================================

alter table public.resource_trial_runs
  add column if not exists used_free boolean;

comment on column public.resource_trial_runs.used_free is
  '本次是否走的每日免费次数（true=没扣门票）。免费额度由 resource-trial EF 按当天已跑局数判定。';

-- 判免费额度的查询形态：where user_id=? and route_id=? and created_at >= 当日 12:00(北京) 的 UTC 时刻
-- 现成索引 (user_id, created_at desc) 已覆盖；这里补一条带 route_id 的，避免每条路线都回表过滤。
create index if not exists resource_trial_runs_route_idx
  on public.resource_trial_runs (user_id, route_id, created_at desc);
