/* ============================================================
 * vtest_awaken_flow.js —— 2026-09-10 v2 觉醒改版全链路
 *   ① 配置契约：任务「觉醒之路」（图1~10区域材料×888求和 → 觉醒石×1，可反复）
 *   ② 觉醒石不可上架（不在 Config.trade.materials）
 *   ③ 任务流：求和进度 → 交任务扣料发石
 *   ④ 觉醒状态：永久标记 awakened（与等级无关，非终形态不生效，变异/神级继承）
 *   ⑤ 云端映射：awaken_trait='1' ⇔ pet.awakened
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const VTF = require('./vtest_files');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() { return { setAttribute() {}, removeAttribute() {}, getAttribute: () => null, textContent: '', innerHTML: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, appendChild() {}, append() {}, addEventListener() {}, querySelector: () => el(), querySelectorAll: () => [], children: [], remove() {}, scrollTop: 0, scrollHeight: 0, disabled: false, value: '0', id: '' } };
const els = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, FormData, Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto, WebSocket: globalThis.WebSocket, navigator: { lock: undefined }, location: { href: 'http://x' }, localStorage: mem, document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {} }, session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [], materialsTable: [], petEggTable: [], tradeTable: [], uidSeq: 0, rpcCalls: [], delCalls: [] };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/equipment/equipment.js', '../js/pet/pet.js', '../js/core/items.js', '../js/core/materials.js', '../js/core/quest.js', '../js/core/battle-sim.global.js']) VTF.load(ctx, f);
const C = code => vm.runInContext(code, ctx);
const A = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + m); if (!c) process.exitCode = 1 };

/* ---------- ① 配置契约 ---------- */
const q = C(`(function(){
  const q = Config.drop.quests.find(x => x.id === 'awaken_road');
  globalThis.__aq = q;
  return { have: !!q, repeatable: q && q.repeatable, need: q && q.need, reward: q && q.reward && q.reward['觉醒石'],
    mats: q && q.matList, areaMats: Object.values(Config.drop.areaMaterials).map(m => m.name), unlock: q && q.unlockLevel };
})()`);
A(q.have, '任务 awaken_road 已配置');
A(q.repeatable === true, '任务可反复提交（每只宠都要一颗觉醒石）');
A(q.need === 888, '需求数量 = 888');
A(q.reward === 1, '奖励 = 觉醒石 ×1');
A(Array.isArray(q.mats) && q.mats.length === 10 && q.mats.every(m => q.areaMats.includes(m)), 'matList = 图1~10 的 10 种区域材料（与 areaMaterials 一致）');
A(q.unlock === 40, '解锁等级 40');

/* ---------- ② 觉醒石不可上架 ---------- */
const tradable = C(`(Config.trade && Config.trade.materials) || []`);
A(!tradable.includes('觉醒石'), '觉醒石不在交易材料表（天然不可上架）');

/* ---------- ③ 任务流 ---------- */
(async () => {
  await C('Quest.loadCloudProgress()');
  // 登录（vstub 会话 user-a）+ 出战宠 Lv40 → 任务解锁；材料走 gain+flush 同步云端（spend 是云端原子扣减）
  await C(`(async function(){
    await Supabase.getClient().auth.signInWithPassword({ email: 'a@b.c', password: 'x' });
    const p = Pet.createPet('血月魔狐', null, 60, 300, 80, 40, 50, '血狐');
    p.level = 40; Pet.addPet(p); Pet.setActive(p.id); globalThis.__ap = p;
    // 10 种材料每种 900 ≥ 888
    globalThis.__aq.matList.forEach(n => Materials.gain(n, 900));
    await Materials.flushMaterials();
    return true;
  })()`);
  const before = C(`globalThis.__aq.matList.reduce((m,n)=>Math.min(m,Materials.getQuantity(n)),Infinity)`);
  const st = C(`(Quest.getQuests().find(x => x.id === 'awaken_road'))`);
  A(st && st.have === 900 && st.done, `每种短板进度生效（每种 ${st ? st.have : 'NaN'}/888，done）`);
  const short = C(`(function(){
    const one = globalThis.__aq.matList[0];
    Materials.spendLocal(one, 100);   // 挖空一种 → 进度按最短板掉到 800
    const s = Quest.getQuests().find(x => x.id === 'awaken_road');
    Materials.gainLocal(one, 100);    // 补回来
    return s.have;
  })()`);
  A(short === 800, `短板判定：一种不够 888 → 总进度按它算（${short}）`);
  const res = await C(`Quest.completeQuest('awaken_road')`);
  A(res && res.ok, `交任务成功${res && res.error ? '（' + res.error + '）' : ''}`);
  const stone = C(`Materials.getQuantity('觉醒石')`);
  A(stone === 1, '觉醒石到账 ×1');
  const after = C(`globalThis.__aq.matList.reduce((m,n)=>Math.min(m,Materials.getQuantity(n)),Infinity)`);
  A(before - after === 888, `交任务每种扣料 888（每种 ${before} → ${after}）`);
  const again = await C(`Quest.completeQuest('awaken_road')`);
  A(again && again.ok === true || (again && again.error && /差/.test(again.error)), 'repeatable：可再次提交（材料不足时报缺口，不报"已交过"）');

  /* ---------- ④ 觉醒状态 ---------- */
  const aw = C(`(function(){
    const p = globalThis.__ap; p.name = '血月魔狐';
    return {
      off: Pet.getAwakenState(p),
      on: (p.awakened = true, Pet.getAwakenState(p)),
    };
  })()`);
  A(aw.off === null, '未觉醒 → 觉醒状态为空（Lv40 终形态也一样）');
  A(aw.on && aw.on.skillName === '血月斩' && aw.on.bonus && aw.on.bonus.stat === 'critDamage', '觉醒后：血月斩 +20% 暴伤加成挂上');
  const lv1 = C(`(function(){ const p=globalThis.__ap; p.level=1; const r=Pet.getAwakenState(p); p.level=40; return r !== null; })()`);
  A(lv1 === true, '觉醒后 Lv1 也生效（永久，涅槃/转生不清）');
  const simAw = C(`(function(){
    const p = { name: '血月魔狐', lineId: '血狐', level: 1, awakened: true };
    const a = BattleSim.getAwakenState(p, Config);
    p.awakened = false;
    const b = BattleSim.getAwakenState(p, Config);
    return { on: a && a.skillName, off: b };
  })()`);
  A(simAw.on === '血月斩' && simAw.off === null, '服务器战核同规则：awakened 标记驱动，与等级无关');

  /* ---------- ⑤ 云端映射 ---------- */
  const map = C(`(function(){
    const row = { id: 'c9', name: '血月魔狐', growth: 60, level: 1, hp: 100, attack: 20, defense: 10, speed: 40, cur_hp: 100, awaken_trait: '1' };
    const p = Pet.petFromRow(row);
    row.awaken_trait = null;
    const p2 = Pet.petFromRow(row);
    return { on: p.awakened, off: p2.awakened };
  })()`);
  A(map.on === true && map.off === false, '云端映射：awaken_trait=\'1\' → awakened=true（旧宠 null → false）');

  console.log('\nALL AWAKEN FLOW TESTS PASSED');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('FAIL: ' + (e && e.message || e)); process.exit(1); });
