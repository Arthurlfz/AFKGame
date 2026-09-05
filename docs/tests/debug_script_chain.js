// 调试：完整模拟 buildNextScript 的核心链（config+enemy-data+带装备宠物+simulateSessionScript）
const fs = require('fs'), vm = require('vm');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() { return { setAttribute() {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, append() {} }; }
const ctx = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  navigator: {}, location: { href: 'http://x' }, localStorage: mem,
  document: { getElementById: () => el(), createElement: () => el(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
  window: null
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('../js/pet/enemy-data.js', 'utf8'), ctx);
const Config = vm.runInContext('window.Config', ctx);
const EnemyData = vm.runInContext('window.EnemyData', ctx);

(async () => {
  const sim = await import('../js/core/battle-sim.mjs');
  console.log('sim 加载 OK，导出:', Object.keys(sim).join(','));

  // 模拟前端宠物对象（含装备：模仿本地 Equipment 结构）
  const pet = {
    name: '血牙狐', icon: 'x', lineId: '血狐', growth: 5, level: 38,
    baseHp: 85, baseAtk: 30, baseDef: 8, baseSpd: 110,
    traits: [], awaken_trait: null, exp: 0, curHp: 500,
    equipment: {
      '武器': { id: 'e1', name: '测试爪', slot: '武器', baseStats: { atk: 30 }, base: null, affixes: { prefix: [{ type: 'lifesteal', value: 4 }], suffix: [] }, soulAffix: null, tier: 3, rarity: 'blue' },
      '护甲': { id: 'e2', name: '测试甲', slot: '护甲', baseStats: { hp: 120, def: 10 }, base: null, affixes: [], soulAffix: null, tier: 2, rarity: 'white' }
    }
  };

  const r = sim.simulateSessionScript({
    pet, areaId: 'blood-rift', seconds: 30, seed: 987654321,
    config: Config, enemyList: EnemyData.list, curHp: 500
  });
  console.log('剧本 OK:', r.events.length, '场, endHp =', r.endHp, ', totalExp =', r.totalExp);
  r.events.forEach(e => console.log(' ', e.enemyName, 'Lv' + e.enemyLevel, 'win=' + e.win, 't', e.t0 + '→' + e.t1, 'hp', e.hpStart + '→' + e.hpLeft, 'exp=' + e.exp));
})().catch(e => { console.error('链路炸点:', e && e.stack || e); process.exit(1); });
