-- ============================================================
-- 孵化「挑蛋 + 打标记」合成一个服务端函数：public.hatch_egg(p_base_name text, p_pet_id uuid) → uuid
-- 2026-09-15 新增。落地方式：Supabase 控制台 SQL 编辑器整段执行（或 MCP supabase_apply_migration）。
-- ------------------------------------------------------------
-- 动机（减往返）：客户端原来是两步 ——
--   ① SELECT 找一颗该品种「未孵化」的蛋（含旧数据兼容：egg_type 为 null 的蛋归到通用品种「宠物蛋」）
--   ② UPDATE 把它标成「已孵化」并写上 pet_id
-- 两步 = 两趟 HTTP；而且两步之间没有互斥，两个标签页同时孵化时理论上会挑到同一颗蛋
-- （客户端靠 drop.js 的 hatching 闸门挡连点，但那是【单页面】的锁，跨标签页挡不住）。
--
-- 本函数把两步合进一个事务：
--   · 挑蛋用 `order by created_at asc limit 1 for update` 行锁；
--   · 后到的并发调用拿到锁后会按 READ COMMITTED 的 EvalPlanQual 重新校验 status，
--     那颗蛋已被标记就不再匹配 → 不会两颗名字挂到同一颗蛋上（pet_id 被覆盖）。
--
-- 返回值：成功 = 被标记的那颗蛋的 id；该品种没有可孵化的蛋 = NULL（客户端按"没蛋"提示）。
-- ⚠️ owner_id 是 **text** 列（不是 uuid）⇒ 必须写 auth.uid()::text，别直接比 uuid。
-- ============================================================

drop function if exists public.hatch_egg(text, uuid);

create or replace function public.hatch_egg(p_base_name text, p_pet_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid text := auth.uid()::text;
  v_id  uuid;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;
  if p_base_name is null or p_base_name = '' then
    return null;
  end if;

  /* 挑一颗该品种「未孵化」的蛋。
   * 旧数据兼容：加 egg_type 列之前掉的蛋 egg_type 是 null，客户端把它们归到通用品种「宠物蛋」显示，
   * 所以孵「宠物蛋」时必须把 null 一起收 —— 否则这颗蛋永远孵不掉（本地扣了、云端没标记，刷新后又"复活"）。 */
  select e.id into v_id
    from public.pet_egg e
   where e.owner_id = v_uid
     and e.status = '未孵化'
     and (
       (p_base_name = '宠物蛋' and (e.egg_type is null or e.egg_type = p_base_name))
       or (p_base_name <> '宠物蛋' and e.egg_type = p_base_name)
     )
   order by e.created_at asc
   limit 1
     for update;

  if v_id is null then
    return null;   -- 该品种没有可孵化的蛋
  end if;

  update public.pet_egg
     set status = '已孵化', pet_id = p_pet_id
   where id = v_id;

  return v_id;
end;
$function$;

-- 权限对齐其它材料/资产类 RPC：authenticated + service_role（不给 anon）
-- ⚠️ Supabase 在 public schema 有 DEFAULT PRIVILEGES，新建函数会被【直接】授予 anon，
--    只 revoke public 删不掉它，必须点名 revoke execute ... from anon（踩过）。
revoke all on function public.hatch_egg(text, uuid) from public;
revoke execute on function public.hatch_egg(text, uuid) from anon;
grant execute on function public.hatch_egg(text, uuid) to authenticated;
grant execute on function public.hatch_egg(text, uuid) to service_role;

-- 自查
-- select p.proname, p.prosecdef, p.proacl from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public' and p.proname='hatch_egg';
