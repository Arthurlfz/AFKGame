-- ============================================================
-- 迁移：挂机会话表 idle_sessions + 战斗结算日志 battle_logs
-- 服务器权威战斗（方案 v2，2026-09-04 拍板）：
--   「在线才挂机」：开始挂机记 started_at，在线期间定期结算；
--   切后台/关页面 → pause 停表，离线不结算；回来 resume 继续。
-- 幂等，可重复执行；先在 Supabase SQL Editor 执行，再部署 Edge Function。
-- ============================================================

-- ---------- idle_sessions：挂机会话（一次开始 → 停止为一条） ----------
create table if not exists public.idle_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  pet_id           uuid references public.pets(id) on delete set null,  -- 出战宠物（允许宠物被删后会话仍保留）
  area_id          text not null,               -- 挂机地图（config.battle.areas[].id）
  status           text not null default 'active'
                   check (status in ('active','paused','stopped')),
  -- 时间权威三件套：全部由服务器 now() 维护，客户端时间一律忽略
  started_at       timestamptz not null default now(),  -- 开始挂机时刻
  last_settled_at  timestamptz not null default now(),  -- 结算游标（幂等：只进不退）
  paused_at        timestamptz,                 -- 最近一次暂停时刻（resume 时清零）
  stopped_at       timestamptz,                 -- 手动停止时刻
  -- 结算累计（只增不减，全部来自服务器结算）
  total_fights     integer not null default 0,  -- 累计场数
  total_exp        integer not null default 0,  -- 累计经验
  total_drops      jsonb not null default '[]'::jsonb,  -- 累计掉落摘要 [{type,id,qty}]（P2 启用）
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- 索引：查玩家当前活动会话（登录/恢复时用）
create index if not exists idle_sessions_active_idx
  on public.idle_sessions (user_id) where status <> 'stopped';

-- RLS：会话是私密数据，只有本人可见
alter table public.idle_sessions enable row level security;

drop policy if exists "idle_sessions_select_own" on public.idle_sessions;
create policy "idle_sessions_select_own" on public.idle_sessions
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "idle_sessions_insert_own" on public.idle_sessions;
create policy "idle_sessions_insert_own" on public.idle_sessions
  for insert to authenticated with check (auth.uid() = user_id);

-- 写入走 security definer 函数（battle_settle RPC），不开放直接 update/delete
-- （防止玩家手改 status/total_exp 刷数据；RPC 内做完整性校验）

-- ---------- battle_logs：每次 settle 的结算明细（审计/回放/对账） ----------
create table if not exists public.battle_logs (
  id            bigint generated always as identity primary key,
  session_id    uuid not null references public.idle_sessions(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  batch_seq     integer not null,               -- 本次会话内第几次结算（幂等去重用）
  fights        integer not null default 0,     -- 本次结算场数
  exp_gained    integer not null default 0,     -- 本次结算经验
  detail        jsonb not null default '[]'::jsonb,  -- 每场明细 [{win,enemyLevel,enemyName,hpLeft,exp}]（P1 先记摘要）
  created_at    timestamptz not null default now(),
  unique (session_id, batch_seq)                -- 幂等：同批次只写一次
);

create index if not exists battle_logs_session_idx on public.battle_logs (session_id);
create index if not exists battle_logs_user_idx on public.battle_logs (user_id);

alter table public.battle_logs enable row level security;
drop policy if exists "battle_logs_select_own" on public.battle_logs;
create policy "battle_logs_select_own" on public.battle_logs
  for select to authenticated using (auth.uid() = user_id);
-- 写入只允许 security definer 函数，不开放客户端 insert

-- ============================================================
-- RPC：battle_settle —— Edge Function 调用的唯一写入口
-- 入参：p_session_id（会话）、p_fights（本次结算场数）、p_exp（本次经验）、
--       p_detail（jsonb 明细）、p_now（服务器时间戳，由 Edge Function 传入权威时间）
-- 行为：幂等推进 last_settled_at / total_fights / total_exp；回写宠物当前血量
--       （p_pet_cur_hp 可选：P1 先由 EF 直接 update pets，此处预留）
-- ============================================================
create or replace function public.battle_settle(
  p_session_id uuid,
  p_fights     integer,
  p_exp        integer,
  p_detail     jsonb default '[]'::jsonb,
  p_now        timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.idle_sessions%rowtype;
  v_batch integer;
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

  -- 幂等批次号：本次结算的 batch_seq = 现有日志数 + 1
  select coalesce(max(batch_seq), 0) + 1 into v_batch from public.battle_logs where session_id = p_session_id;

  -- 推进游标与累计（p_fights/p_exp 由 Edge Function 按 [now - last_settled_at] 算出，必 ≥ 0）
  update public.idle_sessions
  set last_settled_at = p_now,
      total_fights    = total_fights + greatest(0, p_fights),
      total_exp       = total_exp + greatest(0, p_exp),
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

-- ---------- RPC：battle_session 状态机（start / pause / resume / stop） ----------
-- 入参：p_action ∈ start|pause|resume|stop；p_area_id / p_pet_id（仅 start 用）
-- start：结束旧的未停止会话 → 新建 active 会话（last_settled_at = now）
-- pause：active → paused（记 paused_at；结算到当前秒）
-- resume：paused → active（清 paused_at）
-- stop：active|paused → stopped（记 stopped_at）
-- 全部由服务器时间戳驱动，客户端传的时间一律忽略
create or replace function public.battle_session(
  p_action   text,
  p_area_id  text default null,
  p_pet_id   uuid default null,
  p_now      timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.idle_sessions%rowtype;
  v_new_id uuid;
begin
  if p_action not in ('start','pause','resume','stop') then
    return jsonb_build_object('ok', false, 'error', 'BAD_ACTION');
  end if;

  -- start：先停掉旧会话，再开新的
  if p_action = 'start' then
    if p_area_id is null or p_pet_id is null then
      return jsonb_build_object('ok', false, 'error', 'MISSING_AREA_OR_PET');
    end if;
    update public.idle_sessions
    set status = 'stopped', stopped_at = p_now, updated_at = p_now
    where user_id = auth.uid() and status <> 'stopped';
    insert into public.idle_sessions (user_id, pet_id, area_id, status, started_at, last_settled_at, created_at, updated_at)
    values (auth.uid(), p_pet_id, p_area_id, 'active', p_now, p_now, p_now, p_now)
    returning id into v_new_id;
    return jsonb_build_object('ok', true, 'session_id', v_new_id, 'status', 'active', 'started_at', p_now);
  end if;

  -- pause / resume / stop：锁当前活动会话
  select * into v_old from public.idle_sessions
  where user_id = auth.uid() and status <> 'stopped'
  order by started_at desc limit 1
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_SESSION');
  end if;

  if p_action = 'pause' and v_old.status = 'active' then
    update public.idle_sessions
    set status = 'paused', paused_at = p_now, updated_at = p_now
    where id = v_old.id;
    return jsonb_build_object('ok', true, 'session_id', v_old.id, 'status', 'paused', 'paused_at', p_now,
      'last_settled_at', v_old.last_settled_at);
  elsif p_action = 'resume' and v_old.status = 'paused' then
    update public.idle_sessions
    set status = 'active', paused_at = null, updated_at = p_now
    where id = v_old.id;
    return jsonb_build_object('ok', true, 'session_id', v_old.id, 'status', 'active');
  elsif p_action = 'stop' then
    update public.idle_sessions
    set status = 'stopped', stopped_at = p_now, updated_at = p_now
    where id = v_old.id;
    return jsonb_build_object('ok', true, 'session_id', v_old.id, 'status', 'stopped', 'stopped_at', p_now);
  else
    return jsonb_build_object('ok', false, 'error', 'INVALID_TRANSITION',
      'from', v_old.status, 'action', p_action);
  end if;
end;
$$;
