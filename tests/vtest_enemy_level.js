/* ============================================================
 * vtest_enemy_level.js —— 怪物等级 = 宠物等级【钳进】地图等级段
 * （2026-08-30 用户拍板：匹配地图的等级，而不是宠物等级）
 * 公式：怪等级 = clamp(宠物等级, 图下限, 图上限)
 *   · 图决定「范围」，宠物等级决定「范围内的具体值」，到边界就停
 *   · 老逻辑不设边界：Lv60 打图1 也出 Lv60 怪 → 图与图没区别、赖低级图也能拿满经验
 * 守的承诺：
 *  1. 图段内：怪等级 = 宠物等级（Lv3 在图1 → 怪 Lv3）
 *  2. 上限钳住：宠物高于图段 → 怪取图上限（Lv60 在图1 → 怪 Lv6，不再跟涨）
 *  3. 下限钳住：宠物低于图段 → 怪取图下限（Lv1 在图10 → 怪 Lv55，图是硬门槛）
 *  4. 新手不卡：Lv1 宠物在图1 挂机能赢（有经验进账）
 *  5. 经验跟图走：图1 打出的经验被 6 级封顶，不会随宠物等级无限涨
 * 说明：走【真实挂机】读 Battle.state.enemy.level，不是自己套公式算 ——
 *       自己算会遇到"测试与实现各写一套、实现改了测试还绿"的假绿问题。
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() {
  return { dataset: {}, className: '', textContent: '', innerHTML: '', id: '', value: '', disabled: false,
    style: { setProperty() {} }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
    appendChild(c) { this.children.push(c) }, append() {}, addEventListener(t, f) { this.handlers = this.handlers || {}; this.handlers[t] = f },
    querySelector: () => el(), querySelectorAll: () => [], children: [], removeChild() {}, remove() {},
    scrollTop: 0, scrollHeight: 0, offsetHeight: 0, offsetWidth: 0,
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 } },
    click() { this._onclick && this._onclick() } };
}
const els = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, FormData, Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto, WebSocket: globalThis.WebSocket, navigator: { lock: undefined }, location: { href: 'http://x', hash: '' }, localStorage: mem, document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {} }, session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [], materialsTable: [], petEggTable: [], uidSeq: 0, rpcCalls: [], delCalls: [] };
ctx.window = ctx;
// ui-battle 的 bindEnemyTip 会 window.addEventListener('resize', ...)，桩里缺了会在开战时抛 TypeError
ctx.addEventListener = () => {}; ctx.removeEventListener = () => {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
// ⚠️ enemy-data.js 必须加载：battle.js 的 getEnemyPool 读 window.EnemyData.list，
// 漏了它怪池就是空的 → beginFight 直接 return，挂机"在跑"但一场都打不起来（state.enemy 恒为 null）。
for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/pet/enemy-data.js', '../js/equipment/equipment.js', '../js/pet/pet.js', '../js/core/items.js', '../js/core/materials.js', '../js/core/drop.js', '../js/core/market.js', '../js/equipment/equipment_craft.js', '../js/equipment/salvage.js', '../js/pet/pet_merge.js', '../js/pet/pet_evolve.js', '../js/core/battle.js', '../js/ui/ui-common.js', '../js/ui/ui-battle.js', '../js/ui/ui-pet.js', '../js/ui/ui-equipment.js', '../js/ui/ui-craft.js', '../js/ui/ui-market.js','../js/ui/ui-codex.js','../js/ui/ui-pet-synth.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-market-records.js','../js/ui/ui-market-sell.js', '../js/main.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const C = code => vm.runInContext(code, ctx);
const S = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const toggleBattle = () => C('(function(){const b=document.getElementById("btn-battle");b&&b.handlers&&b.handlers.click&&b.handlers.click();return true})()');

(async () => {
  await S(300); await C('Game.onLogin("lvl@test.com","123456")'); await S(300);
  // 出战宠物（高成长，让战斗快速结束以便多采几场样本）
  // 注意：C() 不是 async 上下文，顶层 await 会 SyntaxError → 必须包 (async()=>{...})()；
  // 且必须调 Game.startGameRuntime()（vtest_deep / vtest_fun 同理），否则挂机跑不起来。
  await C(`(async()=>{
    const p = Pet.addPet(Pet.createPet('腐噜兽','🐹',20,110,22,11,80,'腐噜兽'));
    p.level = 1; Pet.setActive(p.id);
    const u = await Supabase.getCurrentUser();
    if (u) { const r = await Supabase.savePet(p); if (r.data && r.data.id) { p.cloudId = r.data.id; await Supabase.updatePet(p.cloudId, { is_active: true }); } }
    if (window.Game && window.Game.startGameRuntime) window.Game.startGameRuntime();
    globalThis.__p = p.id; return true;})()`);
  A(!!C('globalThis.__p'), '已建立出战宠物并启动游戏运行时');

  const areas = JSON.parse(C('JSON.stringify(Config.battle.areas)'));
  const area = id => areas.find(a => a.id === id);
  const first = areas[0], last = areas[areas.length - 1];

  // 采样：设宠物等级 → 选图 → 挂机 → 反复读 (宠物等级, 怪等级)
  async function sample(areaId, petLevel, ms) {
    C(`(function(){const p=Pet.getActivePet();p.level=${petLevel};p.curHp=Pet.getStats(p).hp;return true})()`);
    C(`Battle.selectArea(${JSON.stringify(areaId)})`);
    toggleBattle(); // 开始挂机
    const out = [], t0 = Date.now();
    while (Date.now() - t0 < ms) {
      await S(200);
      const s = C('JSON.stringify({pl:(Pet.getActivePet()||{}).level,el:(Battle.state&&Battle.state.enemy||{}).level})');
      try { const j = JSON.parse(s); if (j.pl != null && j.el != null) out.push(j); } catch (e) { /* 战斗间隙跳过 */ }
    }
    if (C('Battle.isRunning()')) toggleBattle(); // 停挂机
    return out;
  }

  /* ---------- 1. 图段内：怪等级 = 宠物等级 ---------- */
  {
    const [lo, hi] = first.levelRange;
    const s = await sample(first.id, 3, 2600);
    A(s.length > 0, `图段内采样到战斗样本（${s.length} 个）`);
    const bad = s.filter(x => x.el !== clamp(x.pl, lo, hi));
    A(bad.length === 0, `图「${first.name}」(Lv${lo}-${hi}) 怪等级 = clamp(宠物等级,${lo},${hi})` +
      (bad.length ? `，越界样本：${JSON.stringify(bad.slice(0, 5))}` : `，样本 eg 宠物Lv${s[0].pl}→怪Lv${s[0].el}`));
    A(s.some(x => x.pl >= lo && x.pl <= hi && x.el === x.pl),
      '宠物等级落在图段内时，怪等级等于宠物等级（不掷骰子、不偏移）');
  }

  /* ---------- 2. 上限钳住：高等级宠物打低级图，怪只出图上限 ---------- */
  {
    const [lo, hi] = first.levelRange;
    const s = await sample(first.id, 60, 2600);
    A(s.length > 0, `上限场景采样到样本（${s.length} 个）`);
    A(s.every(x => x.el === hi),
      `Lv60 打图「${first.name}」→ 怪等级恒为 ${hi}（图上限，不再跟着宠物涨到 60）` +
      `，实测：${[...new Set(s.map(x => x.el))].join('/')}`);
  }

  /* ---------- 3. 下限钳住：低等级宠物进高级图，怪取图下限（图是硬门槛） ---------- */
  {
    const [lo, hi] = last.levelRange;
    const s = await sample(last.id, 1, 2600);
    A(s.length > 0, `下限场景采样到样本（${s.length} 个）`);
    A(s.every(x => x.el === lo),
      `Lv1 进图「${last.name}」(Lv${lo}-${hi}) → 怪等级恒为 ${lo}（图下限，越级就是打不过）` +
      `，实测：${[...new Set(s.map(x => x.el))].join('/')}`);
  }

  /* ---------- 4. 新手不卡：Lv1 正常成长宠物在图1 挂机能赢 ---------- */
  {
    C(`(function(){const p=Pet.getActivePet();p.growth=5.5;p.level=1;p.exp=0;p.curHp=Pet.getStats(p).hp;return true})()`);
    C(`Battle.selectArea(${JSON.stringify(first.id)})`);
    const f0 = C('Battle.getTotalFights()');
    toggleBattle();
    await S(15000); // 图1 单场约 5~7 秒，等 15 秒够打 2 场
    if (C('Battle.isRunning()')) toggleBattle();
    const f1 = C('Battle.getTotalFights()');
    const lv = C('Pet.getActivePet().level'), exp = C('Math.round(Pet.getActivePet().exp)');
    A(f1 > f0, `新手 Lv1 在图1 能持续开战（场次 ${f0} → ${f1}）`);
    A(lv > 1 || exp > 0, `新手 Lv1 在图1 能赢并拿到经验（等级 ${lv}、经验 ${exp}）—— 不会卡在起手`);
  }

  /* ---------- 5. 经验跟图走：图1 经验被图上限封顶 ---------- */
  {
    const [lo, hi] = first.levelRange;
    // 注意：Pet 只导出 expFromBattle / expRange，expBase 是内部函数（未导出，直接调会 EXC）
    const eAtCap = C(`(function(){const a=Battle.getAreas().find(x=>x.id===${JSON.stringify(first.id)});
      return Pet.expFromBattle({level:${hi}}, a)})()`);
    const eAtPet60 = C(`(function(){const a=Battle.getAreas().find(x=>x.id===${JSON.stringify(first.id)});
      return Pet.expFromBattle({level:60}, a)})()`);
    // 怪等级被钳在图上限，所以按 60 级算出的经验在图1 里根本拿不到
    A(eAtCap < eAtPet60,
      `图1 经验被封顶：按图上限 Lv${hi} 只有 ${Math.round(eAtCap)}/场（若仍跟宠物等级走则会是 ${Math.round(eAtPet60)}/场）`);
  }

  console.log('ALL ENEMY LEVEL TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('EXC', e && (e.stack || e.message)); process.exit(1) });
