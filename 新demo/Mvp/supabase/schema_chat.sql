-- ============================================================
-- 宠物养成循环原型 · 实时聊天表
-- 在 Supabase Dashboard → SQL Editor 里执行一次即可
-- 用途：玩家之间实时聊天（发送消息 + Realtime 订阅广播）
-- 字段：id / user_id（发送者）/ sender_name（显示名）/ message（纯文本）/ created_at
-- ============================================================

create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  sender_name text not null default '玩家',
  message     text not null,
  created_at  timestamptz not null default now()
);

-- 行级安全：公开聊天室 —— 任何人可读历史，登录用户只能插入自己的消息
alter table public.chat_messages enable row level security;

create policy "chat_select_all" on public.chat_messages
  for select using (true);

create policy "chat_insert_own" on public.chat_messages
  for insert with check (auth.uid() = user_id);

-- ============================================================
-- 启用 Realtime：让客户端订阅 chat_messages 的 INSERT 变更，
-- 别人发消息时所有在线玩家实时收到。
-- 需在 Dashboard → Database → Replication → 勾选 public.chat_messages
-- （或执行下面这行；新版 Dashboard 建议直接在 UI 勾选）
-- ============================================================
alter publication supabase_realtime add table public.chat_messages;
