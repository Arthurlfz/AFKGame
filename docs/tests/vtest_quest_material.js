const fs = require('fs');
const vm = require('vm');

const ctx = {
  console,
  Config: undefined,
  Materials: {
    getQuantity: name => name === '枯荣种荚' ? 5 : 0,
    spend: async () => ({ ok: true }),
    gain: async () => {}
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
ctx.Materials.gain = async name => gained.push(name);
ctx.Equipment = { pickRarity() {}, generateEquipment() {}, addToInventory() {}, getEquipBonuses: () => ({ resources: { dropQty: 1, dropRare: 1, matDrop: 1 } }) };
ctx.window.Equipment = ctx.Equipment;
ctx.window.Items = {};
// 改法一：用单池权重强制只掉区域材料（none/material/equipment/egg + materialWeights 子权重）
ctx.Config.drop.pool = { none: 0, material: 1, equipment: 0, egg: 0 };
ctx.Config.drop.materialWeights = { '区域材料': 1 };
vm.runInContext(fs.readFileSync('../js/core/drop.js', 'utf8'), ctx);

(async () => {
  await ctx.Drop.rollReward({}, { id: 'corrupted-forest' });
  if (gained.length !== 1 || gained[0] !== '枯荣种荚') throw new Error(`Area material drop mismatch: ${gained}`);
  console.log('PASS: m2 reads 5 枯荣种荚 from Materials');
  console.log('PASS: corrupted-forest area drop gains 枯荣种荚');
})().catch(err => { console.error(err.stack || err); process.exit(1); });
