/* ============================================================
 * quest.js —— 任务系统（多类型，配置驱动）
 * 支持 3 种任务类型（config.drop.quests 里配 type）：
 *   - collect：收集材料（进度 = 玩家拥有的该材料数，天然实时）
 *   - evolve ：进化宠物（进度 = 本会话累计进化次数，由 pet_evolve 上报）
 *   - kill   ：击败怪（进度 = 本会话在指定图击败数，由 main 上报）
 * 手动加任务 = 在 config.drop.quests 数组加一行，不用改本文件逻辑。
 * 任务跟图绑定：unlockLevel（出战宠物等级达标即解锁）。可接多个、可重复交。
 * 依赖：materials.js、battle.js(已解锁区域)、main.js/pet_evolve.js(上报进度)
 * ============================================================ */
(function () {
  'use strict';
  const Config = window.Config;
  const Materials = window.Materials;

  const accepted = new Set();      // 已接任务 id
  let progress = {};               // 进度累计（evolve/kill 用），账号级、纯云端

  // 登录/恢复时从云端拉任务进度（quest_progress 表，按 user_id），覆盖本地内存
  async function loadCloudProgress() {
    const Supabase = window.Supabase;
    if (!Supabase || !Supabase.fetchQuestProgress) return;
    const { data, error } = await Supabase.fetchQuestProgress();
    if (!error && data && typeof data === 'object') {
      progress = data;
    }
  }
  // 写回云端（账号级，未登录静默）
  async function pushCloudProgress() {
    const Supabase = window.Supabase;
    if (!Supabase || !Supabase.saveQuestProgress) return;
    await Supabase.saveQuestProgress(progress);
  }
  // 本地累计 + 写云端（云端失败静默，下次登录拉取兜底）
  function saveProgress() {
    if (window.Supabase && window.Supabase.saveQuestProgress) {
      window.Supabase.saveQuestProgress(progress).catch(() => {});
    }
  }

  // 任务是否解锁：出战宠物等级 >= unlockLevel
  function isUnlocked(q) {
    const active = window.Pet && window.Pet.getActivePet ? window.Pet.getActivePet() : null;
    const lv = active ? active.level : 0;
    return lv >= (q.unlockLevel || 1);
  }

  function questType(q) { return q.type || 'collect'; }

  // 当前进度值（按类型）
  function currentProgress(q) {
    if (questType(q) === 'collect') return Materials.getQuantity(q.matName);
    return progress[q.id] || 0;
  }

  function getQuests() {
    return (Config.drop.quests || []).map(q => {
      const have = currentProgress(q);
      const p = Math.min(have, q.need);
      return {
        id: q.id, type: questType(q), area: q.area, matName: q.matName,
        need: q.need, reward: q.reward, unlockLevel: q.unlockLevel,
        have, progress: p, done: have >= q.need, unlocked: isUnlocked(q), accepted: accepted.has(q.id)
      };
    });
  }

  function acceptQuest(id) { accepted.add(id); return true; }

  // 上报进度（evolve/kill 由外部调用）
  function report(id, amount) { progress[id] = (progress[id] || 0) + (amount || 1); saveProgress(); }

  // 完成/提交任务
  async function completeQuest(id) {
    const q = (Config.drop.quests || []).find(x => x.id === id);
    if (!q) return { error: '任务不存在' };
    const type = questType(q);
    if (!isUnlocked(q)) return { error: '任务尚未解锁' };
    if (currentProgress(q) < q.need) {
      const left = q.need - currentProgress(q);
      return { error: `还差 ${left} ${type === 'collect' ? q.matName : ''}` };
    }
    // 扣材料（collect 才扣；evolve/kill 不扣材料）
    if (type === 'collect') {
      const spent = await Materials.spend(q.matName, q.need);
      if (!spent.ok) return { error: spent.error || '材料扣减失败' };
    }
    // 发奖励
    const rewards = [];
    for (const [name, amt] of Object.entries(q.reward || {})) {
      await Materials.gain(name, amt);
      rewards.push(`${name} ×${amt}`);
    }
    if (type !== 'collect') { progress[q.id] = 0; saveProgress(); } // 累计类任务交完清零重来
    accepted.delete(id);
    return { ok: true, rewards, id: q.id };
  }

  // 切换账号/登出时清空内存进度，避免残留旧号数据
  function reset() { progress = {}; accepted.clear(); }

  /* ---------- 对外 API ---------- */
  window.Quest = { getQuests, acceptQuest, completeQuest, report, loadCloudProgress, reset };
})();
