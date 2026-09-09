// 资源试炼 MVP 契约测试（配置与真实 config.js 同源，避免测试用假配置跑出假绿）
const fs = require('fs');
const vm = require('vm');

const gained = [];
let ticket = 0;
// 强宠 / 弱宠两套属性：失败分支曾经是死代码（旧模型全等级 100% 通关）
const strong = { level: 10, stats: { atk: 500, def: 500, hp: 5000 } };
const weak = { level: 10, stats: { atk: 30, def: 5, hp: 200 } };
let pet = strong;

const ctx = { console, setTimeout, clearTimeout };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);
ctx.Pet = { getActivePet: () => pet, getStats: p => p.stats };
ctx.Materials = {
  getQuantity: name => (name === '资源试炼门票' ? ticket : 0),
  spend: async (name, amount) => {
    if (name !== '资源试炼门票' || ticket < amount) return { ok: false, error: '门票不足' };
    ticket -= amount;
    return { ok: true };
  },
  gain: (name, qty) => gained.push([name, qty])
};
ctx.UI = { renderResourceTrial() {}, showToast() {} };
vm.runInContext(fs.readFileSync('../js/core/resource-trial.js', 'utf8'), ctx);
const T = ctx.ResourceTrial;
const ok = (condition, message) => {
  if (!condition) { console.error('FAIL: ' + message); process.exit(1); }
  console.log('PASS: ' + message);
};

(async () => {
  let result = await T.start('metamorph', { instant: true });
  ok(result.ok === false && result.error === '门票不足', '没有门票不能进入试炼');

  ticket = 1;
  result = await T.start('nirvana', { instant: true });
  ok(result.ok === false && result.error === '需要宠物达到 Lv25', '低等级不能进入涅槃路线');
  ok(ticket === 1, '被等级拦截不消耗门票');

  result = await T.start('metamorph', { instant: true });
  ok(result.ok && result.cleared && result.rounds === 5, '蜕变路线完成五场战斗');
  ok(ticket === 0, '成功试炼消耗一张门票');
  ok(gained.some(x => x[0] === '进化素材' && x[1] === 2), '蜕变路线发放对应进化素材');

  // 失败分支：强度不足必须真的会失败（旧伤害模型下 100% 通关，这条断言能防回归）
  gained.length = 0;
  ticket = 1;
  pet = weak;
  result = await T.start('metamorph', { instant: true });
  ok(result.ok && result.cleared === false && result.rounds < 5, '强度不足会在中途倒下');
  ok(ticket === 0, '失败不退还门票');
  ok(gained.some(x => x[0] === '进化素材' && x[1] === 1), '失败给本路线的基础补偿（进化素材×1，而非区域材料）');
  ok(!gained.some(x => x[0] === '区域材料'), '失败绝不给区域材料（区域材料只能是地图产出）');
  pet = strong;

  // 涅槃路线：奖励必须是当前真正会被消耗的东西（涅磐兽早已不是涅槃消耗品）
  gained.length = 0;
  ticket = 1;
  const lv25 = { level: 25, stats: { atk: 900, def: 300, hp: 9000 } };
  pet = lv25;
  result = await T.start('nirvana', { instant: true });
  ok(result.ok && result.cleared, 'Lv25 可以通过涅槃路线');
  ok(gained.some(x => x[0] === '涅槃丹' && x[1] === 1), '涅槃路线发放涅槃丹');

  // 淬炼路线：低等级给重铸石，Lv25+ 给增缀/剥离
  gained.length = 0;
  ticket = 1;
  pet = strong;
  await T.start('temper', { instant: true });
  ok(gained.some(x => x[0] === '重铸石' && x[1] === 2), '淬炼路线低等级给重铸石');
  gained.length = 0;
  ticket = 1;
  pet = lv25;
  await T.start('temper', { instant: true });
  ok(gained.some(x => x[0] === '增缀石') && gained.some(x => x[0] === '剥离石'), '淬炼路线 Lv25+ 给增缀石与剥离石');
  pet = strong;

  // 难度参数必须存在且合理（旧模型没有这些参数 → 全等级通关）
  const cfg = vm.runInContext('Config.resourceTrials', ctx);
  ok(cfg.hitRatio > 0 && cfg.roundRatio > 0, '试炼有掉血比例与轮次递增参数');
  ok(cfg.roundDelayMs >= 200, '试炼每场之间有演出间隔');
  console.log('ALL RESOURCE TRIAL TESTS PASSED');
})().catch(error => { console.error(error); process.exit(1); });
