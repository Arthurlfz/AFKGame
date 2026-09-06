-- ============================================================
-- migrate_god_pet.sql —— 神级宠系统 + 5 阶进化（2026-09-06）
-- 依据：《系统重设计·落地执行手册_v1》2.5 / 2.6 / 2.7
-- 内容：
--   1. pets 表加 evolve_stage（进化阶段 1~5）、is_god_pet（神级宠标记）
--      —— 客户端 PET_EXTRA_COLS 已带缺列降级：没跑本迁移的旧库照常工作，只是不持久化这两列
--   2. 存量数据迁移：evolve_stage = evolve_times + 1（钳 1~5）；名字是神级宠的置 is_god_pet
--   3. 服务端校验 RPC（手册 6.4：关键校验必须在服务器端也做一遍）：
--        check_god_synth(p_main jsonb, p_sub jsonb)  合成神级宠：双方都终阶 + 成长≥60
--        check_nirvana(p_pet jsonb)                  涅槃：必须是神级宠
-- ⚠️ 执行前先备份 pets 表（手册 6.4：禁止不备份就跑 migration）
-- ============================================================

-- 1. 加列（幂等）
alter table public.pets add column if not exists evolve_stage int not null default 1;
alter table public.pets add column if not exists is_god_pet boolean not null default false;

-- 1b. 放宽 growth 约束（2026-09-06 补）：原 check 只允许 1~20，而神级宠门槛就是成长 60、
--     涅槃长线上限 100 —— 不放宽的话成长堆到 20 就写库失败（insert/update 报 23514）。
--     与 config.nirvana.maxGrowth=100 对齐。
alter table public.pets drop constraint if exists pets_growth_ck;
alter table public.pets add constraint pets_growth_ck check (growth >= 1 and growth <= 100);

-- 2. 存量数据迁移（手册：旧进化次数映射到新阶段 1~5）
--    旧规则 evolve_times 0~10 → 新阶段 = times+1 钳 1~5
update public.pets
   set evolve_stage = least(5, greatest(1, coalesce(evolve_times, 0) + 1))
 where evolve_stage is null or evolve_stage = 1;

-- 神级宠名字单（与 docs/js/core/config.js pet.godPets.list 严格一致）
update public.pets set is_god_pet = true
 where name in ('腐界母神','血月神狐','疫神巨像','万刺冥神','骸骨神狼','毒渊神蟾','狱门神犬','霜月神兔');

-- 3. 服务端校验 RPC（防客户端作弊）
-- 合成神级宠门槛：主宠与副宠都终阶（evolve_stage ≥ 5）且成长 ≥ 60
create or replace function public.check_god_synth(p_main jsonb, p_sub jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_min_growth int := 60;   -- 与 config.pet.godPets.minGrowth 保持一致（改 config 时同步这里）
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'nologin');
  end if;
  if coalesce((p_main->>'evolve_stage')::int, 1) < 5
     or coalesce((p_sub->>'evolve_stage')::int, 1) < 5 then
    return jsonb_build_object('ok', false, 'code', 'not_final_stage');
  end if;
  if coalesce((p_main->>'growth')::numeric, 0) < v_min_growth
     or coalesce((p_sub->>'growth')::numeric, 0) < v_min_growth then
    return jsonb_build_object('ok', false, 'code', 'growth_too_low');
  end if;
  return jsonb_build_object('ok', true, 'code', null);
end $$;

-- 涅槃门槛：必须是神级宠（is_god_pet = true）
create or replace function public.check_nirvana(p_pet jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'nologin');
  end if;
  -- 客户端传参不可信：以库里的真实行做权威判断
  if coalesce((p_pet->>'cloud_id'), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'no_pet');
  end if;
  if not exists (
    select 1 from public.pets
     where id = (p_pet->>'cloud_id')::uuid
       and user_id = v_uid
       and is_god_pet = true
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_god_pet');
  end if;
  return jsonb_build_object('ok', true, 'code', null);
end $$;

grant execute on function public.check_god_synth(jsonb, jsonb) to authenticated;
grant execute on function public.check_nirvana(jsonb) to authenticated;
revoke execute on function public.check_god_synth(jsonb, jsonb) from anon;
revoke execute on function public.check_nirvana(jsonb) from anon;
