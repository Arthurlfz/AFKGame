-- ============================================================
-- 市场脉动（2026-09-17）：在线人数 + 最近成交
--
-- 要解决的问题：市集页现在"看起来是死的"—— 玩家挂完单，页面毫无动静，
-- 不知道有没有人在看、有没有人在买。市场活不活，玩家是【看出来】的不是【算出来】的。
--
-- 一个 RPC 同时给两个数：
--   online  最近 10 分钟有心跳的不同账号数（user_sessions.last_seen_at）
--   deals   最近 N 笔卖出的成交（谁买走了什么、多少钱）
--
-- ⚠️ 为什么必须走 security definer：
--   user_sessions / trade_records 的 RLS 都只允许读【自己】的行，
--   所以要靠这个函数在受控范围内聚合，再把聚合结果（不暴露 uuid）发出去。
--   返回里【不含任何 user_id】，只有昵称与物品名 —— 和市场挂单能看到的信息一致。
-- ============================================================

create or replace function public.market_pulse(p_limit int default 8)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'online', (
      select count(distinct s.user_id)
        from public.user_sessions s
       where s.revoked_at is null
         and s.last_seen_at > now() - interval '10 minutes'
    ),
    'deals', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'item', t.item_name,
                 'who',  t.counterparty,
                 'qty',  t.price_qty,
                 'mat',  t.material_type,
                 'at',   t.created_at
               )
               order by t.created_at desc
             )
      from (
        select r.item_name, r.counterparty, r.price_qty, r.material_type, r.created_at
          from public.trade_records r
         where r.role = 'sell'
         order by r.created_at desc
         limit greatest(1, least(coalesce(p_limit, 8), 20))
      ) t
    ), '[]'::jsonb)
  );
$$;

-- 登录玩家可读（这就是给玩家看的），匿名不给
revoke all on function public.market_pulse(int) from public, anon;
grant execute on function public.market_pulse(int) to authenticated;
