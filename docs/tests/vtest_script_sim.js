/* ============================================================
 * vtest_script_sim.js —— 剧本生成器（simulateSessionScript）验证
 * 从 tests/ 目录运行：node vtest_script_sim.js
 * 覆盖：
 *   A. 30 秒模拟产出战斗事件（场次>0、字段齐全）
 *   B. 血量轨迹合法（hpStart ≥ hpLeft，全程在 [0, maxHp]）
 *   C. 同种子两次运行 → 剧本完全一致（确定性回放的根基）
 *   D. 不同种子 → 剧本不同（随机性真实存在）
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };

const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() { return { setAttribute() {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, append() {} }; }

(async () => {
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

  const sim = await import('../js/core/battle-sim.mjs');

  const pet = { name: '血狐', icon: '🦊', lineId: '血狐', growth: 5, level: 38, baseHp: 85, baseAtk: 30, baseDef: 8, baseSpd: 110, traits: [], awaken_trait: null, equipment: {}, exp: 0 };
  const input = (seed) => ({
    pet, areaId: 'blood-rift', seconds: 30, seed,
    config: ctx.window.Config, enemyList: ctx.window.EnemyData.list, curHp: 500
  });

  /* ---------- A. 产出事件 ---------- */
  const r1 = sim.simulateSessionScript(input(12345));
  A(r1.events && r1.events.length > 0, 'A1. 30 秒产出 ' + r1.events.length + ' 场战斗事件');
  const e0 = r1.events[0];
  A(e0.type === 'fight' && e0.enemy && e0.enemyName && typeof e0.t0 === 'number' && typeof e0.t1 === 'number' && e0.t1 > e0.t0,
    'A2. 事件字段齐全（' + e0.enemyName + ' Lv' + e0.enemyLevel + '，' + (e0.t1 - e0.t0) + 'ms）');
  A(typeof e0.exp === 'number' && typeof e0.hpStart === 'number' && typeof e0.hpLeft === 'number',
    'A3. 经验/血量字段齐全（exp=' + e0.exp + '，hp ' + e0.hpStart + '→' + e0.hpLeft + '）');

  /* ---------- B. 血量轨迹合法 ---------- */
  let ok = true;
  for (const e of r1.events) {
    if (e.hpStart < 0 || e.hpLeft < 0 || e.hpStart > r1.petMaxHp || e.hpLeft > r1.petMaxHp) ok = false;
  }
  A(ok, 'B1. 全程血量在 [0, ' + r1.petMaxHp + '] 内');

  /* ---------- C. 同种子确定性 ---------- */
  const r2 = sim.simulateSessionScript(input(12345));
  const sig = r => JSON.stringify(r.events.map(e => [e.t0, e.t1, e.enemyName, e.enemyLevel, e.win, e.exp, e.hpStart, e.hpLeft]));
  A(sig(r1) === sig(r2), 'C1. 同种子两次运行剧本完全一致（确定性回放的根基）');

  /* ---------- D. 不同种子差异 ---------- */
  const r3 = sim.simulateSessionScript(input(999));
  A(sig(r1) !== sig(r3), 'D1. 不同种子剧本不同（随机性真实存在）');

  /* ---------- E. 演出刀数（2026-09-09） ----------
   * 演出层靠 petHits/enemyHits 给行动条定速、把本场总掉血按刀分摊。
   * 少了它演出就退回「时间插值扣血」→ 行动条没跑满怪就死、飘字与血条对不上。 */
  let hitsOk = true;
  const hitInfo = [];
  for (const e of r1.events) {
    if (!(Number(e.petHits) >= 1) || !(Number(e.enemyHits) >= 0)) hitsOk = false;
    hitInfo.push(e.petHits + '/' + e.enemyHits);
  }
  A(hitsOk, 'E1. 每场都带出手刀数（我方/敌方：' + hitInfo.join('、') + '）');

  /* ---------- F. consumedMs：本次真正"吃掉"的会话时间（2026-09-13） ----------
   * 服务器靠它推进结算游标：没吃掉的秒数必须留在账上，否则客户端被浏览器冻结 / 电脑休眠
   * 那段时间会被游标一步跨过 = 永久作废（用户实测"挂了一整夜几乎没收益"的根因之一）。 */
  A(typeof r1.consumedMs === 'number' && r1.consumedMs > 0,
    'F1. 返回 consumedMs（本次吃掉 ' + r1.consumedMs + 'ms）');
  A(r1.consumedMs >= 30000, 'F2. 30 秒窗口被完整吃掉（' + r1.consumedMs + 'ms ≥ 30000，游标不会漏掉时间）');
  const rLong = sim.simulateSessionScript(Object.assign(input(777), { seconds: 4 * 3600 }));
  A(rLong.consumedMs > 0 && rLong.consumedMs <= 4 * 3600 * 1000,
    'F3. 4 小时窗口不会吃超请求时长（' + rLong.consumedMs + 'ms）');
  A(rLong.events.length === 200,
    'F4. 超长窗口撞上模拟器 200 场上限（' + rLong.events.length + ' 场）→ 剩余秒数留给下次继续补');
  const rZero = sim.simulateSessionScript(Object.assign(input(777), { seconds: 0 }));
  A(rZero.consumedMs === 0 && rZero.events.length === 0, 'F5. 零秒窗口不吃时间（consumedMs=0）');

  console.log('\nALL SCRIPT SIM TESTS PASSED');
})().catch(e => { console.error('FAIL: ' + (e && e.stack || e)); process.exit(1); });
