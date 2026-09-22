-- ============================================================
-- migrate_god_synth_sub.sql —— 神级宠合成：副宠不再要求成长（2026-09-20 用户拍板）
-- 依据：`config.synthesize.god.subMinGrowth = 0`（客户端 `pet_merge.js` 的 godSynthInfo）
--
-- 为什么改（用户原话：「要不要设置成副宠不要这么高的成长需求」）：
--   ① 副宠是**燃料**（合成后消失，名字与形态都不继承）——要求它和主宠一样强，
--      等于把同一份「滚成长 + 每次合成重置等级/形态」的苦工做两遍，只加时长不加乐趣；
--   ② **60 这个数高于"收益封顶点"**：成神时超出 birthGrowthCap(60) 的部分按
--      excessStatCoeffRatio 折算系数加成（封顶 +20%），主宠 60 时副宠只要 ≈45 就拉满
--      ⇒ 45→60 这 15 点成长一分额外收益都没有；
--   ③ 原版（口袋精灵2）本来就是「主宠有要求、副宠是材料」。
--   主宠门槛**不变**：终阶 + 成长 ≥ 60 + 等级达标。
--
-- 🔴 客户端与服务端必须同步：只改客户端 → 客户端放行、服务端返回 growth_too_low，
--    玩家看到「神级宠合成被服务器拒绝」。客户端的这一半由 `vtest_god_pet.js` 守着。
--
-- ⚠️ 重放迁移的顺序：`migrate_god_pet.sql` 里那份同名函数体**已过时**（它仍要求
--    主副双方成长 ≥ 60），所以本文件**必须排在它之后**执行（否则旧函数把新的顶掉）。
-- 执行方式（已验证）：MCP supabase_execute_sql，或
--    `npx -y supabase db query --linked --project-ref asklogeayzlqpeejuvjj -f supabase/migrate_god_synth_sub.sql`
-- ============================================================

create or replace function public.check_god_synth(p_main jsonb, p_sub jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_min_growth int := 60;   -- 与 config.synthesize.god.minGrowth 保持一致（改 config 时同步这里）
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'nologin');
  end if;
  -- 双方都必须终阶（evolve_stage ≥ 5）
  if coalesce((p_main->>'evolve_stage')::int, 1) < 5
     or coalesce((p_sub->>'evolve_stage')::int, 1) < 5 then
    return jsonb_build_object('ok', false, 'code', 'not_final_stage');
  end if;
  /* 2026-09-20：成长门槛**只作用于主宠**。
   * 副宠是燃料 —— 它只要终阶（+ Lv60）就够，成长值高低只影响成神时的超额系数折算，
   * 不该成为门槛（见文件头三条理由）。 */
  if coalesce((p_main->>'growth')::numeric, 0) < v_min_growth then
    return jsonb_build_object('ok', false, 'code', 'growth_too_low');
  end if;
  return jsonb_build_object('ok', true, 'code', null);
end $$;

grant execute on function public.check_god_synth(jsonb, jsonb) to authenticated;
revoke execute on function public.check_god_synth(jsonb, jsonb) from anon;
