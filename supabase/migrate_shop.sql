-- ============================================================
-- 魔石（充值货币）+ 商店：第三批付费系统
-- 对应《数据库与付费系统完整设计 v1》第 2 章：wallets / wallet_ledger / products / orders / redeem_codes
-- 用法：Supabase Dashboard → SQL Editor → 整段粘贴 → Run（幂等，可重复执行）
-- 设计原则：
--   1. 余额（wallets）前端【只能读】，不给任何写策略 —— 所有加减都走 security definer 函数
--   2. 商品价格服务端从 products 查，前端传什么都不影响实付
--   3. 每笔变动写 wallet_ledger（append-only），玩家问"我的魔石呢"能一笔笔对出来
-- 现有表一行都不改。
--
-- ⚠️ 2026-08-31 用户拍板：不做个人收款码 / 私下转账发卡密（易被举报，且违反微信/支付宝个人码服务协议）。
--    本文件建的钱包/卡密/商品/订单结构【保留】：自测阶段用 grant_gems 给自己发魔石跑通流程。
--    只有将来接了官方支付 SDK（需企业主体 + 版号 + ICP 等资质）之后，才对外开放充值。
-- ============================================================

-- ---------- 1. 钱包余额 ----------
create table if not exists public.wallets (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  gems            integer not null default 0 check (gems >= 0),
  total_recharged integer not null default 0,
  updated_at      timestamptz not null default now()
);
alter table public.wallets enable row level security;
drop policy if exists "wallets_select_own" on public.wallets;
-- 只给 select：余额的加减只能由下面的函数来做（防玩家改 JS 自充）
create policy "wallets_select_own" on public.wallets
  for select to authenticated using (auth.uid() = user_id);

-- 注册自动开钱包（触发器）
create or replace function public.handle_new_user_wallet()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.wallets (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created_wallet on auth.users;
create trigger on_auth_user_created_wallet
  after insert on auth.users for each row execute function public.handle_new_user_wallet();

-- 已注册的老账号补一行（幂等）
insert into public.wallets (user_id)
select id from auth.users on conflict (user_id) do nothing;

-- ---------- 2. 魔石流水（append-only） ----------
create table if not exists public.wallet_ledger (
  id            bigserial primary key,
  user_id       uuid not null,
  delta         integer not null,
  balance_after integer not null,
  reason        text not null,
  ref_type      text,
  ref_id        text,
  created_at    timestamptz not null default now()
);
create index if not exists wallet_ledger_user_idx on public.wallet_ledger (user_id, created_at desc);
alter table public.wallet_ledger enable row level security;
drop policy if exists "wallet_ledger_select_own" on public.wallet_ledger;
create policy "wallet_ledger_select_own" on public.wallet_ledger
  for select to authenticated using (auth.uid() = user_id);

-- ---------- 3. 商品 ----------
create table if not exists public.products (
  sku            text primary key,
  title          text not null,
  kind           text not null check (kind in ('recharge', 'cosmetic', 'convenience', 'bundle')),
  price_cents    integer,                 -- 人民币「分」（只有 kind=recharge 用）
  price_gems     integer,                 -- 魔石价（商店购买用）
  gems           integer not null default 0,  -- 充值档位给多少魔石
  bonus_gems     integer not null default 0,  -- 额外赠送
  payload        jsonb not null default '{}'::jsonb, -- 发货内容：{"materials":{"涅磐兽":1}}
  icon           text not null default '🪙',
  limit_per_user integer,
  limit_per_day  integer,
  active         boolean not null default true,
  sort           integer not null default 100
);
alter table public.products enable row level security;
drop policy if exists "products_read_active" on public.products;
create policy "products_read_active" on public.products
  for select to authenticated using (active);

-- ---------- 4. 订单 ----------
create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  sku               text not null,
  amount_cents      integer,
  gems              integer not null default 0,
  status            text not null default 'pending'
                    check (status in ('pending', 'paid', 'delivered', 'closed', 'refunded')),
  provider          text,               -- redeem 卡密 / gem 魔石 / manual 手工
  provider_order_id text,
  client_ref        text,               -- 幂等键：连点两次只成一单
  created_at        timestamptz not null default now(),
  paid_at           timestamptz,
  delivered_at      timestamptz,
  unique (user_id, client_ref)
);
create index if not exists orders_user_idx on public.orders (user_id, created_at desc);
alter table public.orders enable row level security;
drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own" on public.orders
  for select to authenticated using (auth.uid() = user_id);

-- ---------- 5. 卡密 ----------
create table if not exists public.redeem_codes (
  code        text primary key,
  sku         text not null references public.products(sku),
  max_uses    integer not null default 1,
  used_count  integer not null default 0,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);
-- 不给任何策略：玩家读不到码表，只能拿码来兑
alter table public.redeem_codes enable row level security;

-- ============================================================
-- 服务端函数（前端唯一入口；余额只在这里被改动）
-- ============================================================

-- ① 查余额（缺行自动补 0，老账号不会查不到）
create or replace function public.get_my_wallet()
returns table (gems integer, total_recharged integer)
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  insert into public.wallets (user_id) values (v_uid) on conflict (user_id) do nothing;
  return query select w.gems, w.total_recharged from public.wallets w where w.user_id = v_uid;
end; $$;
grant execute on function public.get_my_wallet() to authenticated;

-- ② 卡密兑换：返回 'ok:数量' / 'nologin' / 'notfound' / 'used' / 'expired'
create or replace function public.redeem_code(p_code text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_code public.redeem_codes%rowtype;
  v_prod public.products%rowtype;
  v_gain integer;
  v_bal  integer;
begin
  if v_uid is null then return 'nologin'; end if;
  -- 锁住这一行：并发兑换同一张码只可能成功一次
  select * into v_code from public.redeem_codes where code = p_code for update;
  if not found then return 'notfound'; end if;
  if v_code.used_count >= v_code.max_uses then return 'used'; end if;
  if v_code.expires_at is not null and v_code.expires_at < now() then return 'expired'; end if;

  select * into v_prod from public.products
   where sku = v_code.sku and active and kind = 'recharge';
  if not found then return 'notfound'; end if;

  v_gain := v_prod.gems + v_prod.bonus_gems;
  insert into public.wallets (user_id) values (v_uid) on conflict (user_id) do nothing;
  update public.wallets
     set gems = gems + v_gain, total_recharged = total_recharged + v_gain, updated_at = now()
   where user_id = v_uid;
   select w.gems into v_bal from public.wallets w where w.user_id = v_uid;
  insert into public.wallet_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (v_uid, v_gain, v_bal, 'recharge', 'redeem_code', p_code);
  insert into public.orders (user_id, sku, gems, status, provider, client_ref, paid_at, delivered_at)
    values (v_uid, v_prod.sku, v_gain, 'delivered', 'redeem', p_code, now(), now())
    on conflict (user_id, client_ref) do nothing;
  update public.redeem_codes set used_count = used_count + 1 where code = p_code;

  return 'ok:' || v_gain;
end; $$;
grant execute on function public.redeem_code(text) to authenticated;

-- ③ 用魔石买东西：返回 'ok' / 'nologin' / 'notfound' / 'insufficient' / 'limit'
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

  -- 发货：payload.materials = { "材料名": 数量 }（走现有 add_material，与掉落同一条链路）
  if v_prod.payload ? 'materials' then
    for v_k, v_v in select * from jsonb_each_text(v_prod.payload -> 'materials') loop
      perform public.add_material(v_k, v_v::integer);
    end loop;
  end if;

  insert into public.wallet_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (v_uid, -v_prod.price_gems, v_bal, 'spend', 'sku', p_sku);
  insert into public.orders (user_id, sku, gems, status, provider, client_ref, paid_at, delivered_at)
    values (v_uid, p_sku, 0, 'delivered', 'gem', p_client_ref, now(), now())
    on conflict (user_id, client_ref) do nothing;

  return 'ok';
end; $$;
grant execute on function public.spend_gems(text, text) to authenticated;

-- ④ 管理员发放（自测靠这个给自己发魔石，不用真付款）
--    只有管理员邮箱能调（2026-08-31 已填用户本人邮箱）
create or replace function public.grant_gems(p_user_id uuid, p_amount integer, p_reason text)
returns text
language plpgsql security definer set search_path = public as $$
declare v_bal integer;
begin
  if auth.jwt() ->> 'email' <> '776492620@qq.com' then return 'forbidden'; end if;
  if p_amount is null or p_amount <= 0 then return 'badamount'; end if;
  insert into public.wallets (user_id) values (p_user_id) on conflict (user_id) do nothing;
  update public.wallets set gems = gems + p_amount, updated_at = now() where user_id = p_user_id;
  select w.gems into v_bal from public.wallets w where w.user_id = p_user_id;
  insert into public.wallet_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
    values (p_user_id, p_amount, v_bal, coalesce(p_reason, 'admin'), 'manual', null);
  return 'ok';
end; $$;
grant execute on function public.grant_gems(uuid, integer, text) to authenticated;

-- ============================================================
-- 商品初始数据（幂等 upsert；改价格/上下架直接改这里再跑一遍，或改 active 列）
-- 定价基准：1 元 = 10 魔石（改档位价格时，price_cents ÷ 10 = gems）
-- ============================================================
insert into public.products (sku, title, kind, price_cents, price_gems, gems, bonus_gems, payload, icon, sort) values
  ('gems_60',   '小袋魔石', 'recharge',  600, null,  60,   6, '{}', '🪙', 1),
  ('gems_320',  '中袋魔石', 'recharge', 3000, null, 320,  40, '{}', '💰', 2),
  ('gems_1080', '大袋魔石', 'recharge', 9800, null, 1080, 180, '{}', '👑', 3),
  ('mat_phoenix_1', '涅磐兽 ×1',      'convenience', null, 30, 0, 0, '{"materials":{"涅磐兽":1}}',                                     '🐉', 10),
  ('mat_legend_5',  '传说进化素材 ×5', 'convenience', null, 20, 0, 0, '{"materials":{"传说进化素材":5}}',                               '✨', 11),
  ('mat_soul_20',   '凝魂晶石 ×20',    'convenience', null, 25, 0, 0, '{"materials":{"凝魂晶石":20}}',                                  '🔷', 12),
  ('mat_stone_bundle', '打造石礼包',   'convenience', null, 20, 0, 0, '{"materials":{"重铸石":5,"剥离石":5,"神圣石":5,"增缀石":5}}',   '🎲', 13),
  ('mat_egg_1',     '宠物蛋 ×1',      'convenience', null, 40, 0, 0, '{"materials":{"宠物蛋":1}}',                                     '🥚', 14)
on conflict (sku) do update set
  title = excluded.title, kind = excluded.kind, price_cents = excluded.price_cents,
  price_gems = excluded.price_gems, gems = excluded.gems, bonus_gems = excluded.bonus_gems,
  payload = excluded.payload, icon = excluded.icon, sort = excluded.sort;

-- ---------- 发卡（自测用）：下面这行是示例，发一批码时改数量和 sku 再跑 ----------
-- insert into public.redeem_codes (code, sku, max_uses)
-- select 'SOUL-' || substr(md5(random()::text), 1, 8), 'gems_60', 1
-- from generate_series(1, 10);
-- 然后查出来发给玩家：select code from public.redeem_codes where sku='gems_60' order by created_at desc limit 10;
