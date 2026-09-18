const fs = require('fs');
const vm = require('vm');

const gainCalls = [];   // 2026-09-18：记录每次掉落（含是否 bound），用于验证「地图掉的经验包也必须绑定」
const ctx = {
  console,
  Config: undefined,
  Materials: {
    getQuantity: name => name === '枯荣种荚' ? 5 : 0,
    spend: async () => ({ ok: true }),
    // 2026-09-18：记录掉落；经验包必须带 bound（地图掉落也是），这条桩要能看得到
    gain: async (name, n, opts) => { gainCalls.push({ name, n, bound: !!(opts && opts.bound) }); },
    isExpPack: name => ((ctx.Config && ctx.Config.expPacks) || []).some(p => p.name === name)
  },
  Pet: { getActivePet: () => ({ level: 1 }) },
  Supabase: { getCurrentUser: async () => null },
  // drop.js 在加载时就解构 window.Equipment.getEquipBonuses，桩里必须有；返回 1 倍率 = 不做加成
  Equipment: { pickRarity() {}, generateEquipment() {}, addToInventory() {}, getEquipBonuses: () => ({ resources: { dropQty: 1, dropRare: 1, matDrop: 1 } }) },
  Items: {},
  Util: { randInt() { return 1; } }
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/core/quest.js', 'utf8'), ctx);

// 收集类任务的进度直接读背包材料数（不是累计计数）。用当前任务表的 m2「采摘种荚」验证
// （旧任务表的 q1 已随任务系统 v1 移除）。
const q1 = ctx.Quest.getQuests().find(q => q.id === 'm2');
if (!q1 || q1.have !== 5 || q1.progress !== 5) throw new Error(`Quest m2 progress mismatch: ${JSON.stringify(q1)}`);

const gained = [];
const gainBound = {};   // 2026-09-18：记录哪些掉落带 bound（地图掉的经验包必须绑）
ctx.Materials.gain = async (name, n, opts) => {
  gained.push(name);
  if (opts && opts.bound) gainBound[name] = true;
};
ctx.Equipment = { pickRarity() {}, generateEquipment() {}, addToInventory() {}, getEquipBonuses: () => ({ resources: { dropQty: 1, dropRare: 1, matDrop: 1 } }) };
ctx.window.Equipment = ctx.Equipment;
ctx.window.Items = {};
// 改法一：用单池权重强制只掉区域材料（none/material/equipment/egg + materialWeightsByTier 子权重）。
// 注意：drop.js 已改用 materialWeightsByTier（按图档），旧全局 materialWeights 已弃用——
// 子池必须 mock 到 ByTier，否则 corrupted-forest(tier 3) 的真实子池含进化素材，会随机抽到而失败。
ctx.Config.drop.pool = { none: 0, material: 1, equipment: 0, egg: 0 };
ctx.Config.drop.poolByStage = { 1: { none: 0, material: 1, equipment: 0, egg: 0 } }; // 2026-09-06：按阶段池优先于全局 pool，mock 必须覆盖 stage1（图1）
ctx.Config.drop.materialWeights = { '区域材料': 1 }; // 兼容留旧键
ctx.Config.drop.materialWeightsByTier = { 1: { '区域材料': 1 } }; // corrupted-forest = areas[0] → tier 1，子池只留区域材料
vm.runInContext(fs.readFileSync('../js/core/drop.js', 'utf8'), ctx);

(async () => {
  const rr = await ctx.Drop.rollReward({}, { id: 'corrupted-forest' });
  console.log('ROLL:', JSON.stringify(rr));
  console.log('GAINED:', JSON.stringify(gained));
  if (gained.length !== 1 || gained[0] !== '枯荣种荚') throw new Error(`Area material drop mismatch: ${gained}`);
  console.log('PASS: m2 reads 5 枯荣种荚 from Materials');
  console.log('PASS: corrupted-forest area drop gains 枯荣种荚');

  /* 2026-09-18：地图也开始掉经验包 ⇒ 掉出来的必须【绑定】。
   * 为什么必须绑：可交易的经验 = 花钱买练级，会绕过「涅槃的练级成本」这条唯一刹车
   * （与任务/塔产的经验包同口径，见 config.expPacks 段的绑定铁律）。 */
  ctx.Config.drop.materialWeightsByTier = { 1: { '残魂经验囊': 1 } };
  await ctx.Drop.rollReward({}, { id: 'corrupted-forest' });
  const packs = gained.filter(n => (ctx.Config.expPacks || []).some(p => p.name === n));
  if (!packs.length) throw new Error('子池已强制只剩经验包却没掉出来（不该发生）');
  if (!packs.every(n => gainBound[n])) throw new Error(`地图掉的经验包没绑定（会被拿去卖）：${packs.join('/')}`);
  console.log('PASS: 地图掉落经验包带绑定（' + packs.join('/') + '，不可交易）');
})().catch(err => { console.error(err.stack || err); process.exit(1); });
