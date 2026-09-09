-- ============================================================
-- 迁移：服务器唯一模拟器 + 先记账后放片（2026-09-09 架构改版）
--   1. idle_sessions 加 pending_script jsonb：
--      服务器预结算的「已入账演出录像」存在会话上，客户端刷新/重连时幂等原样再发，
--      不重复记账。游标 last_settled_at 直接指到剧本窗尾（预结算语义）。
--   2. battle_settle RPC 扩参：
--      p_cursor          游标推进目标（默认 p_now；预结算时 = now + 剧本窗秒数）
--      p_pending_script  本次入账的剧本（jsonb；null 则保留原值）
-- 幂等，可重复执行；先在 Supabase SQL Editor（或 Management API）执行，再部署 Edge Function。
-- ============================================================

alter table public.idle_sessions add column if not exists pending_script jsonb;

create or replace function public.battle_settle(
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
