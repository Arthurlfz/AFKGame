// vtest_trait_soulcast.js —— 血脉特质 + 觉醒 + 合成继承 + 涅槃植入 + 魂铸
// 加载顺序：config → equipment → pet → pet_merge → equipment_craft
const fs = require('fs'), vm = require('vm');

function el() {
  return { hidden: false, disabled: false, textContent: '', dataset: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, querySelector() { return null; } };
}
const els = {};
const ctx = {
  console,
  setTimeout: fn => { fn(); return 1; }, clearTimeout() {}, setInterval() {}, clearInterval() {},
  document: { getElementById: id => els[id] || (els[id] = el()) },
  Math: Object.create(Math),
  Config: null,
  window: null
};
ctx.window = ctx;
// 默认用真随机做分布测试；需要确定性时 push 序列到 rnd
let rnd = null;
ctx.Math.random = () => (rnd && rnd.length ? rnd.shift() : Math.random());

function pickWeighted(list) {
  if (!list || !list.length) return undefined;
  const total = list.reduce((s, x) => s + (x.w || 0), 0);
  let r = ctx.Math.random() * total;
  for (const x of list) { r -= (x.w || 0); if (r <= 0) return x; }
  return list[list.length - 1];
}
function randInt(a, b) { a = Math.floor(a); b = Math.floor(b); return a + Math.floor(ctx.Math.random() * (b - a + 1)); }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }
ctx.Util = { pickWeighted, randInt, pick };

vm.createContext(ctx);
function load(file) { vm.runInContext(fs.readFileSync(file, 'utf8'), ctx); }
load('../js/core/config.js');
load('../js/equipment/equipment.js');
load('../js/pet/pet.js');
load('../js/pet/pet_merge.js');

// 魂铸依赖 Materials / Items / Supabase，先 mock 再加载 equipment_craft
let matQty = 99, removeCalled = null;
ctx.Materials = {
  getQuantity: () => matQty,
  spendLocal: () => ({ ok: true }),
  gainLocal: () => {},
  cloudSpend: async () => ({})
};
ctx.Items = { updateCloudItem: async () => ({ data: true }) };
ctx.Supabase = { deletePet: async () => ({ data: true }) };
ctx.Pet.getActivePet = () => ({ id: 'active1' });
ctx.Pet.removePet = (id) => { removeCalled = id; };
load('../js/equipment/equipment_craft.js');

const A = (ok, message) => { if (!ok) { console.error('FAIL: ' + message); process.exit(1); } console.log('PASS: ' + message); };

/* ================= 1. 孵化 roll 特质 ================= */
function baby() { return ctx.Pet.createPet('腐噜兽', 'x', 50, 100, 20, 10, 40, '腐噜兽'); }
// 分布：条数 0~3，id 来自配置
let badCount = 0, badId = 0;
for (let i = 0; i < 800; i++) {
  const p = baby(); ctx.Pet.rollPetTraits(p, { mutant: false });
  if (p.traits.length > 3) badCount++;
  for (const t of p.traits) { if (!ctx.Config.petTraits[t.id] || ![1, 2, 3].includes(t.tier)) badId++; }
}
A(badCount === 0, '孵化特质条数 ≤ 3');
A(badId === 0, '孵化特质 id/T 阶合法（来自配置）');

// 变异宠保底 ≥1 条（跑很多次不应出现 0）
let mutantZero = 0;
for (let i = 0; i < 500; i++) {
  const p = baby(); ctx.Pet.rollPetTraits(p, { mutant: true });
  if (p.traits.length === 0) mutantZero++;
}
A(mutantZero === 0, '变异宠保底至少 1 条特质');

/* ================= 2. getStats 结算特质 ================= */
{
  const p = baby();
  p.traits = [{ id: '嗜血', tier: 1 }]; // 吸血 +8%
  const s = ctx.Pet.getStats(p);
  A(Math.abs(s.lifesteal - 0.08) < 1e-9, '嗜血 T1 → 吸血 +8%');
  const p2 = baby();
  p2.traits = [{ id: '狂暴', tier: 1 }]; // 暴伤 +25%
  const s2 = ctx.Pet.getStats(p2);
  A(Math.abs(s2.critDamage - (1.45 + 0.25)) < 1e-9, '狂暴 T1 → 暴伤 +25%');
  const p3 = baby();
  p3.traits = [{ id: '铁壁', tier: 2 }]; // 防御 +8% pct
  const s3 = ctx.Pet.getStats(p3);
  // 与 getStats 的 statParts 口径一致：装备/特质 % 只作用于底座（core），成长增量不参与
  const C3 = ctx.Pet.getStatCoeff(p3);
  const core = p3.baseDef + Math.round(p3.level * C3.def);
  const growthInc = Math.round(p3.level * p3.growth * C3.def) - Math.round(p3.level * C3.def);
  A(Math.abs(s3.def - Math.round(core * 1.08 + growthInc)) <= 1, '铁壁 T2 → 防御 +8%（作用于底座，成长增量不放大）');
}

/* ================= 3. 觉醒特质（2026-09-10 v2：觉醒石永久觉醒，与等级无关） ================= */
{
  const p = baby(); p.name = '血月魔狐'; p.lineId = '血狐'; p.level = 60; p.awakened = true;
  const aw = ctx.Pet.getAwakenState(p);
  A(aw && aw.bonus && aw.bonus.stat === 'critDamage' && aw.bonus.value === 10, '觉醒终形态血狐 → 觉醒暴伤+10%');
  A(Math.abs(aw.skillDamageMult - 1.2) < 1e-9, '觉醒技能伤害 +20%');
  const p2 = baby(); p2.name = '血月魔狐'; p2.lineId = '血狐'; p2.level = 30;
  A(ctx.Pet.getAwakenState(p2) === null, '未觉醒（哪怕终形态）→ 觉醒状态为空');
  const p3 = baby(); p3.name = '腐噜兽'; p3.lineId = '腐噜兽'; p3.level = 60; p3.awakened = true;
  A(ctx.Pet.getAwakenState(p3) === null, '非终形态即使标记觉醒 → 仍为空（无技能可挂）');
  const p4 = baby(); p4.name = '血月魔狐'; p4.lineId = '血狐'; p4.level = 1; p4.awakened = true;
  A(ctx.Pet.getAwakenState(p4) !== null, '觉醒后 Lv1 也生效（永久，涅槃/转生不清）');
  // 觉醒加成进入 getStats
  const s = ctx.Pet.getStats(p);
  // 血狐 profile 暴伤基线 1.9（critDamage=190），觉醒 +10% → 2.0
  A(Math.abs(s.critDamage - 2.0) < 1e-9, '觉醒暴伤加成结算进 getStats');
}

/* ================= 4. 合成继承（2026-09-11 新规则：主宠全保只升不降、副宠嫁接、至尊神石全收） ================= */
{
  // 确定性：主嗜血升档（0.1<0.2 → T2→T1）；副狂暴嫁接（0.1<0.4）档位照抄 T3
  const main = baby(); main.growth = 50; main.traits = [{ id: '嗜血', tier: 2 }];
  const sub = baby(); sub.traits = [{ id: '狂暴', tier: 3 }];
  rnd = [0.1, 0.1];
  const out = ctx.Merge.inheritSynthTraits(main, sub, false);
  A(out.length === 2 && out.find(t => t.id === '嗜血').tier === 1, '合成继承：主宠词条必留且升档（T2→T1）');
  A(out.find(t => t.id === '狂暴').tier === 3, '合成继承：副宠词条嫁接、档位照抄（T3）');
}
{
  // 至尊神石 subAll：副宠词条 100% 嫁接（不掷概率），主宠只掷升档
  const main = baby(); main.traits = [{ id: '嗜血', tier: 2 }];
  const sub = baby(); sub.traits = [{ id: '狂暴', tier: 1 }];
  rnd = [0.9];
  const out = ctx.Merge.inheritSynthTraits(main, sub, false, { subAll: true });
  A(out.length === 2 && out.find(t => t.id === '嗜血').tier === 2 && out.find(t => t.id === '狂暴').tier === 1,
    '至尊神石：主宠全保 + 副宠词条 100% 嫁接');
}
{
  // 变异追加：档位走变异福利（T1 20%、保底 T2），不再用普通 roll
  const main = baby(); main.traits = [];
  const sub = baby(); sub.traits = [];
  rnd = [0.5, 0.05]; // 第一掷选特质 id，第二掷定档位
  const out1 = ctx.Merge.inheritSynthTraits(main, sub, true);
  A(out1.length === 1 && out1[0].tier === 1, '变异追加：T1 20%（0.05 命中）');
  rnd = [0.5, 0.5];
  const out2 = ctx.Merge.inheritSynthTraits(main, sub, true);
  A(out2.length === 1 && out2[0].tier === 2, '变异追加：保底 T2（0.5 未中 T1 → T2，不再出 T3）');
}
{
  // 满栏变异：新特质挤掉主宠档位最低的一条（T1 永不被顶）
  const main = baby(); main.traits = [{ id: '嗜血', tier: 1 }, { id: '狂暴', tier: 2 }, { id: '战意', tier: 3 }];
  const sub = baby(); sub.traits = [];
  rnd = [0.9, 0.9, 0.9, 0.5, 0.5]; // 主宠三条各掷升档（0.9 不升）+ 变异 id + 变异档位
  const out = ctx.Merge.inheritSynthTraits(main, sub, true);
  A(out.length === 3 && !out.find(t => t.id === '战意') && out.find(t => t.id === '嗜血').tier === 1 && out.find(t => t.id === '狂暴').tier === 2,
    '满栏变异：新特质 T2 顶掉主宠 T3，T1 不动');
}
{
  // 主宠成长≥60：副宠嫁接概率 +10%（40%→50%），分布级断言
  let hit = 0;
  for (let i = 0; i < 200; i++) {
    const main = baby(); main.growth = 60; main.traits = [];
    const sub = baby(); sub.traits = [{ id: '嗜血', tier: 2 }];
    const out = ctx.Merge.inheritSynthTraits(main, sub, false);
    if (out.length === 1) hit++;
  }
  A(hit > 70 && hit < 130, '主宠成长≥60：副宠嫁接概率 40%→50%（200 次 ' + hit + ' 次命中）');
}
/* ================= 5. 涅槃植入 ================= */
{
  const main = baby(); main.traits = [{ id: '嗜血', tier: 2 }];
  const sub = baby(); sub.traits = [{ id: '嗜血', tier: 1 }, { id: '狂暴', tier: 3 }];
  // 两条 sub 都植入（0.1<0.3）
  rnd = [0.1, 0.1];
  const out = ctx.Merge.implantNirvanaTraits(main, sub);
  const h = out.find(t => t.id === '嗜血');
  const b = out.find(t => t.id === '狂暴');
  A(h && h.tier === 1, '涅槃植入：同类型取高 T（min(2,1)=1）');
  A(b && b.tier === 3, '涅槃植入：新类型正常植入');
  A(out.length <= 3, '涅槃植入：上限 3');
}

/* ================= 6. 魂铸 ================= */
(async () => {
  // 魂铸·普通：血脉特质 T=原T；消耗宠物；写入装备
  await (async () => {
    const eq = { name: '测试剑', slot: '武器', rarity: { id: 'white' }, affixes: { prefix: [], suffix: [] }, cloudId: 'eq1' };
    removeCalled = null;
    const pet = baby(); pet.id = 'p1'; pet.level = 40; pet.growth = 10; pet.traits = [{ id: '嗜血', tier: 2 }];
    const res = await ctx.Craft.soulCast(eq, pet, 'normal', 0);
    A(res.ok && res.soulAffix && res.soulAffix.traitId === '嗜血' && res.soulAffix.tier === 2, '魂铸·普通：血脉特质 T=原T');
    A(eq.soulAffix && eq.soulAffix.traitId === '嗜血' && /^魂·/.test(eq.soulAffix.label) && eq.soulAffix.source === 'soulcast', '魂铸后装备写入 soulAffix（魂·吸血+5%）');
    A(removeCalled === 'p1', '魂铸消耗宠物（removePet 调用）');
    // 魂铸词缀进入 getEquipBonuses（嗜血 T2 = 吸血 +5）
    const owner = baby(); owner.equipment = { 武器: eq };
    const bonus = ctx.Equipment.getEquipBonuses(owner);
    A(bonus.flat.lifesteal === 5, '魂铸词缀结算进 getEquipBonuses（吸血+5，T2）');
  })();

  await (async () => {
    const eq = { name: 't', slot: '武器', rarity: { id: 'white' }, affixes: { prefix: [], suffix: [] } };
    eq.soulAffix = { type: 'soul' };
    const pet = baby(); pet.level = 40; pet.growth = 10;
    const dup = await ctx.Craft.soulCast(eq, pet, 'normal', 0);
    A(!dup.ok && /已铸入/.test(dup.error), '魂铸拒绝：装备已有魂铸词缀');
  })();

  await (async () => {
    const eq = { name: 't', slot: '武器', rarity: { id: 'white' }, affixes: { prefix: [], suffix: [] } };
    const pet = baby(); pet.level = 40; pet.growth = 5; pet.traits = [{ id: '嗜血', tier: 2 }];
    const low = await ctx.Craft.soulCast(eq, pet, 'normal', 0);
    A(!low.ok && /成长 10/.test(low.error), '魂铸·普通门槛：成长≥10');
  })();

  await (async () => {
    const eq = { name: 't', slot: '武器', rarity: { id: 'white' }, affixes: { prefix: [], suffix: [] } };
    const pet = baby(); pet.id = 'active1'; pet.level = 40; pet.growth = 10; pet.traits = [{ id: '嗜血', tier: 2 }];
    // 出战宠允许魂铸（玩家自决，2026-09-01 拍板；ui-craft 下拉标「（出战）」）；
    // 成功后自动切到下一只剩余宠物，避免无出战可用
    const act = await ctx.Craft.soulCast(eq, pet, 'normal', 0);
    A(act.ok === true, '出战宠允许魂铸（玩家自决）');
  })();

  await (async () => {
    const eq = { name: 't', slot: '武器', rarity: { id: 'white' }, affixes: { prefix: [], suffix: [] } };
    const pet = baby(); pet.id = 'p2'; pet.level = 40; pet.growth = 40; pet.traits = [{ id: '嗜血', tier: 2 }];
    const r = await ctx.Craft.soulCast(eq, pet, 'elite', 0);
    A(r.ok && r.soulAffix.tier === 1, '魂铸·精锐：T+1 向 T1（2→1）');
  })();

  await (async () => {
    const eq = { name: 't', slot: '武器', rarity: { id: 'white' }, affixes: { prefix: [], suffix: [] } };
    const pet = baby(); pet.id = 'p3'; pet.name = '血月魔狐'; pet.lineId = '血狐'; pet.level = 60; pet.growth = 60; pet.awakened = true;
    const r = await ctx.Craft.soulCast(eq, pet, 'legend', 0);
    A(r.ok && r.soulAffix.awaken === true && r.soulAffix.tier === 1 && r.soulAffix.stat === 'critDamage' && r.soulAffix.value === 10, '魂铸·传承：觉醒特质固定 T1（暴伤+10）');
  })();

  /* ================= 7. 存档兼容（旧库无列） ================= */
  {
    const row = { id: 'c1', name: '腐噜兽', icon: 'x', growth: 30, level: 10, base_hp: 100, base_atk: 20, base_def: 10, base_spd: 40, cur_hp: 100, evolve_times: 0, reborn_count: 0 };
    const p = ctx.Pet.petFromRow(row);
    A(Array.isArray(p.traits) && p.traits.length === 0, 'petFromRow：旧库无 traits 列 → 兜底空数组');
    A(p.awakened === false && p.source === 'normal', 'petFromRow：旧库无 awaken/source 列 → 兜底默认值（未觉醒）');
  }

  console.log('\n全部通过 ✅');
})();
