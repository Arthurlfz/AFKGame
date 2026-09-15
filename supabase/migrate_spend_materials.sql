-- ============================================================
-- 多材料「原子扣减」RPC：public.spend_materials(p_items jsonb) → boolean
-- 2026-09-15 新增。落地方式：Supabase 控制台 SQL 编辑器整段执行（或 MCP supabase_apply_migration）。
-- ------------------------------------------------------------
-- 动机（减往返）：涅槃 / 合成 / 进化 / 收集类任务一次要扣 2~N 种材料，
-- 原先靠客户端循环调单体版 spend_material —— **N 种材料 = N 趟 HTTP**，
-- 并且"扣到一半失败"要靠客户端逐级 Materials.gain 回滚（中间态真实存在过，玩家可能看到材料被吞再吐回）。
--
-- 本函数把整批扣减挪到服务端一个事务里：
--   全部扣成功 → 返回 true；任一项不足/非法 → raise 触发**整体回滚**（前面已扣的自动退回）。
--   ⇒ 往返 1 趟；而且**不存在扣一半的中间态**（比原来的"扣一半再退回"更强）。
--
-- ⚠️ 为什么必须 raise 而不是 return false：PL/pgSQL 里普通的 return **不会**回滚本函数已执行的 update，
--    只有抛异常（未被捕获）才会让整个事务回滚。这是本函数"原子"的全部依据，别改成 return false。
-- ⚠️ 语义与单体版 spend_material 严格一致：绝不允许扣成负数（条件里带 quantity >= need）。
-- ============================================================

drop function if exists public.spend_materials(jsonb);

create or replace function public.spend_materials(p_items jsonb)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_item  jsonb;
  v_name  text;
  v_amt   integer;
  v_pos   integer;
  v_names text[] := array[]::text[];
  v_needs integer[] := array[]::integer[];
  i       integer;
begin
  if v_uid is null then return false; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return false; end if;

  -- ① 收集 + 归并同名材料。
  --    同名必须合并成一笔：分两笔扣时第一笔会把余额吃到不够第二笔，导致"明明有货却扣失败"
  --    （客户端 pet_evolve.js 里为这个坑专门写过合并逻辑，这里在服务端再兜一次，调用方不用自己合并）。
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_name := v_item->>'name';
    v_amt  := coalesce((v_item->>'amount')::int, 0);
    if v_name is null or v_name = '' or v_amt <= 0 then
      return false;  -- 非法项：一个都不扣
    end if;
    v_pos := array_position(v_names, v_name);
    if v_pos is null then
      v_names := v_names || v_name;
      v_needs := v_needs || v_amt;
    else
      v_needs[v_pos] := v_needs[v_pos] + v_amt;
    end if;
  end loop;

  -- p_items = [] → 空循环 → 返回 true（没有要扣的，算成功）
  for i in 1 .. coalesce(array_length(v_names, 1), 0) loop
    update public.materials
       set quantity = quantity - v_needs[i]
     where user_id = v_uid and name = v_names[i] and quantity >= v_needs[i];
    if not found then
      -- 行不存在 / 余额不足 → 抛异常让整个函数回滚（含前面已扣的那几项）
      raise exception 'INSUFFICIENT_MATERIAL:%', v_names[i];
    end if;
  end loop;

  return true;
end;
$function$;

-- 权限对齐单体版 spend_material：authenticated + service_role（不给 anon）
-- ⚠️ 只 revoke public 不够！Supabase 在 public schema 上有 DEFAULT PRIVILEGES，
--    新建函数会被**直接**授予 anon/authenticated/service_role（不是通过 PUBLIC），
--    所以 anon 必须点名 revoke —— 首次执行时实测残留 `anon=X`，加这一行后才干净。
revoke all on function public.spend_materials(jsonb) from public;
revoke execute on function public.spend_materials(jsonb) from anon;
grant execute on function public.spend_materials(jsonb) to authenticated;
grant execute on function public.spend_materials(jsonb) to service_role;

-- 自查：函数应存在、SECURITY DEFINER 为 true、ACL 含 authenticated
-- select p.proname, p.prosecdef, p.proacl from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public' and p.proname='spend_materials';
