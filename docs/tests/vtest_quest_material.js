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
  Equipment: { pickRarity() {}, generateEquipment() {}, addToInventory() {} },
  Items: {},
  Util: { randInt() { return 1; } }
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/core/quest.js', 'utf8'), ctx);

const q1 = ctx.Quest.getQuests().find(q => q.id === 'q1');
if (!q1 || q1.have !== 5 || q1.progress !== 5) throw new Error(`Quest q1 progress mismatch: ${JSON.stringify(q1)}`);

const gained = [];
ctx.Materials.gain = async name => gained.push(name);
ctx.Equipment = { pickRarity() {}, generateEquipment() {}, addToInventory() {} };
ctx.window.Equipment = ctx.Equipment;
ctx.window.Items = {};
ctx.Config.drop.equipmentChance = 0;
ctx.Config.drop.eggChance = 0;
ctx.Config.drop.phoenixChance = 0;
ctx.Config.drop.reforgeStoneChance = 0;
ctx.Config.drop.stripStoneChance = 0;
ctx.Config.drop.holyStoneChance = 0;
ctx.Config.drop.augmentStoneChance = 0;
ctx.Config.drop.evolutionMaterials = {};
ctx.Config.drop.areaMaterials['corrupted-forest'].chance = 1;
vm.runInContext(fs.readFileSync('../js/core/drop.js', 'utf8'), ctx);

(async () => {
  await ctx.Drop.rollReward({}, { id: 'corrupted-forest' });
  if (gained.length !== 1 || gained[0] !== '枯荣种荚') throw new Error(`Area material drop mismatch: ${gained}`);
  console.log('PASS: q1 reads 5 枯荣种荚 from Materials');
  console.log('PASS: corrupted-forest area drop gains 枯荣种荚');
})().catch(err => { console.error(err.stack || err); process.exit(1); });
