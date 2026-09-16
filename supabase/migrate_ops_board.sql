-- ============================================================
-- 内测看板（2026-09-17）—— 管理员专属
--
-- 要解决的问题：内测最值钱的是数据，但数据现在只能靠"翻数据库"看。
--   PRJECT_CONSTITUTION §二 F-6 就写过一句：「账算不准的原因：缺消耗端数据」，
--   内测正好是补这块的时候。
--
-- 一次返回五块：
--   accounts  账号数 / 今日活跃 / 7 日活跃（profiles.last_seen_at）
--   progress  玩家进度分布（按名下最高宠等级分段）—— 看"新人卡在哪一段"
--   market    在售挂单数（装备/宠物/材料）+ 今日与 7 日成交笔数
--   sweep     系统今天收走了几件（装备/材料分开）—— 看注入水量
--   materials 全服库存 top 12 —— 看哪些材料在堆积（最该开消耗口的那几个）
--   idleNow   此刻正在挂机的人数
--
-- ⚠️ 做不了的一项（诚实标注）：**材料"产出 vs 消耗"的账**。
--   产出只记在 battle_logs.detail（结构未固定），消耗散在各个 RPC 里，
--   没有一张"材料流水账"。要看真正的产出/消耗比，得先建账本 —— 那是另一件事。
--   现在能给的近似：sweep 的注入量 + 库存 top（只涨不消的会浮上来）。
-- ============================================================

create or replace function public.admin_ops_board()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_email  text := auth.jwt() ->> 'email';
  v_admins jsonb;
  v_out    jsonb;
begin
  select coalesce(config -> 'dev' -> 'adminEmails', '[]'::jsonb)
    into v_admins
    from public.game_config_overrides
   where id = true;

  if v_email is null
     or not (coalesce(v_admins, '[]'::jsonb) @> to_jsonb(v_email)
             or v_email = '776492620@qq.com') then
    raise exception 'ERR_NOT_ADMIN';
  end if;

  select jsonb_build_object(
    'accounts', jsonb_build_object(
      'total',    (select count(*) from public.profiles),
      'active1d', (select count(*) from public.profiles where last_seen_at > now() - interval '1 day'),
      'active7d', (select count(*) from public.profiles where last_seen_at > now() - interval '7 days')
    ),
    'idleNow', (select count(*) from public.idle_sessions where status = 'active'),
    'progress', coalesce((
      select jsonb_agg(jsonb_build_object('seg', seg, 'n', n) order by ord)
        from (
          select case
                   when max_level is null      then '0 · 还没宠'
                   when max_level < 10        then '1 · Lv1-9'
                   when max_level < 25        then '2 · Lv10-24'
                   when max_level < 40        then '3 · Lv25-39'
                   when max_level < 60        then '4 · Lv40-59'
                   else                            '5 · Lv60 满级'
                 end as seg,
                 case
                   when max_level is null      then 0
                   when max_level < 10        then 1
                   when max_level < 25        then 2
                   when max_level < 40        then 3
                   when max_level < 60        then 4
                   else                            5
                 end as ord,
                 count(*) as n
            from (
              select p.user_id, max(p.level) as max_level
                from public.pets p
               group by p.user_id
            ) t
           group by 1, 2
        ) s
    ), '[]'::jsonb),
    'market', jsonb_build_object(
      'equipListings',    (select count(*) from public.equip_listings    where status = 'active'),
      'petListings',      (select count(*) from public.pet_listings      where status = 'active'),
      'materialListings', (select count(*) from public.material_listings where status = 'active'),
      'soldToday',        (select count(*) from public.trade_records where role = 'sell' and created_at >= date_trunc('day', now())),
      'sold7d',           (select count(*) from public.trade_records where role = 'sell' and created_at >= now() - interval '7 days')
    ),
    'sweep', jsonb_build_object(
      'equipToday',    (select count(*) from public.market_bot_sweep_log
                         where created_at >= date_trunc('day', now()) and (kind is null or kind = 'equip')),
      'materialToday', (select count(*) from public.market_bot_sweep_log
                         where created_at >= date_trunc('day', now()) and kind = 'material')
    ),
    'materials', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'qty', qty) order by qty desc)
        from (
          select name, sum(quantity) as qty
            from public.materials
           group by name
           order by sum(quantity) desc
           limit 12
        ) m
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

-- 只撤 public / anon；登录用户可调 —— 函数内部自己校验管理员邮箱（ERR_NOT_ADMIN）
revoke all on function public.admin_ops_board() from public, anon;
grant execute on function public.admin_ops_board() to authenticated;
