-- ============================================================
-- add_material 每日上限（2026-09-17）
--
-- 要解决的问题：现在只有【窗口限流】（60 秒内最多 1000），**没有日上限**。
--   改一改前端就能一天报几十万材料进来 —— 内测期只要有一个人这么干，
--   产出/消耗的数据就全废了，经济也没法看。
--
-- 做法：在 security_rate_limits 上加两个日级列，超过日上限一律拒绝。
--   日上限值 = 20000（config.security.addMaterial.maxPerDay 同步）
--   定这个数的依据：正常玩家挂机 24 小时不休息，产出量级在 2000 上下，
--   20000 留了 10 倍余量 —— 正常玩法撞不到，撞到的基本就是脚本。
--
-- ⚠️ 本文件重定义 add_material：窗口限流逻辑与 bound（绑定数）逻辑**原样保留**，
--   只在中间插了日级检查那一段。常量与 docs/js/core/config.js 的 Config.security 同步。
-- ============================================================

-- ---------- 日级计数列 ----------
alter table public.security_rate_limits
  add column if not exists day_start date   not null default current_date,
  add column if not exists day_qty   bigint not null default 0;

-- ---------- 重定义 add_material（含 bound，第三参默认 0）----------
drop function if exists public.add_material(text, integer, integer);
create or replace function public.add_material(p_name text, p_amount integer, p_bound integer default 0)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_row      public.security_rate_limits;
  v_window   interval := interval '60 seconds';  -- 与 Config.security.addMaterial.windowSec 同步
  v_max_qty  bigint := 1000;                     -- 窗口上限（同步 maxPerWindow）
  v_max_call bigint := 5000;                     -- 单次上限（同步 maxPerCall）
  v_max_day  bigint := 20000;                    -- ⭐ 日上限（同步 maxPerDay，2026-09-17 新增）
  v_lock     interval := interval '5 minutes';   -- 锁定（同步 lockSec）
  v_bound    integer;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;
  if p_name is null or p_name = '' then
    raise exception '缺少材料名';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  if p_amount > v_max_call then
    raise exception 'ERR_RATE_LIMIT 单次上报材料数量过大';
  end if;

  -- 行锁串行化同一用户的并发上报（防多标签页同时加挤爆窗口）
  select * into v_row from public.security_rate_limits where user_id = v_uid for update;

  -- 锁定期内直接拒绝（正常玩家 60 秒远到不了上限，触发锁 = 脚本风暴）
  if v_row.locked_until is not null and v_row.locked_until > now() then
    raise exception 'ERR_RATE_LIMIT 材料上报过于频繁，请稍后再试';
  end if;

  -- 无记录 / 窗口过期 → 开新窗口
  if v_row is null or (v_row.window_start + v_window) <= now() then
    insert into public.security_rate_limits (user_id, window_start, window_qty, locked_until)
    values (v_uid, now(), 0, null)
    on conflict (user_id) do update
      set window_start = excluded.window_start, window_qty = 0, locked_until = null;
    v_row.window_qty := 0;
  end if;

  -- 跨天 → 日计数清零
  if v_row.day_start is null or v_row.day_start <> current_date then
    update public.security_rate_limits
       set day_start = current_date, day_qty = 0
     where user_id = v_uid;
    v_row.day_qty := 0;
  end if;

  -- 超窗口上限 → 锁 5 分钟再拒（防止每 60 秒刷一次继续偷）
  if (coalesce(v_row.window_qty, 0) + p_amount) > v_max_qty then
    update public.security_rate_limits set locked_until = now() + v_lock where user_id = v_uid;
    raise exception 'ERR_RATE_LIMIT 材料上报过于频繁，请稍后再试';
  end if;

  -- ⭐ 超日上限 → 直接拒（这会话当天不再接受任何上报）
  if (coalesce(v_row.day_qty, 0) + p_amount) > v_max_day then
    raise exception 'ERR_RATE_LIMIT 今日材料上报已达上限（%），如有疑问请联系管理员', v_max_day;
  end if;

  update public.security_rate_limits
     set window_qty = window_qty + p_amount,
         day_qty    = day_qty + p_amount
   where user_id = v_uid;

  -- 绑定数不能超过总数（check 约束 0 <= bound_qty <= quantity）
  v_bound := least(greatest(coalesce(p_bound, 0), 0), p_amount);

  insert into public.materials (user_id, name, quantity, bound_qty)
  values (v_uid, p_name, p_amount, v_bound)
  on conflict (user_id, name) do update
    set quantity  = public.materials.quantity + excluded.quantity,
        bound_qty = least(public.materials.bound_qty + excluded.bound_qty,
                          public.materials.quantity + excluded.quantity);
end;
$$;

revoke all on function public.add_material(text, integer, integer) from public, anon;
grant execute on function public.add_material(text, integer, integer) to authenticated;
