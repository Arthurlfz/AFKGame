-- 神宠培育次数（2026-09-11）
-- 每只宠物记录「本轮已培育次数」：神宠一轮上限 10 次（Config.pet.godPets.cultivateMax），涅槃成功时归零。
-- 普通宠恒为 0（培育只对神级宠开放）。
ALTER TABLE public.pets ADD COLUMN IF NOT EXISTS cultivate_used int NOT NULL DEFAULT 0;
