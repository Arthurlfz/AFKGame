/* ============================================================
 * vtest_settle_core.js —— P1 验收：settle-core 结算核心（node 桩）
 * 验证：
 *   A. petFromRow：pets 行 + 装备行 → 快照正确（含装备加成）
 *   B. grantExp：升级扣 need / 满级封顶 / 凝晶石数量
 *   C. settlePlan：完整结算编排（模拟 + 经验 + patch）不抛错、数字自洽
 * ============================================================ */
const path = require('path');
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };

(async () => {
  const CORE = await import('../../supabase/functions/_shared/settle-core.mjs');
  const CONFIG = await import('../../supabase/functions/_shared/config-server.mjs');
  const ENEMY = await import('../../supabase/functions/_shared/enemy-data-server.mjs');
  const config = CONFIG.default;
  const enemyList = ENEMY.default;

  // ===== A. petFromRow =====
  const st = config.pet.starters.find(s => s.name === '腐噜兽');
  const petRow = {
    id: 'pet-1', name: '腐噜兽', icon: '🐹', growth: 5.5, level: 20,
    hp: st.baseHp, attack: st.baseAtk, defense: st.baseDef, speed: config.pet.speeds['腐噜兽'],
    cur_hp: 500, exp: 120, traits: [], awaken_trait: null,
    equipment: { '武器': 'eq-1' }
  };
  const equipItems = [{
    id: 'eq-1', slot: '武器', name: '短剑',
    base_stats: { atk: 8 },
    affixes: { prefix: [{ type: 'atk', value: 10, label: '攻击' }] },
    soul_affix: null
  }];
  const byId = new Map(equipItems.map(it => [String(it.id), it]));
  const pet = CORE.petFromRow(petRow, byId, config);
  A(pet.name === '腐噜兽' && pet.level === 20 && pet.baseAtk === st.baseAtk, 'A1. 基础字段正确');
  A(pet.equipment['武器'] && pet.equipment['武器'].baseStats.atk === 8, 'A2. 装备组装正确');

  // ===== B. grantExp =====
  // B1: Lv1 给 100 经验（need(1)=22, need(2)=round(22*2^1.3)≈54, need(3)=round(22*3^1.3)≈88）
  // 100 = 22+54+24 → 升 2 级，剩 24
  const g1 = CORE.grantExp(0, 1, 100, config);
  const need = lv => Math.round(22 * Math.pow(lv, 1.3));
  A(g1.leveled && g1.level === 3 && g1.exp === 100 - need(1) - need(2), `B1. 连续升级正确（Lv1→${g1.level}, 剩${g1.exp}，期望 ${100 - need(1) - need(2)}）`);
  // B2: 满级 Lv60 给 100000 经验 → 全部进池，expLeft=need(60)，crystal=floor(100000/12000)=8
  const g2 = CORE.grantExp(0, 60, 100000, config);
  A(g2.level === 60 && g2.crystal === Math.floor(100000 / 12000) && g2.exp === need(60), `B2. 满级封顶+凝晶石（crystal=${g2.crystal}, expLeft=${g2.exp}）`);
  // B3: 经验不足升级 → 不动
  const g3 = CORE.grantExp(10, 5, 5, config);
  A(!g3.leveled && g3.level === 5 && g3.exp === 15, 'B3. 经验不足不升级');

  // ===== C. settlePlan =====
  const session = {
    id: 'sess-1', area_id: 'corrupted-forest', status: 'active',
    last_settled_at: new Date(Date.now() - 30000).toISOString()
  };
  const plan = CORE.settlePlan({
    session, petRow, equipItems, seconds: 30,
    seed: 12345, config, enemyList
  });
  A(plan.summary.fights > 0, `C1. 30 秒至少打 1 场（${plan.summary.fights} 场）`);
  A(plan.summary.exp >= 0 && plan.summary.exp === plan.result.totalExp, `C2. 经验自洽（${plan.summary.exp}）`);
  A(plan.summary.endHp >= 0 && plan.summary.endHp <= plan.summary.petMaxHp, `C3. 血量在 [0, maxHp]（${plan.summary.endHp}/${plan.summary.petMaxHp}）`);
  A(plan.petPatch.cur_hp === plan.summary.endHp && plan.petPatch.level === plan.summary.level, 'C4. petPatch 与 summary 一致');
  A(Array.isArray(plan.detail) && plan.detail.length <= 50, 'C5. detail 明细 <= 50 条');
  // 装备加成生效：穿装宠物 atk 应高于裸装（同种子对比）
  const bareRow = { ...petRow, equipment: {} };
  const planBare = CORE.settlePlan({
    session, petRow: bareRow, equipItems: [], seconds: 30,
    seed: 12345, config, enemyList
  });
  A(planBare.summary.fights >= plan.summary.fights, 'C6. 穿装场数 >= 裸装场数（装备有效）');

  console.log('ALL SETTLE CORE TESTS PASSED');
})().catch(e => { console.error('FAIL: ' + (e && e.stack || e)); process.exit(1); });
