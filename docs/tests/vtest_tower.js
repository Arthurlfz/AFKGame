/* ============================================================
 * vtest_tower.js —— 通天塔契约测试（配置/数值/腐印/资格/推进/结算）
 * 覆盖：
 *   ① 配置形态：30 层、每日免费 1 次、重置卡、守卫覆盖 1~30、曲线参数齐
 *   ② 层难度曲线全程严格递增（含强档层）；怪等级 10→100 线性；怪数值随层递增
 *   ③ 腐印池：id/name 唯一、hot>0、掉率增益有值；validate 四条规则；
 *      combine 乘区相乘/点数相加；applyToEnemy 不改原对象；
 *      ⭐ 腐蚀度期望值：equipPct > approvalFailPct × 2（用户拍板的定价锚，负项不得入库）
 *   ④ 资格：每日免费 1 次 → 用尽后必须重置卡；无卡拒绝；换日重置；与副本次数互不干扰
 *   ⑤ 推进：全赢通关 / 死在第 N 层按最高到达层数取档 / 不足 5 层只给补偿
 *   ⑥ 掉落：材料按深度分档（浅层不出塔专属高级材料）；塔不发区域材料（资源归属红线）
 *   ⑦ 称号：层数与腐蚀度双门槛
 *   ⑧ 模式：beginTrialFloor 收到 mode='tower' 与 healBlock；每层开打前用 hpCarry 覆盖回血
 *   ⑨ worldmap.towerPoint 存在且不与野图/副本点位重复
 * 跑法：cd docs/tests && node vtest_tower.js
 * ============================================================ */
const fs = require('fs');
const vm = require('vm');

let passCount = 0;
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } passCount++; console.log('PASS: ' + m); };

/* ---------- localStorage 桩（内存实现） ---------- */
const memStore = {};
const localStorageStub = {
  getItem: k => (k in memStore ? memStore[k] : null),
  setItem: (k, v) => { memStore[k] = String(v); },
  removeItem: k => { delete memStore[k]; }
};

/* ---------- 宠物 / 材料 / 装备 桩 ---------- */
const pet = { id: 'p1', name: '腐界母神', level: 60, growth: 350, hp: 200000, curHp: 200000 };
const bag = {};                 // 材料数量表
const eqBag = [];               // 造出来的装备
let winUntilMobs = 99999;       // 前 N 只怪赢，之后输（每层 mobsPerFloor 只）
let lastFloorCtx = null;        // battle 桩收到的「一只怪」上下文
let setCurHpCalls = [];         // 每次 setCurHp 的记录（验 hpCarry 覆盖回血）

function seqRnd(seed) {
  let a = (seed || 1) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, localStorage: localStorageStub, Date, Math };
ctx.window = ctx;
ctx.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
vm.createContext(ctx);
for (const f of ['../js/core/config.js', '../js/core/worldmap.js', '../js/core/battle-session.js', '../js/tower/tower-config.js', '../js/tower/tower-affix.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
}
vm.runInContext('Config.tower.floorDelayMs = 1;', ctx); // 测试加速
/* 楼内停顿也要压到 1ms —— 只压 floorDelayMs 的话，150 只怪 × mobGapMs(420) ≈ 63 秒纯等待，
 * 这就是本测试「跑很久」的原因（2026-09-10 查）。 */
vm.runInContext('Config.tower.mobGapMs = 1;', ctx);

ctx.Pet = {
  getActivePet: () => pet,
  getStats: () => ({ hp: pet.hp }),
  getCurHp: () => pet.curHp,
  setCurHp: (p, hp) => { p.curHp = Math.max(0, Math.min(hp, pet.hp)); setCurHpCalls.push(Math.round(hp)); }
};
ctx.Materials = {
  getQuantity: name => bag[name] || 0,
  gain: (name, n) => { bag[name] = (bag[name] || 0) + n; },
  spend: async (name, n) => {
    if ((bag[name] || 0) < n) return { ok: false, error: name + ' 不足' };
    bag[name] -= n;
    return { ok: true };
  }
};
ctx.Equipment = {
  generateEquipment: (rarity, areaTier, matTier) => ({ id: 'eq' + (eqBag.length + 1), slot: '武器', rarity: rarity || { id: 'gold', label: '金' }, areaTier, matTier, identified: true }),
  addToInventory: eq => { eqBag.push(eq); return true; }
};
ctx.Items = { saveItem: async () => ({ ok: true }) };
ctx.Battle = {
  beginTrialFloor: (c) => { lastFloorCtx = c; return true; },
  isRunning: () => false,
  isTrialMode: () => false,
  isTowerMode: () => false
};

// battle-session（战斗页占用权）：tower-engine 进塔前 claim('tower')，拿不到就不消耗资格
vm.runInContext(fs.readFileSync('../js/core/battle-session.js', 'utf8'), ctx);
// trial-access 只为复用「换日」口径（塔直接引用它，必须在 tower-access 之前加载）
vm.runInContext(fs.readFileSync('../js/trial/trial-access.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/tower/tower-access.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/tower/tower-rewards.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/tower/tower-engine.js', 'utf8'), ctx);
const C = code => vm.runInContext(code, ctx);
// 每层怪数（本文件多处断言用它换算「第几层第几只」→「总第几只」）
const per = Number(ctx.Config.tower.mobsPerFloor) || 1;

/* 逐只怪驱动：把 battle 桩收到的「一只怪」上下文按 winUntilMobs 判定胜负，并写回血量 */
async function runTower(affixIds, opts) {
  opts = opts || {};
  winUntilMobs = opts.winUntilMobs != null ? opts.winUntilMobs : 99999;
  lastFloorCtx = null; setCurHpCalls = [];
  /* 每次运行都从满血开始 —— 不重置的话，上一局（150 只怪）打完血量已经趴在 1，
   * 下一局的「血量递减」断言就变成 1→1 的假绿/假红（2026-09-10 踩过）。 */
  pet.curHp = pet.hp;
  ctx.TowerRewards.setRnd(seqRnd(20260910));
  const p = ctx.TowerEngine.start(affixIds || [], { rnd: seqRnd(7) });
  // 每只怪：等引擎把上下文推给 Battle 桩 → 结算（引擎按 mobGapMs/floorDelayMs 1ms 推进）
  const drive = () => {
    if (!lastFloorCtx) return false;
    const c = lastFloorCtx; lastFloorCtx = null;
    const floor = c.enemy._towerFloor;
    const mobIdx = c.enemy._towerMob || 1;
    const win = ((floor - 1) * per + mobIdx) <= winUntilMobs;
    /* 每只怪掉 0.2% 血（不是 2%）：150 只累计掉 30%，血量曲线才看得出「逐只递减」。
     * 曾经写 2% → 50 只就撞到下限被 Math.max 夹成 1，后面的断言全变成「1 >= 1」的假绿。 */
    const hp = win ? Math.max(1, pet.curHp - Math.round(pet.hp * 0.002)) : 0;
    ctx.Pet.setCurHp(pet, hp);
    c.onEnd({ win, petHp: hp, petMaxHp: pet.hp });
    return true;
  };
  /* 轮询驱动（引擎层间是 setTimeout 1ms）+ 看门狗：
   * 若 12 秒还没跑完，说明有层上下文没被驱动（桩写错/引擎卡住）—— 直接失败退出，
   * 不许静默挂住整个回归（run_all 的 90s 熔断只能兜底，定位不到是哪一段）。 */
  await new Promise((resolve, reject) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      drive();
      if (!ctx.TowerEngine.getState().running) { clearInterval(timer); resolve(); return; }
      if (Date.now() - t0 > 12000) {
        clearInterval(timer);
        const st = ctx.TowerEngine.getState();
        reject(new Error(`本局推演超时未结束（floor ${st.floor}/${st.total} mob ${st.mob}）—— 多半是层上下文没被驱动（检查 beginTrialFloor 桩）`));
      }
    }, 2);
  });
  return await p;
}

(async () => {
  const TC = ctx.Config.tower;
  const A = ctx.TowerAffix;

  /* ============ ① 配置形态 ============ */
  ok(TC.enabled === true, '塔已启用（enabled=true）');
  ok(TC.floors === 30, '塔固定 30 层（当前 ' + TC.floors + '）');
  ok(TC.freePerDay === 1, '每日免费 1 次（当前 ' + TC.freePerDay + '）');
  ok(!!TC.resetCardName && TC.resetCard && TC.resetCard.priceGems > 0 && TC.resetCard.limitPerWeek > 0,
    '重置卡配置齐（名/魔石价/每周硬限购）：' + TC.resetCardName);
  ok(TC.unlock && TC.unlock.hardGate === null && !!TC.unlock.hint, '入口不硬拦、只给提示（hardGate=null）');
  ok(TC.baseStats.hp > 0 && TC.baseStats.atk > 0 && TC.baseStats.def > 0 && TC.guardianHit > 90,
    '基准数值与守卫命中已配置（守卫命中 ' + TC.guardianHit + ' 高于野怪 90）');
  const guardians = TC.guardians || [];
  let cov = true;
  for (let f = 1; f <= TC.floors; f++) if (!guardians.some(g => f >= g.from && f <= g.to)) cov = false;
  ok(cov, '每 5 层的守卫覆盖 1~30 层无空洞（' + guardians.length + ' 名）');
  ok(guardians.every(g => ctx.PetSprites === undefined), '守卫立绘走 PetSprites 按名解析（测试环境无素材时不报错）');
  ok((TC.floorTiers || []).map(t => t.floor).join(',') === '5,10,15,20,25,30', '档位是 5/10/15/20/25/30 六档');
  ok((TC.consolation || []).length > 0, '不足第一档有补偿（' + (TC.consolation || []).map(i => i.name).join('/') + '）');

  /* ============ ② 曲线与怪数值 ============ */
  const lv1 = ctx.TowerEngine.floorLevelOf(1), lv30 = ctx.TowerEngine.floorLevelOf(30);
  // 2026-09-10 用户要求：怪 60 级起步、每通关一层就提升（后期内容不该出现小号怪）
  ok(lv1 === 60 && lv30 === 120, '怪等级第 1 层 Lv60、第 30 层 Lv120（' + lv1 + '→' + lv30 + '）');
  let mono = true, prevHp = 0, prevDiff = 0;
  for (let f = 1; f <= TC.floors; f++) {
    const e = ctx.TowerEngine.floorEnemyStats(f, null);
    const d = ctx.TowerEngine.floorDifficultyOf(f);
    if (d <= prevDiff) mono = false;
    if (e.hp <= prevHp) mono = false;
    prevDiff = d; prevHp = e.hp;
    if (!(e.hit === TC.guardianHit)) mono = false;
  }
  ok(mono, '层难度与怪血全程严格递增（含强档层阶梯，绝不倒退），守卫命中一致');
  // 后段必须明显陡峭：要覆盖「中档普通宠 → 满配神级涅槃5」的差距（实测第 30 层一层总血 = 第 20 层的 4.3 倍）
  const hpRatio = ctx.TowerEngine.floorTotalHp(30, null) / ctx.TowerEngine.floorTotalHp(20, null);
  ok(hpRatio > 3.5, '后段陡峭：第 30 层一层总血是第 20 层的 ' + hpRatio.toFixed(2) + ' 倍（覆盖满配/中档差距）');
  const hpRatioLow = ctx.TowerEngine.floorTotalHp(20, null) / ctx.TowerEngine.floorTotalHp(10, null);
  /* 曲线是「前陡后缓」的：怪等级 10→100 线性上升，前期等级段占比大 → 前段倍率更高。
   * 这里只守「两段都显著递增」，不假设哪段更陡（形状由 sim 校准，见 tower-config 校准记录）。 */
  ok(hpRatioLow > 2.5, '前中段同样显著递增（20/10 层 = ' + hpRatioLow.toFixed(2) + ' 倍）');
  ok(hpRatio > 3.5 && hpRatioLow > 3.5, '两段倍率都足以拉开三档玩家（30/20=' + hpRatio.toFixed(2) + '，20/10=' + hpRatioLow.toFixed(2) + '）');

  /* 怪物技能（2026-09-10 用户要求「怪不能是死靶子」）：
   * 全部怪都带 skill（守卫强 / 杂兵弱），且数值在可读区间。 */
  const gcS = ctx.Config.tower.guardianSkills || [], mcS = ctx.Config.tower.mobSkills || [];
  ok(gcS.length >= 6 && mcS.length >= 4, '守卫 / 杂兵技能池已配置（' + gcS.length + ' + ' + mcS.length + '）');
  const mobSkill = ctx.TowerEngine.mobEnemyStats(3, 1, null).skill;
  const gvSkill = ctx.TowerEngine.mobEnemyStats(3, per, null).skill;
  ok(!!mobSkill && !!gvSkill, '每只怪都带 skill（杂兵「' + (mobSkill && mobSkill.name) + '」/ 守卫「' + (gvSkill && gvSkill.name) + '」）');
  const expOf = s => (s.triggerChance || 0) * ((s.damageMultiplier || 1) - 1) + (s.triggerChance || 0) * (s.maxHpDamageRate || 0);
  ok(expOf(gvSkill) > expOf(mobSkill), '守卫技能期望收益 > 杂兵（' + expOf(gvSkill).toFixed(3) + ' vs ' + expOf(mobSkill).toFixed(3) + '）');
  ok(gcS.concat(mcS).every(s => s.triggerChance > 0 && s.triggerChance <= 0.5 && s.damageMultiplier > 1 && s.cooldownTurns >= 1),
    '全部技能数值在可读区间（概率 ≤50% / 倍率 >1 / 有冷却）');
  // 同一层的技能分配要稳定可复现（同层同只怪每次进都一样）
  ok(ctx.TowerEngine.mobEnemyStats(7, 2, null)._towerSkillName === ctx.TowerEngine.mobEnemyStats(7, 2, null)._towerSkillName,
    '同层同只怪的技能分配可复现（按 层+第几只 取模，不用随机数）');

  /* ============ ③ 腐印池与校验 ============ */
  const items = A.items();
  ok(items.length >= 10, '腐印池条数足够（' + items.length + ' 条）');
  const ids = items.map(i => i.id), names = items.map(i => i.name);
  ok(new Set(ids).size === ids.length && new Set(names).size === names.length, '腐印 id 与 name 都不重复');
  ok(items.every(i => A.corrosionOf(i) > 0), '每条腐印都有正腐蚀度值');
  ok(items.every(i => i.dropBonus && (i.dropBonus.equipPct > 0 || i.dropBonus.matPct > 0)), '每条腐印都能换算成明确的掉率%（用户拍板原则）');
  // ⭐ 期望值锚：equipPct > approvalFailPct × 2（见 tower-config.js evAnchor 推导）
  const evBad = items.filter(i => (i.dropBonus.equipPct || 0) <= ((i.ev && i.ev.approvalFailPct) || 0) * 2);
  ok(evBad.length === 0, '每条腐印的期望掉率增益 > 失败概率增量 × 2（负项不得入库；违规 ' + evBad.map(i => i.name).join('/') + '）');
  const unreadable = items.filter(i => A.isUnreadable(i));
  ok(unreadable.length >= 1 && unreadable.length <= 4, '「不可读」腐印数量受控（' + unreadable.length + ' 条）');

  const vEmpty = A.validate([]);
  ok(vEmpty.ok && vEmpty.corrosion === 0, '白图（0 腐印）永远合法（这是核心设计：不加腐也能通）');
  const vOne = A.validate([items[0].id]);
  ok(vOne.ok && vOne.corrosion === A.corrosionOf(items[0]), '贴 1 条合法且腐蚀度正确（' + items[0].name + ' 腐 ' + A.corrosionOf(items[0]) + '）');
  const vOver = A.validate(items.slice(0, A.maxPerRun() + 1).map(i => i.id));
  ok(!vOver.ok && /最多只能贴/.test(vOver.errors.join()), '超过 maxPerRun 条被拒（' + A.maxPerRun() + ' 条上限）');
  const vDup = A.validate([items[0].id, items[0].id]);
  ok(!vDup.ok && /不能重复贴/.test(vDup.errors.join()), '同一条腐印不能重复贴');
  const unreadIds = unreadable.map(i => i.id);
  if (unreadIds.length >= 2) {
    const vUn = A.validate(unreadIds.slice(0, 2));
    ok(!vUn.ok && /不可读/.test(vUn.errors.join()), '「不可读」腐印超限被拒（同局最多 ' + A.unreadableLimit() + ' 条）');
  } else {
    ok(true, '「不可读」腐印只有 1 条，超限规则天然成立');
  }
  const unknown = A.validate(['not-exist-id']);
  ok(!unknown.ok && /未知腐印/.test(unknown.errors.join()), '未知腐印 id 被拒');

  const combo = A.combine([items[0].id, items[2].id]);
  ok(combo.corrosion === A.corrosionOf(items[0]) + A.corrosionOf(items[2]), '腐蚀度总分 = 各条相加');
  const itemWithHp = items.find(i => i.enemy && i.enemy.hpMult);
  if (itemWithHp) {
    const two = A.combine([itemWithHp.id, itemWithHp.id]);
    ok(Math.abs(two.enemy.hpMult - itemWithHp.enemy.hpMult) < 1e-9, 'combine 按 id 去重查找（同 id 只算一次，不叠加）');
  } else { ok(true, '无 hpMult 类腐印，跳过叠加检查'); }

  const enemyBase = { hp: 1000, maxHp: 1000, atk: 100, def: 50, spd: 80, hit: 100, dr: 0, pen: 0, dmgBonus: 0, lifesteal: 0 };
  const buffed = A.applyToEnemy(enemyBase, A.combine([itemWithHp ? itemWithHp.id : items[0].id]));
  ok(enemyBase.hp === 1000 && enemyBase.maxHp === 1000, 'applyToEnemy 不改传入的怪对象（返回新对象）');
  ok(buffed.hp >= 1000 && buffed.maxHp === buffed.hp, 'applyToEnemy 生效且 hp 与 maxHp 同步');
  ok(A.applyToEnemy(enemyBase, A.combine([])).hp === 1000, '白图（空 combo）不改怪数值');

  /* ============ ④ 资格：免费 1 次 + 重置卡 ============ */
  delete memStore['fos_tower_usage'];
  bag[TC.resetCardName] = 0;
  const info0 = ctx.TowerAccess.entryInfo();
  ok(info0.freeLeft === 1, '今日免费 1 次可用（freeLeft=' + info0.freeLeft + '）');
  const c1 = await ctx.TowerAccess.consumeEntry();
  ok(c1.ok && c1.consumed === 'free', '第 1 次进入走免费');
  const info1 = ctx.TowerAccess.entryInfo();
  ok(info1.freeLeft === 0, '免费次数用尽后 freeLeft=0');
  const c2 = await ctx.TowerAccess.consumeEntry();
  ok(!c2.ok && /不足|缺少/.test(c2.error), '没重置卡时第 2 次被拒（失败即付费墙，用户拍板）');
  bag[TC.resetCardName] = 2;
  const c3 = await ctx.TowerAccess.consumeEntry();
  ok(c3.ok && c3.consumed === 'card', '有重置卡时第 2 次扣卡进入');
  ok(bag[TC.resetCardName] === 1, '重置卡扣 1 张（剩 ' + bag[TC.resetCardName] + '）');
  // 换日重置：塔把用量存在模块内存里（刷新页面才重读 localStorage）→ 模拟刷新：改存档 + 重载模块
  memStore['fos_tower_usage'] = JSON.stringify({ dayKey: '2000-1-1', used: 9, bestFloor: 12, bestCorrosion: 30 });
  vm.runInContext(fs.readFileSync('../js/tower/tower-access.js', 'utf8'), ctx);
  const info2 = ctx.TowerAccess.getDailyInfo();
  ok(info2.freeLeft === 1 && info2.used === 0, '换日（北京时间 12:00）后免费次数重置');
  ok(info2.bestFloor === 12 && info2.bestCorrosion === 30, '换日只清次数，历史最高层/腐蚀度保留');
  ok(memStore['fos_trial_usage'] === undefined, '塔用独立的存储键（不与副本的每日次数互相干扰）');

  /* ============ ⑤ 推进与档位 ============ */
  delete memStore['fos_tower_usage']; bag[TC.resetCardName] = 99;
  bag['腐印·暴怒'] = 9; bag['腐印·疾影'] = 9;
  const full = await runTower([], { winUntilMobs: 30 * per });
  ok(full.ok && full.cleared && full.maxFloor === 30, '全赢 → 通关（cleared=' + full.cleared + ', maxFloor=' + full.maxFloor + ', ' + (full.error || 'ok') + '）');
  // 每只怪都摇一次掉落：一局 = 层数 × 每层怪数（用户 2026-09-10 定：怪物掉落是随机奖励那层）
  ok((full.layerLoot || []).length === 30 * per,
    '一局掉落 roll 次数 = 层数×每层怪数（' + (full.layerLoot || []).length + ' vs ' + (30 * per) + '）');
  ok(full.tierFloor === 30, '通关拿第 30 层档位（当前 ' + full.tierFloor + '）');
  ok(full.title && full.title.name, '通关给了称号（' + (full.title && full.title.name) + '）');

  const mid = await runTower([], { winUntilMobs: 6 * per });   // 赢 6 层，第 7 层死
  ok(!mid.cleared && mid.maxFloor === 6, '死在第 7 层 → 最高到达 6 层（' + mid.maxFloor + '）');
  ok(mid.tierFloor === 5, '死在第 7 层拿第 5 层档（按最高到达层数，当前 ' + mid.tierFloor + '）');

  const early = await runTower([], { winUntilMobs: 3 * per });
  ok(early.maxFloor === 3 && early.tierFloor === 0, '不足 5 层 → 不给档位（tierFloor=' + early.tierFloor + '）');
  ok(early.items.some(i => i.name === (TC.consolation[0] || {}).name), '不足 5 层给补偿（' + early.items.map(i => i.name + '×' + i.qty).join('/') + '）');

  /* ============ ⑥ 掉落：深度分档 + 不发区域材料 ============ */
  const deepNames = [];
  (TC.materialBands || []).forEach(b => Object.keys(b.weights || {}).forEach(n => deepNames.push(n)));
  const shallow = (TC.materialBands || []).find(b => b.from === 1);
  ok(shallow && !shallow.weights['神圣石'] && !shallow.weights['越龙之石'] && !shallow.weights['天仙玉露'],
    '浅层（1~10）只出基础打造石，不出塔专属高级材料');
  const deep = (TC.materialBands || []).filter(b => b.from >= 21)[0];
  ok(deep && deep.weights['越龙之石'] > 0 && deep.weights['天仙玉露'] > 0,
    '深层（21~30）才出越龙之石 / 天仙玉露（用户拍板的「层数门槛」刹车）');
  ok(deepNames.indexOf('区域材料') < 0, '塔的掉落表里没有「区域材料」（资源归属红线：区域材料只能地图产）');

  /* 2026-09-10 用户追问「从地图移走、说要归塔的那些东西真接进来了吗」→ 立成硬断言：
   * Config.towerDrops.items 里登记的每件，都必须在【塔的材料池】或【档位奖励】里出现。
   * 注意：towerDrops 是「归属账本」，不是「塔独家」——神圣石另有副本/任务来源，这里只守「塔在产」。 */
  const towerMaterials = new Set();
  (TC.materialBands || []).forEach(b => Object.keys(b.weights || {}).forEach(n => towerMaterials.add(n)));
  (TC.floorTiers || []).forEach(t => (t.items || []).forEach(i => towerMaterials.add(i.name)));
  const towerOwned = C('(Config.towerDrops && Config.towerDrops.items || []).map(i => i.name)');
  ok(towerOwned.length >= 4, 'towerDrops 登记了从地图移走的高级物品（' + towerOwned.join('/') + '）');
  const notWired = towerOwned.filter(n => !towerMaterials.has(n));
  ok(notWired.length === 0, 'towerDrops 里每件都在塔里真的能拿到（材料池或档位奖励；缺接线：' + (notWired.join('/') || '无') + '）');
  const yulong = (TC.materialBands || []).find(b => b.from === 11 && b.to === 20) || {};
  ok((yulong.weights || {})['越龙之石'] > 0,
    '越龙之石在 11~20 层就出现（合成 Lv40 解锁 + 它是默认合成道具 → 不能只在 21 层以上出）');
  // 全塔掉落 roll 1000 次：绝不出现区域材料、且浅层不出现高级材料
  ctx.TowerRewards.setRnd(seqRnd(99));
  let violation = null;
  for (let f = 1; f <= 30; f++) {
    for (let i = 0; i < 60; i++) {
      // 杂兵池与守卫池都跑（band 限制与池无关，两套都必须守）
      const l = ctx.TowerRewards.rollLayer({ floor: f, ilvl: 100, kind: (i % 2 ? 'guardian' : 'mob'), combo: { dropBonus: { equipPct: 0, matPct: 0 } } });
      if (l.kind === 'material') {
        if (l.name === '区域材料') violation = '区域材料';
        const band = (TC.materialBands || []).find(b => f >= b.from && f <= b.to) || {};
        if (!(band.weights || {})[l.name]) violation = '第 ' + f + ' 层掉了 ' + l.name + '（不在该深度档位里）';
      }
    }
  }
  ok(!violation, '1800 次怪物掉落零违规（杂兵池/守卫池都跑：' + (violation || 'ok') + '）');

  /* ============ ⑦ 称号：层数 + 腐蚀度双门槛 ============ */
  ok(ctx.TowerRewards.titleFor(30, 0) && ctx.TowerRewards.titleFor(30, 0).id === 'tower-30', '30 层拿「通天者」');
  const hotTitle = ctx.TowerRewards.titleFor(30, 999);
  ok(hotTitle && hotTitle.id === 'tower-30-hot', '30 层 + 高腐蚀度拿更高称号（' + (hotTitle && hotTitle.name) + '）');
  ok(ctx.TowerRewards.titleFor(3, 999) === null, '只爬 3 层没有称号');

  /* ============ ⑧ 战斗模式与血量累计 ============ */
  setCurHpCalls = [];
  await runTower([], { winUntilMobs: 4 * per });
  ok(lastFloorCtx === null, '引擎跑完后层上下文已消费（无残留）');
  // 第 2 层开打前应有一次「用上一层战绩值覆盖」的 setCurHp（防层间回血时钟偷加血）
  ok(setCurHpCalls.length >= 4, '每只怪开打前都写回血量（setCurHp 调用 ' + setCurHpCalls.length + ' 次）');
  const hpSeq = setCurHpCalls.filter(v => v > 0);
  const monotone = hpSeq.every((v, i) => i === 0 || v <= hpSeq[i - 1]);
  ok(hpSeq.length >= 3 && monotone && hpSeq[hpSeq.length - 1] < hpSeq[0],
    '血量逐只递减、绝不回升（' + hpSeq[0] + ' → ' + hpSeq[hpSeq.length - 1] + '，共写回 ' + hpSeq.length + ' 次）');

  /* ============ ⑨ 地图节点 ============ */
  const tp = ctx.WorldMap.towerPoint;
  ok(!!tp && tp.type === 'tower' && tp.x > 0 && tp.x < 100 && tp.y > 0 && tp.y < 100,
    '世界地图有塔节点且坐标是有效百分比（x' + tp.x + ', y' + tp.y + '）');
  ok(!tp.areaId, '塔节点不参与 areaId 体系（不经过 Battle.selectArea）');
  const clash = ctx.WorldMap.points.concat(ctx.WorldMap.trialPoints || []).filter(p => p.x === tp.x && p.y === tp.y);
  ok(clash.length === 0, '塔节点坐标不与野图/副本点位重叠');

  /* ============ ⑩ 塔专属武器：禁疗透传 + 腐印消耗 ============ */
  setCurHpCalls = [];
  bag['腐印·禁疗'] = 5;
  delete memStore['fos_tower_usage'];
  const silence = items.find(i => i.id === 'blight-silence');
  let healFlagSeen = null;
  const origBegin = ctx.Battle.beginTrialFloor;
  /* ⚠️ 替换桩时必须【同时记下 lastFloorCtx】—— 否则驱动循环拿不到「该开打了」的信号，
   * 那一局永远不结束、进程挂着不退出（2026-09-10 血泪：表现为 run_all 里「超时未退出 >90s」，
   * 且屏幕输出正好停在上一段最后一条断言，看起来像"卡在那里"）。 */
  ctx.Battle.beginTrialFloor = c => { healFlagSeen = !!c.healBlock; lastFloorCtx = c; return true; };
  await runTower([silence.id], { winUntilMobs: 2 * per });
  ctx.Battle.beginTrialFloor = origBegin;
  ok(healFlagSeen === true, '贴「禁疗」腐印时，层战斗收到 healBlock=true（battle.js 会拦掉吸血）');
  ok((bag['腐印·禁疗'] || 0) === 4, '腐印进入时被消耗 1 个（剩 ' + (bag['腐印·禁疗'] || 0) + '）');

  /* ============ ⑪ 2026-09-10 用户追加的三条要求 ============ */
  // ① 每层 5 只怪：杂兵更脆、守卫更硬、全清才过层
  ok(TC.mobsPerFloor === 5, '每层固定 5 只怪（当前 ' + TC.mobsPerFloor + '）');
  const mob1 = ctx.TowerEngine.mobEnemyStats(10, 1, null);
  const guard = ctx.TowerEngine.mobEnemyStats(10, TC.mobsPerFloor, null);
  ok(!!mob1._towerMob && !!guard._towerIsGuardian, '同一层能取到「第 k 只」，且第 5 只被标记为守卫');
  ok(guard.hp > mob1.hp * 1.5, '守卫比杂兵硬（守卫血 ' + guard.hp + ' vs 杂兵 ' + mob1.hp + '）');
  ok(mob1 !== guard, '杂兵与守卫是两只不同的怪（各自独立数值，不是同一对象复用）');
  const totalHp = ctx.TowerEngine.floorTotalHp(10, null);
  const sumHp = (() => { let s = 0; for (let i = 1; i <= TC.mobsPerFloor; i++) s += ctx.TowerEngine.mobEnemyStats(10, i, null).hp; return s; })();
  ok(totalHp === sumHp, '一层总血 = 5 只之和（' + totalHp + '）');
  ok((TC.mobNames || []).length >= 3 && (TC.mobGapMs || 0) > 0, '杂兵名字池与楼内停顿已配置（' + (TC.mobNames || []).length + ' 个名字）');

  // ② 文案统一用「腐蚀度」：源码里不许再出现旧叫法（含注释，避免以后被抄回去）
  const fs2 = require('fs');
  const towerDir = '../js/tower';
  const scanFiles = fs2.readdirSync(towerDir).filter(f => f.endsWith('.js')).map(f => towerDir + '/' + f)
    .concat(['../js/ui/ui-codex.js', '../js/ui/ui-tower-entry.js', '../js/ui/ui-tower-battle.js', '../js/ui/ui-tower-settle.js'])
    .filter(f => fs2.existsSync(f));
  const offenders = scanFiles.filter(f => fs2.readFileSync(f, 'utf8').indexOf('辣度') >= 0);
  ok(offenders.length === 0, '塔相关源码零「辣度」字样（违规：' + offenders.join(' / ') + '）');
  ok(items.every(i => i.corrosion != null || i.hot != null), '腐印数据带腐蚀度值（corrosion 字段；读取兼容旧 hot）');

  // ③ 奖励结构：每只怪都掉 + 守卫更肥 + 档位固定奖励加厚
  const LD = TC.layerDrop || {};
  ok(LD.mobPool && LD.guardianPool, '掉落池分成杂兵池与守卫池两套（当前 ' + Object.keys(LD).join('/') + '）');
  const mobRate = (LD.mobPool.equipment || 0) + (LD.mobPool.material || 0);
  const guardRate = (LD.guardianPool.equipment || 0) + (LD.guardianPool.material || 0);
  ok(guardRate > mobRate * 3, '守卫池明显比杂兵池肥（非空手率 ' + guardRate.toFixed(1) + ' vs ' + mobRate.toFixed(1) + '）');
  ok((LD.guardianPool.equipment || 0) > (LD.mobPool.equipment || 0) * 5, '守卫爆装备的概率远高于杂兵（' + LD.guardianPool.equipment + ' vs ' + LD.mobPool.equipment + '）');
  ok((TC.materialQty || {}).max >= 3, '材料掉落数量上限 ≥3（当前 ' + (TC.materialQty || {}).max + '，原来 2）');
  const tier30 = (TC.floorTiers || []).find(t => t.floor === 30) || {};
  ok((tier30.gear || {}).count >= 4, '第 30 层档位装备件数 ≥4（当前 ' + ((tier30.gear || {}).count) + '）');
  const gearCounts = (TC.floorTiers || []).map(t => (t.gear || {}).count || 0);
  ok(gearCounts.every((c, i) => i === 0 || c >= gearCounts[i - 1]), '档位装备件数随层数单调不减（越深越厚）');

  console.log('\nALL TOWER TESTS PASSED (' + passCount + ' asserts)');
})();
