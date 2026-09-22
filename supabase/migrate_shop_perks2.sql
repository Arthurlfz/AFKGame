-- ============================================================
-- migrate_shop_perks2.sql —— 商店第二批：扩容收口 + 流光名牌（2026-09-20）
--
-- 背景（为什么会有这个脚本）：
--   ① 2026-09-16 拍板「装备 / 宠物设上限、卖扩建道具」，当时**只落地了一半**：
--      线上 products 里已经有 perk_bag_50 / perk_pet_5，user_perks 也已经有
--      inventory_slots / pet_slots 两列 —— 但**都没回写进迁移脚本**（库有脚本无）。
--      本脚本先把它们补回来，保证以后重建库不会缺东西。
--   ② 本批新增：流光名牌（name_tags = 已解锁集合 / name_tag = 当前使用），
--      商店新增 2 件礼包 + 4 档名牌。
--
-- 安全边界（改这里之前先读完）：
--   · 扩容与名牌都存 user_perks —— 这张表**只有 SELECT 策略、没有表级写权限**，
--     写入只走 spend_gems / set_name_tag 两个 security definer 函数。
--     ⇒ 玩家改本地 JS 也伪造不出名牌（这是名牌不存 profiles 的原因：
--       profiles 的 update 策略是 auth.uid() = id，玩家能手改自己那一行）。
--   · 名牌要给别人看（聊天 / 市集 / 排行榜）⇒ SELECT 策略放宽为**公开可读**；
--     ⚠️ 写入口依旧只有函数，策略与表级权限**两层一起收**（2026-09-12 踩过：
--        只留策略会让 has_table_privilege 仍返回 true，以后审计会误判）。
--   · 客户端永远不参与发奖：扣魔石与发货在 spend_gems 的同一个事务里，
--     任何一步抛异常都整体回滚（钱自动退回），不会出现「扣了钱没发货」。
-- ============================================================

-- ① 列补齐（幂等）------------------------------------------------
-- inventory_slots / pet_slots：线上已有，这里补回（库有脚本无的老缺口）
alter table public.user_perks add column if not exists inventory_slots integer not null default 0;
alter table public.user_perks add column if not exists pet_slots       integer not null default 0;
-- 名牌：已解锁集合（jsonb 数组）+ 当前使用（null = 不戴）
alter table public.user_perks add column if not exists name_tags jsonb not null default '[]'::jsonb;
alter table public.user_perks add column if not exists name_tag  text;

-- ② CHECK 上限（constraint 不支持 if not exists ⇒ 用 DO 块判存在）------
-- 口径 = 「单买买满 + 礼包买满」的最大值，保证全买满也合法：
--   inventory_slots：单买 5×50=250 ＋ 礼包 50+100=150 ⇒ 400
--                    （正好与 Config.capacity.bag 的 150+250=400 封顶对齐）
--   pet_slots      ：单买 4×5=20  ＋ 礼包 5+10=15   ⇒ 35（Config 封顶 40，留余量）
--   name_tag       ：白名单四档（防止手改库或以后加档时写进奇怪的字符串）
-- ⚠️ 超上限时约束抛异常 ⇒ spend_gems 整个事务回滚（钱自动退回）。
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_perks_inventory_slots_check') then
    alter table public.user_perks add constraint user_perks_inventory_slots_check
      check (inventory_slots >= 0 and inventory_slots <= 400);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_perks_pet_slots_check') then
    alter table public.user_perks add constraint user_perks_pet_slots_check
      check (pet_slots >= 0 and pet_slots <= 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_perks_name_tag_check') then
    alter table public.user_perks add constraint user_perks_name_tag_check
      check (name_tag is null or name_tag in ('jade', 'violet', 'gilded', 'bloodmoon'));
  end if;
end $$;

-- ③ 权限：两层一起收（表级只给 SELECT，写入口只有函数）-----------
revoke all on public.user_perks from anon, authenticated;
grant select on public.user_perks to authenticated;

-- ④ 读策略：从「只看自己」放宽为「登录用户都能看」------------------
-- 为什么：名牌要显示在聊天 / 市集挂单卡 / 排行榜上，别人得读得到。
-- 放宽后暴露的只有「格子数 + 名牌」，没有敏感信息；写入仍然只有函数。
drop policy if exists user_perks_select_own on public.user_perks;
drop policy if exists user_perks_select_all on public.user_perks;
create policy user_perks_select_all on public.user_perks
  for select to authenticated using (true);

-- ⑤ 我的权益：扩成五列（加名牌两列）-----------------------------
-- ⚠️ 返回列变了（3 → 5 列）时 create or replace 会报
--    「cannot change return type of existing function」⇒ **必须先 drop**。
--    drop 与 create 必须包在同一个事务里：否则 DROP 成功、CREATE 失败会留下一段
--    「函数不存在」的空档，前端 getMyPerks 会一路报错（比返回旧结构更糟）。
-- ⚠️ plpgsql / sql 函数里的输出列名在函数体内是变量，所有列表**必须带表别名限定**，
--    否则与表列同名会报 column reference "xxx" is ambiguous —— 这是运行期错误，
--    静态检查与 node 测试都抓不到（2026-09-17 被用户实机抓过一次）。
begin;
drop function if exists public.get_my_perks();
create or replace function public.get_my_perks()
returns table (listing_slots integer, inventory_slots integer, pet_slots integer,
               name_tag text, name_tags jsonb)
language sql security definer set search_path = public stable as $$
  select p.listing_slots, p.inventory_slots, p.pet_slots, p.name_tag, p.name_tags
    from public.user_perks p
   where p.user_id = auth.uid();
$$;
grant execute on function public.get_my_perks() to authenticated;
commit;

-- ⑥ 切换名牌（校验「已解锁」才允许戴）----------------------------
-- 空串 / null = 摘掉名牌（回到无颜色）。买名牌 ≠ 一定戴着，所以这里单独给一个口。
create or replace function public.set_name_tag(p_tag text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_tags jsonb;
begin
  if v_uid is null then return 'nologin'; end if;
  insert into public.user_perks (user_id) values (v_uid) on conflict (user_id) do nothing;

  if p_tag is null or p_tag = '' then
    update public.user_perks set name_tag = null, updated_at = now() where user_id = v_uid;
    return 'ok';
  end if;

  select p.name_tags into v_tags from public.user_perks p where p.user_id = v_uid;
  if not (coalesce(v_tags, '[]'::jsonb) ? p_tag) then return 'notowned'; end if;

  update public.user_perks set name_tag = p_tag, updated_at = now() where user_id = v_uid;
  return 'ok';
end; $$;
grant execute on function public.set_name_tag(text) to authenticated;

-- ⑦ spend_gems：发货逻辑通用化 + 名牌分支 + 幂等 --------------------
-- 相对上一版的改动（就三处，别再多改）：
--   ① perks 从「硬编码 listing / inventory / pet 三段 if」改成**按键循环** ——
--      以后加权益只需在 products 插一行，这个函数不用再动。
--      未知键直接 raise exception（回滚退钱），避免配置写错时静默半发货。
--   ② 新增 cosmetics 分支：解锁名牌并自动切换为当前使用；已解锁的**直接返回 owned、不扣钱**。
--      ⚠️ 这个判定必须在限购检查之前：名牌商品不设 limit_per_user，
--         靠它挡重复购买 —— 玩家再点一次该看到「已拥有」，而不是「已达上限」。
--   ③ 开头补幂等：同一 client_ref 已成交过就直接返回 ok。
--      原来前端给的键是 `${sku}-${秒}`，同一秒内的连点被 orders 的唯一约束挡住，
--      但**钱已经扣了、货也发了** ⇒ 重复扣款。前端另有 buying 闸门，这里补上服务端兜底。
-- 签名未变（仍是 (text, text)）⇒ 直接 create or replace，不需要 drop 旧签名。
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
  v_tag   text;
begin
  if v_uid is null then return 'nologin'; end if;
  select * into v_prod from public.products
   where sku = p_sku and active and price_gems is not null;
  if not found then return 'notfound'; end if;

  -- 幂等：这一单已经成交过（网络重试 / 连点）就直接返回 ok，不再扣钱
  if p_client_ref is not null then
    if exists (select 1 from public.orders o
                where o.user_id = v_uid and o.client_ref = p_client_ref) then
      return 'ok';
    end if;
  end if;

  -- 名牌：已解锁 ⇒ owned（不扣钱）。必须早于限购检查，见上面 ⑦-② 的说明。
  if v_prod.payload ? 'cosmetics' then
    v_tag := v_prod.payload -> 'cosmetics' ->> 'unlock_tag';
    if v_tag is not null and v_tag <> '' then
      insert into public.user_perks (user_id) values (v_uid) on conflict (user_id) do nothing;
      if exists (select 1 from public.user_perks up
                  where up.user_id = v_uid and up.name_tags ? v_tag) then
        return 'owned';
      end if;
    end if;
  end if;

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

  -- 发货 ②：权益（按键循环，见上面 ⑦-①）
  if v_prod.payload ? 'perks' then
    insert into public.user_perks (user_id) values (v_uid) on conflict (user_id) do nothing;
    for v_k, v_v in select * from jsonb_each_text(v_prod.payload -> 'perks') loop
      v_slot := coalesce(v_v::integer, 0);
      if v_slot <> 0 then
        if v_k = 'listing_slots' then
          update public.user_perks set listing_slots = greatest(0, listing_slots + v_slot), updated_at = now()
           where user_id = v_uid;
        elsif v_k = 'inventory_slots' then
          update public.user_perks set inventory_slots = greatest(0, inventory_slots + v_slot), updated_at = now()
           where user_id = v_uid;
        elsif v_k = 'pet_slots' then
          update public.user_perks set pet_slots = greatest(0, pet_slots + v_slot), updated_at = now()
           where user_id = v_uid;
        else
          -- 未知权益键 = 配置写错了：整单回滚退钱，绝不半发货
          raise exception 'spend_gems: unknown perk key %', v_k;
        end if;
      end if;
    end loop;
  end if;

  -- 发货 ③：名牌（买下即永久解锁，并自动切换为当前使用 —— 玩家买完就该立刻看到效果）
  if v_prod.payload ? 'cosmetics' then
    v_tag := v_prod.payload -> 'cosmetics' ->> 'unlock_tag';
    if v_tag is not null and v_tag <> '' then
      if v_tag not in ('jade', 'violet', 'gilded', 'bloodmoon') then
        raise exception 'spend_gems: unknown name tag %', v_tag;
      end if;
      update public.user_perks
         set name_tags = case when name_tags ? v_tag then name_tags else name_tags || to_jsonb(v_tag) end,
             name_tag  = v_tag,
             updated_at = now()
       where user_id = v_uid;
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

-- ⑧ 商品目录（幂等 upsert）--------------------------------------
-- 价格锚：1 元 = 10 魔石。
-- ⚠️ 前两件（背包 / 育兽栏）线上**已经在售、定价 50**，这里按线上现状写（不改价，
--    改价属于数值改动，得用户点头）。
-- ⚠️ 礼包不装「挂单额度」：listing_slots 的 CHECK 是 0~10（= 基础 5 + 单买满档 10），
--    礼包再给就会顶破上限、买的时候直接抛异常。
-- ⚠️ 名牌不设 limit_per_user：重复购买靠 spend_gems 的 owned 判断挡住，
--    这样玩家再点一次看到的是「已拥有」而不是「已达上限」。
--
-- 🔴 图标：一律用项目 2026-09-16 那套**暗黑水墨国风 PNG**（`assets/ui/ic_*.png`），
--    ⛔ **不许用 emoji**（用户 2026-09-20 点名：「为什么还是用 emoji 占位，真的太廉价了」）。
--    emoji 是彩色位图，跟水墨牌匾放一起风格打架；而且它是**字符**，
--    字体一换、平台一换就变形（商店卡片里的 `.shop-card-icon .mat-img` 早就备好了尺寸规则）。
--    挑图标的依据是「像不像这件东西」，不是好看：
--      背包扩建=荷包 ｜ 育兽栏=蛋 ｜ 挂单额度=摊位 ｜ 行囊=箱子 / 王冠（顶档礼包）
--      名牌=玉石 / 符文 / 宝石 / 血晶（都要"能当名字上的徽记"）
insert into public.products (sku, title, kind, price_gems, limit_per_user, payload, icon, sort, active)
select v.sku, v.title, 'convenience', v.price_gems, v.limit_per_user::integer, v.payload::jsonb,
       '<img class="mat-img" src="assets/ui/' || v.ico || '.png" alt="">', v.sort, true
from (values
  ('perk_bag_50',     '背包扩建 +50 格', 50,    5,    '{"perks":{"inventory_slots":50}}',                 'ic_bag',                10),
  ('perk_pet_5',      '育兽栏扩建 +5 位', 50,    4,    '{"perks":{"pet_slots":5}}',                        'ic_egg',                11),
  ('perk_listing_5',  '市场挂单额度 +5',  20,    2,    '{"perks":{"listing_slots":5}}',                    'ic_stall',              12),
  ('bundle_traveler', '旅者行囊',         85,    1,    '{"perks":{"inventory_slots":50,"pet_slots":5}}',   'ic_box',                20),
  ('bundle_pioneer',  '拓荒者行囊',       170,   1,    '{"perks":{"inventory_slots":100,"pet_slots":10}}', 'ic_crown',              21),
  ('tag_jade',        '青玉名牌',         15,    null, '{"cosmetics":{"unlock_tag":"jade"}}',              'ic_mat_souljade',       30),
  ('tag_violet',      '幽紫名牌',         30,    null, '{"cosmetics":{"unlock_tag":"violet"}}',            'ic_rune',               31),
  ('tag_gilded',      '鎏金名牌',         60,    null, '{"cosmetics":{"unlock_tag":"gilded"}}',            'ic_gem',                32),
  ('tag_bloodmoon',   '血月名牌',         100,   null, '{"cosmetics":{"unlock_tag":"bloodmoon"}}',         'ic_mat_bloodcrystal',   33)
) as v(sku, title, price_gems, limit_per_user, payload, ico, sort)
on conflict (sku) do update set
  title = excluded.title, kind = excluded.kind, price_gems = excluded.price_gems,
  limit_per_user = excluded.limit_per_user, payload = excluded.payload,
  icon = excluded.icon, sort = excluded.sort, active = excluded.active;
