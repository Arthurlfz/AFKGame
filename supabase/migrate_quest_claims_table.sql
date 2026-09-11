-- ============================================================
-- migrate_quest_claims_table.sql —— 领取记录独立成表（修 403）
--
-- 事故（2026-09-12 玩家控制台刷屏）：
--   quest_progress 的 upsert 全量 403 → 任务进度一个字都存不上去。
--
-- 根因：migrate_quest_claim.sql 为了保护 claimed 列，把【表级】insert/update
--   收掉、只留【列级】grant。PostgREST 的权限探测只认表级
--   has_table_privilege(...)（实测：select 为 true、insert/update 均为 false），
--   于是它连 upsert 计划都不生成，直接 403。
--   —— 而 Postgres 本身是放行的（列级权限足够，本地模拟 upsert 通过），
--      所以这是「PostgREST 层的权限模型」问题，不是 SQL 权限写错了。
--
-- 修法（换方案，不再靠列级权限）：
--   「这条任务领过没有」本来就不该放在客户端可写的表里。
--   独立成表 quest_claims —— 客户端对它【没有任何写权限】，连列都碰不到。
--   quest_progress 恢复表级 insert/update（进度照常存），claimed 列整个删掉。
--
-- 顺带：drop 掉 battle_settle 的旧 9 参签名（migrate_settle_reward_tx.sql
--   第 4 步漏执行 → 两个重载 → PostgREST 300 → battle-settle EF 500）。
-- ============================================================

-- 1) 领取记录独立表：主键 (user_id, claim_key) 天然保证「同一键只能插一次」
create table if not exists public.quest_claims (
  user_id    uuid  not null,
  claim_key  text  not null,
  claimed_at bigint not null default extract(epoch from now())::bigint,
  primary key (user_id, claim_key)
);

alter table public.quest_claims enable row level security;

drop policy if exists quest_claims_select_own on public.quest_claims;
create policy quest_claims_select_own on public.quest_claims
  for select using (user_id = auth.uid());

-- 客户端与 anon 一律不给写；写只走 security definer 的 complete_quest
revoke all on public.quest_claims from public, anon, authenticated;
grant select on public.quest_claims to authenticated;

-- 2) 搬旧数据（quest_progress.claimed 是 {键: 时间戳}）
insert into public.quest_claims (user_id, claim_key, claimed_at)
select qp.user_id,
       k.key,
       coalesce(nullif(k.value #>> '{}', '')::bigint, extract(epoch from now())::bigint)
  from public.quest_progress qp
  cross join jsonb_each(qp.claimed) k
on conflict (user_id, claim_key) do nothing;

-- 3) 领取：插入成功 = 首次领取；冲突 = 已领过（堵重领的就是这一句）
create or replace function public.complete_quest(p_quest_id text, p_period_key text default '')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_cnt integer;
begin
  if v_uid is null then return 'ERR_NO_LOGIN'; end if;
  if p_quest_id is null or btrim(p_quest_id) = '' then return 'ERR_BAD_ID'; end if;

  -- 一次性任务：键 = 任务 id；日常/周常：键 = 任务id@周期键（与 quest.js 同口径）
  v_key := case
    when p_period_key is null or btrim(p_period_key) = '' then left(btrim(p_quest_id), 64)
    else left(btrim(p_quest_id), 64) || '@' || left(btrim(p_period_key), 32)
  end;

  with ins as (
    insert into public.quest_claims (user_id, claim_key, claimed_at)
    values (v_uid, v_key, extract(epoch from now())::bigint)
    on conflict (user_id, claim_key) do nothing
    returning 1
  )
  select count(*) into v_cnt from ins;

  if v_cnt = 0 then return 'ALREADY_CLAIMED'; end if;
  return 'OK';
end;
$$;
revoke execute on function public.complete_quest(text, text) from public, anon;
grant execute on function public.complete_quest(text, text) to authenticated;

-- 4) 撤销（管理员/测试用）：与 migrate_admin_tools 同口径，比管理员邮箱
create or replace function public.admin_unclaim_quest(p_user_id uuid, p_quest_id text, p_period_key text default '')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if auth.jwt() ->> 'email' <> '776492620@qq.com' then return 'ERR_NOT_ADMIN'; end if;
  v_key := case
    when p_period_key is null or btrim(p_period_key) = '' then left(btrim(p_quest_id), 64)
    else left(btrim(p_quest_id), 64) || '@' || left(btrim(p_period_key), 32)
  end;
  delete from public.quest_claims where user_id = p_user_id and claim_key = v_key;
  return 'OK';
end;
$$;
revoke execute on function public.admin_unclaim_quest(uuid, text, text) from public, anon, authenticated;

-- 5) 恢复 quest_progress 的表级写权限（PostgREST 只认这个），claimed 列不再需要
grant insert, update on public.quest_progress to authenticated;
alter table public.quest_progress drop column if exists claimed;

-- 6) 清掉 battle_settle 旧签名（migrate_settle_reward_tx.sql 第 4 步）
--    留着它 → PostgREST 300 → battle-settle EF 返回 500
drop function if exists public.battle_settle(uuid, integer, integer, jsonb, timestamptz, timestamptz, integer, timestamptz, jsonb);

-- ============================================================
-- 已知边界（与 migrate_quest_claim.sql 相同，未解决）：
--   1. 日常/周常的周期键由客户端传，改前端可伪造新周期键多领一次（收益低）。
--   2. 任务【进度】（打怪计数）仍是客户端权威。
--   3. delete 权限仍不对客户端开放 —— 没人需要删自己的进度行。
-- ============================================================
