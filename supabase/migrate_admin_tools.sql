-- ============================================================
-- 0. 服务器配置覆盖（管理员可实时调整；未设置字段沿用代码默认值）
create table if not exists public.game_config_overrides (
  id boolean primary key default true check (id),
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
alter table public.game_config_overrides enable row level security;
drop policy if exists "game_config_read_authenticated" on public.game_config_overrides;
create policy "game_config_read_authenticated" on public.game_config_overrides
  for select to authenticated using (true);

create or replace function public.admin_get_config()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.jwt() ->> 'email' <> '776492620@qq.com' then return '{}'::jsonb; end if;
  return coalesce((select config from public.game_config_overrides where id = true), '{}'::jsonb);
end; $$;
grant execute on function public.admin_get_config() to authenticated;

create or replace function public.admin_save_config(p_config jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.jwt() ->> 'email' <> '776492620@qq.com' then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into public.game_config_overrides(id, config, updated_at, updated_by)
  values (true, coalesce(p_config, '{}'::jsonb), now(), auth.uid())
  on conflict (id) do update set config = excluded.config, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.admin_save_config(jsonb) to authenticated;

-- ---------- 配置发布留档 + 回滚（2026-09-16） ----------
-- 为什么要留档：数值一发布就对全服生效，改错了不能只靠"下次再改回来"——必须能一键回到上一版。
-- prev_config 存"上一版发布内容"；发布时把当前内容挪进去，还原时再换回来（可反复来回）。
-- ⚠️ 更新 config 时必须走 admin_save_config —— 直接改表不会留档，回滚就没得回。
alter table public.game_config_overrides add column if not exists prev_config jsonb;
alter table public.game_config_overrides add column if not exists prev_updated_at timestamptz;

create or replace function public.admin_save_config(p_config jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_old_at timestamptz;
begin
  if auth.jwt() ->> 'email' <> '776492620@qq.com' then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  -- 只收 JSON 对象：传数组/标量进来会把结算配置整个换成不可用的形状，服务端解析直接炸
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'config 必须是 JSON 对象');
  end if;
  select config, updated_at into v_old, v_old_at from public.game_config_overrides where id = true;
  insert into public.game_config_overrides(id, config, prev_config, prev_updated_at, updated_at, updated_by)
  values (true, p_config, v_old, v_old_at, now(), auth.uid())
  on conflict (id) do update set
    prev_config     = public.game_config_overrides.config,
    prev_updated_at = public.game_config_overrides.updated_at,
    config          = excluded.config,
    updated_at      = excluded.updated_at,
    updated_by      = excluded.updated_by;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.admin_save_config(jsonb) to authenticated;

create or replace function public.admin_restore_prev_config()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prev jsonb;
begin
  if auth.jwt() ->> 'email' <> '776492620@qq.com' then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select prev_config into v_prev from public.game_config_overrides where id = true;
  if v_prev is null or jsonb_typeof(v_prev) <> 'object' then
    return jsonb_build_object('ok', false, 'error', '没有上一版可还原');
  end if;
  -- SET 右侧一律取【旧行值】，所以这两句等于互换：还原后还能再"还原"回刚才那版
  update public.game_config_overrides
     set config          = prev_config,
         updated_at      = now(),
         updated_by      = auth.uid(),
         prev_config     = config,
         prev_updated_at = updated_at
   where id = true;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.admin_restore_prev_config() to authenticated;

-- 面板用：告诉我云端有没有配置、有没有上一版、上次发布是什么时候（不改任何数据）
create or replace function public.admin_config_meta()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_at timestamptz; v_prev jsonb; v_prev_at timestamptz;
begin
  if auth.jwt() ->> 'email' <> '776492620@qq.com' then return '{}'::jsonb; end if;
  select config, updated_at, prev_config, prev_updated_at into v, v_at, v_prev, v_prev_at
    from public.game_config_overrides where id = true;
  if v is null then return jsonb_build_object('has_config', false, 'has_prev', false); end if;
  return jsonb_build_object(
    'has_config', v is not null,
    'has_prev', v_prev is not null,
    'updated_at', v_at,
    'prev_updated_at', v_prev_at,
    'size', length(v::text)
  );
end; $$;
grant execute on function public.admin_config_meta() to authenticated;

-- 管理员工具 RPC：玩家管理 + 运营统计
-- 用法：Supabase Dashboard → SQL Editor → 整段粘贴 → Run（幂等，可重复执行）
-- 全部函数校验调用者邮箱 = 管理员邮箱（与 grant_gems 一致），非管理员返回空或 'forbidden'。
-- 依赖：profiles / wallets / wallet_ledger / auth.users 表已存在（migrate_profiles.sql + migrate_shop.sql）。
-- ============================================================

-- ---------- 清理旧版本函数（参数签名或参数名变更，create or replace 不会自动处理） ----------
drop function if exists public.admin_list_users(int, int);
drop function if exists public.admin_search_users(text);
drop function if exists public.admin_ban_user(uuid, boolean, text);
drop function if exists public.admin_grant_gems_to_user(uuid, int, text);

-- ============================================================
-- 1. 列出玩家（无参数，固定返回最近注册的 50 名，按注册时间倒序）
--    返回：id / nickname / email / created_at / last_seen_at / banned / ban_reason / gems
-- ============================================================
create or replace function public.admin_list_users()
returns table (
  id uuid,
  nickname text,
  email text,
  created_at timestamptz,
  last_seen_at timestamptz,
  banned boolean,
  ban_reason text,
  gems integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.jwt() ->> 'email' <> '776492620@qq.com' then return; end if;
  return query
    select
      u.id,
      p.nickname,
      u.email::text,
      u.created_at,
      p.last_seen_at,
      coalesce(p.banned, false),
      p.ban_reason,
      coalesce(w.gems, 0)
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.wallets w on w.user_id = u.id
    order by u.created_at desc
    limit 50;
end; $$;
grant execute on function public.admin_list_users() to authenticated;

-- ============================================================
-- 2. 搜索玩家（按昵称或邮箱模糊匹配，最多 50 条）
--    参数 q：搜索关键词
-- ============================================================
create or replace function public.admin_search_users(q text)
returns table (
  id uuid,
  nickname text,
  email text,
  created_at timestamptz,
  last_seen_at timestamptz,
  banned boolean,
  ban_reason text,
  gems integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.jwt() ->> 'email' <> '776492620@qq.com' then return; end if;
  if q is null or length(trim(q)) = 0 then return; end if;
  return query
    select
      u.id,
      p.nickname,
      u.email::text,
      u.created_at,
      p.last_seen_at,
      coalesce(p.banned, false),
      p.ban_reason,
      coalesce(w.gems, 0)
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.wallets w on w.user_id = u.id
    where u.email ilike '%' || trim(q) || '%'
       or p.nickname ilike '%' || trim(q) || '%'
    order by u.created_at desc
    limit 50;
end; $$;
grant execute on function public.admin_search_users(text) to authenticated;

-- ============================================================
-- 3. 封禁 / 解封玩家
--    uid：玩家 user_id；ban：true 封禁 / false 解封；reason：封禁原因（解封时传 null）
--    返回 'ok' / 'forbidden' / 'notfound'
-- ============================================================
create or replace function public.admin_ban_user(uid uuid, ban boolean, reason text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_exists boolean;
begin
  if auth.jwt() ->> 'email' <> '776492620@qq.com' then return 'forbidden'; end if;
  select exists(select 1 from auth.users where id = uid) into v_exists;
  if not v_exists then return 'notfound'; end if;
  -- 确保 profiles 行存在（老账号可能没有）
  insert into public.profiles (id, nickname)
  select uid, split_part(coalesce((select email from auth.users where id = uid), ''), '@', 1)
  on conflict (id) do nothing;
  if ban then
    update public.profiles set banned = true, ban_reason = coalesce(reason, '管理员封禁') where id = uid;
  else
    update public.profiles set banned = false, ban_reason = null where id = uid;
  end if;
  return 'ok';
end; $$;
grant execute on function public.admin_ban_user(uuid, boolean, text) to authenticated;

-- ============================================================
-- 4. 给指定玩家发魔石 → 直接复用 migrate_shop.sql 里已有的 grant_gems(p_user_id, p_amount, p_reason)
--    本文件不再重复定义，避免双份维护。前端调用名：grant_gems。
-- ============================================================

-- ============================================================
-- 5. 运营统计（无参数，核心指标一次返回）
--    返回单行：total_users / today_new / active_7d / active_1d / banned_count /
--              total_gems_in_circulation / total_gems_granted / orders_count / products_count
-- ============================================================
create or replace function public.admin_stats()
returns table (
  total_users bigint,
  today_new bigint,
  active_7d bigint,
  active_1d bigint,
  banned_count bigint,
  total_gems_in_circulation bigint,
  total_gems_granted bigint,
  orders_count bigint,
  products_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.jwt() ->> 'email' <> '776492620@qq.com' then return; end if;
  return query
    select
      (select count(*) from auth.users)::bigint as total_users,
      (select count(*) from auth.users where created_at >= date_trunc('day', now()))::bigint as today_new,
      (select count(*) from public.profiles where last_seen_at >= now() - interval '7 days')::bigint as active_7d,
      (select count(*) from public.profiles where last_seen_at >= now() - interval '1 day')::bigint as active_1d,
      (select count(*) from public.profiles where banned = true)::bigint as banned_count,
      (select coalesce(sum(gems), 0) from public.wallets)::bigint as total_gems_in_circulation,
      (select coalesce(sum(delta), 0) from public.wallet_ledger where delta > 0 and reason in ('admin', 'admin-panel', 'manual'))::bigint as total_gems_granted,
      (select count(*) from public.orders)::bigint as orders_count,
      (select count(*) from public.products where active = true)::bigint as products_count;
end; $$;
grant execute on function public.admin_stats() to authenticated;

-- ============================================================
-- 完成提示：执行后，开发者面板的「玩家」和「数据」Tab 即可使用。
-- 若面板提示 "RPC not found" 或 400，按 Ctrl+Shift+R 硬刷新页面。
-- ============================================================
