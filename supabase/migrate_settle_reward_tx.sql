-- ============================================================
-- migrate_settle_reward_tx.sql —— 把挂机发奖搬进结算事务
--
-- 问题（2026-09-11 审计第 1 批 P1-1）：发奖与记账不在同一事务。
--   ① battle_settle RPC  → 推进游标 + 写 battle_logs（已记账）
--   ② pets.update        → 写回经验/等级/血量        ← EF 里做
--   ③ add_material 循环  → 发材料                    ← EF 里做
--   ④ equip_items insert → 发装备                    ← EF 里做
--   ⑤ pet_egg insert     → 发蛋                      ← EF 里做
--   ③④⑤ 任一失败 → 返回 500，但①的游标已推进 → 那段产出【永久丢失】，
--   而且是【部分发放】：材料 A 成功、B 失败，A 不会回退、B 永远拿不到。
--
-- 方案：给 battle_settle 加三个发奖参数，在函数内发奖 —— PL/pgSQL 函数天然是事务，
--   任一失败整单回滚（游标也不推进），下次 settle 会重新计算并重试。
--
-- ⚠️ 为什么用 perform public.add_material(...) 而不是自己写 insert：
--   add_material 带【60 秒 1000 个】的限流保护。直接 insert materials 会绕过它 ——
--   而"抄一份 add_material 的函数体"是本项目踩过的血泪（抄丢安全守卫）。
--   这里复用原函数，限流与归属检查全部保留（auth.uid() 在嵌套 security definer 中仍指向玩家）。
--
-- ⚠️ 上线步骤（顺序不能反，否则旧 EF 会调不到函数）：
--   1. 执行本脚本（创建新签名，旧签名仍在）
--   2. 部署 battle-settle EF（改传三个新参数）
--   3. 验证挂机结算正常
--   4. 再执行：drop function if exists public.battle_settle(
--        uuid,integer,integer,jsonb,timestamptz,timestamptz,integer,timestamptz,jsonb);
--      （不 drop 会留两个重载，正是第 1 批 P1-2 踩过的坑）
--   回滚：重新 create 旧定义（在 git 历史 / 本文件末尾注释里有备份）
-- ============================================================

create or replace function public.battle_settle(
  p_session_id uuid,
  p_fights integer,
  p_exp integer,
  p_detail jsonb default '[]'::jsonb,
  p_now timestamp with time zone default now(),
  p_expected_last_settled_at timestamp with time zone default null,
  p_last_boss_fight integer default null,
  p_cursor timestamp with time zone default null,
  p_pending_script jsonb default null,
  -- ↓ 新增：发奖（与游标推进同事务）
  p_reward_materials jsonb default '{}'::jsonb,   -- { 材料名: 数量 }
  p_reward_equips    jsonb default '[]'::jsonb,   -- [ {name,slot,base_stat,affixes,tier,rarity,locked,identified,soul_affix} ]
  p_reward_eggs      jsonb default '{}'::jsonb    -- { 蛋品种: 数量 }
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.idle_sessions%rowtype;
  v_batch integer;
  v_cursor timestamptz;
  rec record;
begin
  -- 类型归一化：调用方可能把对象 JSON.stringify 过再传进来，那会以 jsonb 字符串落库
  if p_detail is not null and jsonb_typeof(p_detail) = 'string' then
    p_detail := (p_detail #>> '{}')::jsonb;
  end if;
  if p_pending_script is not null and jsonb_typeof(p_pending_script) = 'string' then
    p_pending_script := (p_pending_script #>> '{}')::jsonb;
  end if;

  select * into v_row from public.idle_sessions
  where id = p_session_id and user_id = auth.uid()
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'SESSION_NOT_FOUND');
  end if;
  if v_row.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'SESSION_NOT_ACTIVE', 'status', v_row.status);
  end if;
  if p_expected_last_settled_at is not null
     and v_row.last_settled_at <> p_expected_last_settled_at then
    return jsonb_build_object('ok', false, 'error', 'STALE_SETTLE_CURSOR',
      'last_settled_at', v_row.last_settled_at);
  end if;

  v_cursor := coalesce(p_cursor, p_now);

  select coalesce(max(batch_seq), 0) + 1 into v_batch from public.battle_logs where session_id = p_session_id;

  update public.idle_sessions
  set last_settled_at = v_cursor,
      total_fights    = total_fights + greatest(0, p_fights),
      total_exp       = total_exp + greatest(0, p_exp),
      last_boss_fight = coalesce(p_last_boss_fight, last_boss_fight),
      pending_script  = coalesce(p_pending_script, pending_script),
      updated_at      = p_now
  where id = p_session_id;

  insert into public.battle_logs (session_id, user_id, batch_seq, fights, exp_gained, detail, created_at)
  values (p_session_id, v_row.user_id, v_batch, greatest(0, p_fights), greatest(0, p_exp),
          coalesce(p_detail, '[]'::jsonb), p_now);

  /* ===== 发奖（与上面同事务：任一失败整单回滚，下次 settle 重试） ===== */

  -- 材料：复用 add_material（保留限流与归属检查，不自己 insert）
  for rec in
    select t.key as m_name, greatest(0, (t.value)::int) as m_qty
    from jsonb_each_text(coalesce(p_reward_materials, '{}'::jsonb)) as t
  loop
    if rec.m_qty > 0 then
      perform public.add_material(rec.m_name, rec.m_qty);
    end if;
  end loop;

  -- 装备：整批 insert（空数组时 jsonb_array_elements 不产生行，天然跳过）
  if jsonb_array_length(coalesce(p_reward_equips, '[]'::jsonb)) > 0 then
    insert into public.equip_items
      (user_id, name, slot, base_stat, affixes, tier, rarity, locked, identified, soul_affix)
    select v_row.user_id,
           coalesce(e->>'name', ''),
           coalesce(e->>'slot', ''),
           coalesce(e->'base_stat', '{}'::jsonb),
           coalesce(e->'affixes', '{}'::jsonb),
           case when nullif(e->>'tier', '') is null then null else (e->>'tier')::int end,
           coalesce(e->>'rarity', 'white'),
           coalesce((e->>'locked')::boolean, false),
           coalesce((e->>'identified')::boolean, false),
           e->'soul_affix'
    from jsonb_array_elements(coalesce(p_reward_equips, '[]'::jsonb)) as e;
  end if;

  -- 蛋：pet_egg.owner_id 是 text 列（不是 uuid），必须转字符串
  if coalesce(p_reward_eggs, '{}'::jsonb) <> '{}'::jsonb then
    insert into public.pet_egg (owner_id, egg_type, status)
    select v_row.user_id::text, t.key, '未孵化'
    from jsonb_each_text(coalesce(p_reward_eggs, '{}'::jsonb)) as t,
         generate_series(1, greatest(0, (t.value)::int)) as g;
  end if;

  return jsonb_build_object('ok', true, 'batch_seq', v_batch,
    'total_fights', v_row.total_fights + greatest(0, p_fights),
    'total_exp', v_row.total_exp + greatest(0, p_exp));
end;
$function$;

-- 权限：只给登录用户，anon 一律收回
revoke execute on function public.battle_settle(uuid, integer, integer, jsonb, timestamptz, timestamptz, integer, timestamptz, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.battle_settle(uuid, integer, integer, jsonb, timestamptz, timestamptz, integer, timestamptz, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- ============================================================
-- 旧定义备份（回滚用，若需回退把上面删掉、执行这段即可）
-- 旧签名：battle_settle(uuid,integer,integer,jsonb,timestamptz,timestamptz,integer,timestamptz,jsonb)
-- 旧函数体 = 本文件新版本去掉「发奖」三段（游标推进 + 写 battle_logs + return）
-- ============================================================
