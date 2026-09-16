-- ============================================================
-- 玩家反馈表（2026-09-17）
--
-- 为什么需要：内测最值钱的东西是玩家的抱怨。以前玩家遇到 bug 只能去群里说，
-- 或者干脆不说 —— 而"干脆不说"是内测最大的损失（他不说你就永远不知道）。
--
-- 设计要点：
--   ① 玩家只能【写自己的】，不能读、不能改、不能删（连自己的也读不了 ——
--      反馈是给管理员看的，不存在"我的反馈列表"这个需求，少一条读路径少一个面）
--   ② 管理员通过 security definer 函数读，走项目已有的管理员邮箱口径
--      （与 migrate_quest_claim / migrate_admin_tools / migrate_shop 同口径）
--   ③ ctx 字段存自动带的上下文（当前页面 / 版本号 / 最近报错），
--      玩家不用自己描述"我在哪遇到的"
-- ============================================================

create table if not exists public.feedback (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid(),
  email      text,
  nickname   text,
  kind       text not null default 'bug',   -- bug / idea / other
  body       text not null,
  ctx        text,                           -- 自动带的上下文（页面/版本/最近报错）
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

-- 玩家只能插自己的一行（user_id 默认就是 auth.uid()，客户端不用传）
drop policy if exists feedback_insert_own on public.feedback;
create policy feedback_insert_own on public.feedback
  for insert to authenticated
  with check (auth.uid() = user_id);

-- 除了"插自己的一条"，其它一切权限都不给（读/改/删一律没有）
revoke all on public.feedback from public, anon, authenticated;
grant insert (user_id, email, nickname, kind, body, ctx) on public.feedback to authenticated;

-- ---------- 管理员读取 ----------
create or replace function public.admin_list_feedback(p_limit int default 50)
returns table (
  id         bigint,
  email      text,
  nickname   text,
  kind       text,
  body       text,
  ctx        text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text := auth.jwt() ->> 'email';
  v_admins jsonb;
begin
  -- 管理员名单：优先读 game_config_overrides 的 dev.adminEmails，兼容既有硬编码口径
  select coalesce(config -> 'dev' -> 'adminEmails', '[]'::jsonb)
    into v_admins
    from public.game_config_overrides
   where id = true;

  if v_email is null
     or not (coalesce(v_admins, '[]'::jsonb) @> to_jsonb(v_email)
             or v_email = '776492620@qq.com') then
    raise exception 'ERR_NOT_ADMIN';
  end if;

  return query
    select f.id, f.email, f.nickname, f.kind, f.body, f.ctx, f.created_at
      from public.feedback f
     order by f.created_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

-- 只撤 public / anon；登录用户可调 —— 函数内部自己校验管理员邮箱（ERR_NOT_ADMIN）
-- ⚠️ 2026-09-17 修正：第一版写成 `from public, anon, authenticated`，
--    等于把管理员自己也挡在门外（authenticated 正是管理员的角色）。
revoke all on function public.admin_list_feedback(int) from public, anon;
grant execute on function public.admin_list_feedback(int) to authenticated;
