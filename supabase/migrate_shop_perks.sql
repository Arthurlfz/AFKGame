-- ============================================================
-- migrate_shop_perks.sql —— 魔石改为「便利货币」（2026-09-12 拍板）
--
-- 背景（为什么改）：
--   原商店 5 个 convenience 商品全是「卖材料 = 卖进度」：涅磐兽 ×1、凝魂晶石 ×20、
--   传说进化素材 ×5、宠物蛋 ×1、打造石礼包。三处硬冲突：
--     ① 涅磐兽 2026-09-11 已从 marketBot + Config.trade.materials 摘除，只保留图 10
--        稀有掉落（权重 0.05）→ 商店再卖等于自打脸；
--     ② 凝魂晶石是绑定材料（不可交易），还是满级经验池产物 → 卖它 = 卖成长；
--     ③ 终阶进化已改为「只收传说 ×1」→ 卖 ×5 等于直接跳过进化成本。
--   与项目定调「不学氪金分层 / 不卖数值」直接冲突。
--
-- 改法：商店只卖「便利」——不影响战力、不产出数值的东西。
--   本轮只上一条：市场挂单额度（唯一真实存在的"不便利"，Config.trade.maxListings = 5）。
--   背包扩容/宠物栏位/改名卡等暂不做——那些限制目前根本不存在，
--   先造限制再卖解除 = 先制造痛苦再收费，不做。等玩家真抱怨了再从抱怨里长出来。
-- ============================================================

-- ① 下架卖数值的商品（历史订单保留在 orders 表，不删）
delete from public.products where sku in
  ('mat_phoenix_1', 'mat_legend_5', 'mat_soul_20', 'mat_stone_bundle', 'mat_egg_1');

-- ② 玩家权益表：与 wallets 同款服务端权威（RLS 只有 SELECT，写入只走 spend_gems）
create table if not exists public.user_perks (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  -- 市场挂单额度加成（基础 5 单 + 本列）。上限 10 → 单人最多 15 单，避免一人占满货架。
  listing_slots integer not null default 0
                  check (listing_slots >= 0 and listing_slots <= 10),
  updated_at    timestamptz not null default now()
);

alter table public.user_perks enable row level security;

-- 两层一起收：既没写策略，也没表级写权限（只留策略会让 has_table_privilege 仍返回 true，
-- 以后审计会误判，见 2026-09-12 quest_progress 事故）
revoke all on public.user_perks from anon, authenticated;
grant select on public.user_perks to authenticated;

drop policy if exists user_perks_select_own on public.user_perks;
create policy user_perks_select_own on public.user_perks
  for select to authenticated using (auth.uid() = user_id);

-- ③ 商品：市场挂单额度 +5（限购 2 次 → 最多 +10，与 CHECK 上限对齐）
insert into public.products (sku, title, kind, price_gems, limit_per_user, payload, icon, sort, active) values
  ('perk_listing_5', '市场挂单额度 +5', 'convenience', 20, 2,
   '{"perks":{"listing_slots":5}}', '🏷', 20, true)
on conflict (sku) do update set
  title = excluded.title, kind = excluded.kind, price_gems = excluded.price_gems,
  limit_per_user = excluded.limit_per_user, payload = excluded.payload,
  icon = excluded.icon, sort = excluded.sort, active = excluded.active;

-- ④ spend_gems 发货扩展：除材料外，支持发「权益」
--    ⚠️ 签名未变（仍是 (text, text)），所以直接 create or replace，不需要 drop 旧签名。
create or replace function public.spend_gems(p_sku text, p_client_ref text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_prod  public.products%rowtype;
  v_bal   integer;
  v_used  integer;
  v_k     text;
  v_v     text;
  v_slot  integer;
begin
  if v_uid is null then return 'nologin'; end if;
  select * into v_prod from public.products
   where sku = p_sku and active and price_gems is not null;
  if not found then return 'notfound'; end if;

  -- 限购（已发货的订单才算数）
  if v_prod.limit_per_user is not null then
    select count(*) into v_used from public.orders
     where user_id = v_uid and sku = p_sku and status = 'delivered';
    if v_used >= v_prod.limit_per_user then return 'limit'; end if;
  end if;
  if v_prod.limit_per_day is not null then
    select count(*) into v_used from public.orders
     where user_id = v_uid and sku = p_sku and status = 'delivered'
       and created_at >= date_trunc('day', now());
    if v_used >= v_prod.limit_per_day then return 'limit'; end if;
  end if;

  insert into public.wallets (user_id) values (v_uid) on conflict (user_id) do nothing;
  -- 行锁 + 余额校验必须连着：中间不能有别的逻辑，否则连点会扣出负数
  select w.gems into v_bal from public.wallets w where w.user_id = v_uid for update;
  if v_bal is null or v_bal < v_prod.price_gems then return 'insufficient'; end if;

  update public.wallets set gems = gems - v_prod.price_gems, updated_at = now()
   where user_id = v_uid;
  select w.gems into v_bal from public.wallets w where w.user_id = v_uid;

  -- 发货 ①：材料（走现有 add_material，与掉落同一条链路）
  if v_prod.payload ? 'materials' then
    for v_k, v_v in select * from jsonb_each_text(v_prod.payload -> 'materials') loop
      perform public.add_material(v_k, v_v::integer);
    end loop;
  end if;

  -- 发货 ②：权益（便利类，不进任何战斗数值）。
  --   超出 CHECK 上限时约束会抛异常 → 整个函数回滚（钱自动退回），不会「扣了钱没发货」。
  if v_prod.payload ? 'perks' then
    v_slot := coalesce((v_prod.payload -> 'perks' ->> 'listing_slots')::integer, 0);
    if v_slot > 0 then
      insert into public.user_perks (user_id, listing_slots)
        values (v_uid, v_slot)
      on conflict (user_id) do update
        set listing_slots = public.user_perks.listing_slots + excluded.listing_slots,
            updated_at = now();
    end if;
  end if;

  insert into public.wallet_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (v_uid, -v_prod.price_gems, v_bal, 'spend', 'sku', p_sku);
  insert into public.orders (user_id, sku, gems, status, provider, client_ref, paid_at, delivered_at)
    values (v_uid, p_sku, 0, 'delivered', 'gem', p_client_ref, now(), now())
    on conflict (user_id, client_ref) do nothing;

  return 'ok';
end; $$;
grant execute on function public.spend_gems(text, text) to authenticated;

-- ⑤ 读自己的权益（没有记录时返回 0，不是空表）
create or replace function public.get_my_perks()
returns table (listing_slots integer)
language sql security definer set search_path = public stable as $$
  select coalesce((select p.listing_slots from public.user_perks p where p.user_id = auth.uid()), 0);
$$;
grant execute on function public.get_my_perks() to authenticated;
