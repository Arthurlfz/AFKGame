-- ============================================================
-- 结算 jsonb 双重编码修复（2026-09-11）—— 幂等，可重复执行
--
-- 🔴 问题（本次审计 P0）：Edge Function 把对象 JSON.stringify 之后才交给
--    声明为 jsonb 的 RPC 参数，PostgREST 会把它当成「JSON 字符串」而不是数组/对象，
--    于是落库变成 jsonb string 而不是 jsonb object/array：
--      battle_logs.detail            → "[{...}]"    （7024/7024 行全是字符串）
--      idle_sessions.pending_script  → "{\"id\":...}" （64/64 行全是字符串）
--
-- 🔴 后果 1（严重）：idle_sessions.pending_script 读回来是字符串，
--    Edge Function 里的 `pending.script` 恒为 undefined → 幂等分支永远不命中
--    → 每次 settle 都重新预结算并【重新入账一个新的 30 秒剧本窗】。
--    线上实测：57 秒内 4 次 settle 写了 4 条 battle_logs（幂等生效时不该写），
--    授予 120 秒模拟 vs 真实 57 秒 = 2.10 倍；多个会话普遍 1.4~2.1 倍。
--    = 所有玩家的挂机产出被凭空放大 1.4~2.1 倍。
--
-- 🔴 后果 2：battle_logs.detail 存成字符串 → 任何按明细做的审计/统计都查不出东西。
--
-- 修法（两层，本文件负责第 ①② 层，第 ③ 层在 EF 源码）：
--   ① 清洗历史脏数据（把 jsonb string 还原成真正的 array/object）
--   ② RPC 入口做类型归一化 —— 不管调用方传字符串还是对象都收下，
--      这样即使 EF 还没重新部署，洞也立刻关上；且旧数据在下一次写入时自愈。
--   ③ 修 EF 源码（去掉 JSON.stringify）—— 根因，见 battle-settle/index.ts
--
-- 顺带：清理 battle_settle 的历史重载（线上有 3 个签名，其中 2 个不含
--       p_pending_script/p_cursor，是改版前残留 —— 调用方漏传参数就可能静默
--       命中旧版本，走没有游标幂等的逻辑）。
--
-- 用法：Supabase Dashboard → SQL Editor → 整段粘贴 → Run
-- ============================================================

-- ============================================================
-- ① 清洗历史脏数据
--    只处理「是 jsonb 字符串 且 内容以 [ 或 { 开头」的行，避免脏值把整条 UPDATE 炸掉。
-- ============================================================
update public.battle_logs
set detail = (detail #>> '{}')::jsonb
where jsonb_typeof(detail) = 'string'
  and left(btrim(detail #>> '{}'), 1) in ('[', '{');

update public.idle_sessions
set pending_script = (pending_script #>> '{}')::jsonb
where jsonb_typeof(pending_script) = 'string'
  and left(btrim(pending_script #>> '{}'), 1) in ('[', '{');

-- ============================================================
-- ② 清理 battle_settle 的历史重载，只留一个权威签名
-- ============================================================
drop function if exists public.battle_settle(uuid, integer, integer, jsonb, timestamptz, timestamptz);
drop function if exists public.battle_settle(uuid, integer, integer, jsonb, timestamptz, timestamptz, integer);
drop function if exists public.battle_settle(uuid, integer, integer, jsonb, timestamptz, timestamptz, integer, timestamptz);
drop function if exists public.battle_settle(uuid, integer, integer, jsonb, timestamptz, timestamptz, integer, timestamptz, jsonb);

create function public.battle_settle(
  p_session_id uuid,
  p_fights     integer,
  p_exp        integer,
  p_detail     jsonb default '[]'::jsonb,
  p_now        timestamptz default now(),
  p_expected_last_settled_at timestamptz default null,
  p_last_boss_fight integer default null,
  p_cursor     timestamptz default null,
  p_pending_script jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.idle_sessions%rowtype;
  v_batch integer;
  v_cursor timestamptz;
begin
  -- 🔴 类型归一化（2026-09-11）：调用方可能把对象 JSON.stringify 过再传进来，
  --    那会以 jsonb 字符串落库（"{...}" 而非 {...}），下游读 .script 恒为 undefined。
  --    这里统一还原成真正的 jsonb 结构 —— 两层防线，EF 改与不改都安全。
  if p_detail is not null and jsonb_typeof(p_detail) = 'string' then
    p_detail := (p_detail #>> '{}')::jsonb;
  end if;
  if p_pending_script is not null and jsonb_typeof(p_pending_script) = 'string' then
    p_pending_script := (p_pending_script #>> '{}')::jsonb;
  end if;

  -- 锁会话行（防并发重复结算）：只允许结算自己名下的 active 会话
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

  -- 幂等批次号：本次结算的 batch_seq = 现有日志数 + 1
  select coalesce(max(batch_seq), 0) + 1 into v_batch from public.battle_logs where session_id = p_session_id;

  -- 推进游标与累计（预结算：游标 = 剧本窗尾，已入账的录像存 pending_script）
  update public.idle_sessions
  set last_settled_at = v_cursor,
      total_fights    = total_fights + greatest(0, p_fights),
      total_exp       = total_exp + greatest(0, p_exp),
      last_boss_fight = coalesce(p_last_boss_fight, last_boss_fight),
      pending_script  = coalesce(p_pending_script, pending_script),
      updated_at      = p_now
  where id = p_session_id;

  -- 写结算日志（审计；detail 为明细摘要）
  insert into public.battle_logs (session_id, user_id, batch_seq, fights, exp_gained, detail, created_at)
  values (p_session_id, v_row.user_id, v_batch, greatest(0, p_fights), greatest(0, p_exp),
          coalesce(p_detail, '[]'::jsonb), p_now);

  return jsonb_build_object('ok', true, 'batch_seq', v_batch,
    'total_fights', v_row.total_fights + greatest(0, p_fights),
    'total_exp', v_row.total_exp + greatest(0, p_exp));
end;
$$;

-- ============================================================
-- ③ 权限收口（只给 authenticated；末尾统一收 anon）
-- ============================================================
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from public;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.bot_buy_guard() from authenticated;
