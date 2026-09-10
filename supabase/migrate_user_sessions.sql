-- ============================================================
-- 迁移：应用层会话表 user_sessions（设备级登录互斥 / 真互踢）
-- 幂等，可重复执行。
--
-- 为什么需要它：
--   Supabase Auth 的 access token 是 JWT，服务端没法单独吊销它（只能等过期），
--   所以「同一账号在另一台设备登录 → 老设备立刻下线」必须由应用层做：
--   登录时登记会话并撤销该账号其它未撤销会话，客户端靠心跳 + Realtime 发现自己被撤销。
--
-- 与 core/auth-session.js 的分工（两层各管一段，缺一不可）：
--   core/auth-session.js   = 同一个浏览器里的多个标签页（BroadcastChannel，秒级，不碰服务端）
--   core/server-session.js = 跨浏览器 / 跨设备（本表 + 心跳 + Realtime 订阅）
--
-- 会话 id 由客户端生成（localStorage 持久化，同一浏览器多标签共用同一个 id），
-- 但服务端只认「自己登记过的」id：未登记的 id 想登记时，若该账号已有活跃会话则拒绝
-- （堵住"清掉 localStorage 换个新 id 就复活"的绕过）。
--
-- 登录 vs 恢复（两条语义必须分开，否则两台设备会来回抢）：
--   login  （真登录 / 新设备首次打开）：p_kick_others = true，撤销别人的会话并激活自己
--   resume （页面刷新 / 已有 token 恢复）：p_kick_others = false，只激活自己；
--          如果自己的会话已被撤销，就如实报告被踢 —— 绝不复活（否则刷新 = 抢回来）
-- ============================================================

-- ---------- 表 ----------
create table if not exists public.user_sessions (
  id            uuid primary key,                 -- 客户端生成并持久化（同一浏览器多标签共用）
  user_id       uuid not null references auth.users(id) on delete cascade,
  device        text,                             -- 展示用：UA 摘要
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,                      -- 非空 = 已下线
  revoke_reason text                              -- kicked-by-login / logout / banned / stale
);

create index if not exists user_sessions_user_active_idx
  on public.user_sessions (user_id) where revoked_at is null;
create index if not exists user_sessions_last_seen_idx
  on public.user_sessions (last_seen_at);

-- ---------- RLS：只读自己的行（Realtime 订阅要靠 select 权限过滤） ----------
alter table public.user_sessions enable row level security;
drop policy if exists "user_sessions_select_own" on public.user_sessions;
create policy "user_sessions_select_own" on public.user_sessions
  for select to authenticated using (auth.uid() = user_id);
-- 写入一律走下面的 security definer 函数，不开放 insert/update/delete 策略

-- ---------- Realtime：被撤销时推送给自己（秒级踢人；心跳是兜底） ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_sessions'
    ) then
      execute 'alter publication supabase_realtime add table public.user_sessions';
    end if;
  end if;
end $$;

-- ============================================================
-- RPC：session_login —— 登记 / 激活一个会话
-- 返回：{ ok, session_id, state, kicked, banned, ban_reason }
--   state ∈ active | revoked | banned | unregistered | conflict
-- ============================================================
create or replace function public.session_login(
  p_session_id  uuid,
  p_device      text default null,
  p_kick_others boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_banned  boolean := false;
  v_reason  text;
  v_kicked  integer := 0;
  v_owner   uuid;
  v_revoked timestamptz;
  v_revoke  text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'state', 'no-auth');
  end if;
  if p_session_id is null then
    return jsonb_build_object('ok', false, 'state', 'no-session-id');
  end if;

  -- 1) 这个 id 是否已被别人占用（客户端生成的 uuid，理论不会撞，防串号兜底）
  select user_id into v_owner from public.user_sessions where id = p_session_id;
  if v_owner is not null and v_owner <> v_uid then
    return jsonb_build_object('ok', false, 'state', 'conflict');
  end if;

  -- 2) 恢复语义：本会话已被撤销 → 如实报告被踢，不复活
  --    （复活会让两台设备"谁刷新谁赢"，来回互踢）
  if not p_kick_others then
    select revoked_at, revoke_reason into v_revoked, v_revoke
    from public.user_sessions where id = p_session_id and user_id = v_uid;
    if not found then
      -- 本地有 id、服务端却没登记过，还走"恢复"语义 = 无法证明它是同一个会话。
      -- 这种时候如果账号已有别的活跃会话，一律拒绝 —— 否则「清掉 localStorage
      -- 换个新 id 再刷新」就绕过了互踢（新会话被激活、老会话还活着）。
      if exists (select 1 from public.user_sessions where user_id = v_uid and revoked_at is null) then
        return jsonb_build_object('ok', false, 'state', 'unregistered');
      end if;
    elsif v_revoked is not null then
      return jsonb_build_object('ok', false, 'state', 'revoked', 'reason', v_revoke);
    end if;
  end if;

  -- 3) 登录语义：撤销该账号其它所有未撤销会话（后登录赢）
  if p_kick_others then
    update public.user_sessions
    set revoked_at = now(), revoke_reason = 'kicked-by-login'
    where user_id = v_uid and id <> p_session_id and revoked_at is null;
    get diagnostics v_kicked = row_count;
  end if;

  -- 4) 登记 / 激活本会话
  insert into public.user_sessions (id, user_id, device, last_seen_at, revoked_at, revoke_reason)
  values (p_session_id, v_uid, left(coalesce(p_device, ''), 200), now(), null, null)
  on conflict (id) do update
    set last_seen_at  = now(),
        revoked_at    = null,
        revoke_reason = null,
        device        = coalesce(nullif(excluded.device, ''), public.user_sessions.device);

  -- 5) 封禁检查（封禁号不发放会话）
  select banned, ban_reason into v_banned, v_reason from public.profiles where id = v_uid;
  if v_banned then
    update public.user_sessions
    set revoked_at = now(), revoke_reason = 'banned'
    where id = p_session_id;
    return jsonb_build_object('ok', false, 'state', 'banned', 'ban_reason', v_reason);
  end if;

  update public.profiles set last_seen_at = now() where id = v_uid;

  return jsonb_build_object(
    'ok', true, 'session_id', p_session_id, 'state', 'active', 'kicked', v_kicked
  );
end;
$$;

-- ============================================================
-- RPC：session_heartbeat —— 心跳（兼做封禁实时复查）
-- 返回：{ ok, state }  state ∈ active | registered | revoked | banned | unregistered
-- 客户端只在 state = revoked / banned 时踢人；网络失败一律不动
-- （绝不能因为一次超时就误踢玩家）
-- ============================================================
create or replace function public.session_heartbeat(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_row     public.user_sessions%rowtype;
  v_banned  boolean := false;
  v_reason  text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'state', 'no-auth');
  end if;
  if p_session_id is null then
    return jsonb_build_object('ok', false, 'state', 'no-session-id');
  end if;

  -- 封禁优先：挂着机被管理员封禁 → 心跳立刻踢
  select banned, ban_reason into v_banned, v_reason from public.profiles where id = v_uid;
  if v_banned then
    update public.user_sessions set revoked_at = now(), revoke_reason = 'banned'
    where id = p_session_id and user_id = v_uid and revoked_at is null;
    return jsonb_build_object('ok', false, 'state', 'banned', 'ban_reason', v_reason);
  end if;

  select * into v_row from public.user_sessions
  where id = p_session_id and user_id = v_uid;

  if not found then
    -- 本会话没登记过（localStorage 被清 / 老版本客户端）：
    -- 只有在「该账号当前没有任何活跃会话」时才允许自动登记，
    -- 否则视为"未授权会话"，让客户端重新走登录流程。
    if exists (select 1 from public.user_sessions where user_id = v_uid and revoked_at is null) then
      return jsonb_build_object('ok', false, 'state', 'unregistered');
    end if;
    insert into public.user_sessions (id, user_id, last_seen_at)
    values (p_session_id, v_uid, now())
    on conflict (id) do nothing;
    update public.profiles set last_seen_at = now() where id = v_uid;
    return jsonb_build_object('ok', true, 'state', 'registered');
  end if;

  if v_row.revoked_at is not null then
    return jsonb_build_object('ok', false, 'state', 'revoked', 'reason', v_row.revoke_reason);
  end if;

  update public.user_sessions set last_seen_at = now() where id = p_session_id;
  update public.profiles set last_seen_at = now() where id = v_uid;
  return jsonb_build_object('ok', true, 'state', 'active');
end;
$$;

-- ============================================================
-- RPC：session_logout —— 主动登出本会话
-- （只撤销自己这一条：登出只登出本设备，其他设备不受影响）
-- ============================================================
create or replace function public.session_logout(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'state', 'no-auth');
  end if;
  update public.user_sessions
  set revoked_at = now(), revoke_reason = 'logout'
  where id = p_session_id and user_id = v_uid and revoked_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------- 权限收口（与 migrate_security_hardening.sql 同口径：anon 一律不可执行） ----------
revoke execute on function public.session_login(uuid, text, boolean) from public, anon;
revoke execute on function public.session_heartbeat(uuid) from public, anon;
revoke execute on function public.session_logout(uuid) from public, anon;
grant execute on function public.session_login(uuid, text, boolean) to authenticated;
grant execute on function public.session_heartbeat(uuid) to authenticated;
grant execute on function public.session_logout(uuid) to authenticated;
