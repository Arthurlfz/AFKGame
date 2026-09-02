-- ============================================================
-- 追加迁移：pets 表补 is_active 列（出战标记）
-- 在 Supabase SQL Editor 执行一次（幂等，可重复执行）
--
-- 背景（Bug 修复）：
--   代码（supabase.js / pet.js / main.js）一直按 pets.is_active 还原"出战宠物"，
--   但建表 SQL（schema_pets.sql）漏建了这一列，导致：
--     1. loadPets() 查询带 is_active → PostgREST 报 400「column does not exist」
--        → 登录/刷新后云端宠物读取失败 → 界面退回初始莱姆
--     2. 切换出战（setActive）时 updatePet 写 is_active → 同样失败
--   补列后：登录从数据库读当前出战宠物，刷新页面不再变回莱姆。
-- ============================================================

alter table public.pets
  add column if not exists is_active boolean not null default false;

-- 已有存档兼容：如果玩家名下没有任何出战标记（旧数据），
-- 把最早建档的一只设为出战，保证刷新后有确定出战的宠物（其余保持 false）
update public.pets p
set is_active = true
where p.is_active = false
  and p.id = (
    select p2.id
    from public.pets p2
    where p2.user_id = p.user_id
    order by p2.created_at asc
    limit 1
  )
  and not exists (
    select 1 from public.pets p3
    where p3.user_id = p.user_id and p3.is_active = true
  );
