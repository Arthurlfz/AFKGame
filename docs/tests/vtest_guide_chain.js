// 新手引导「链」校验（2026-09-08 奖励即钥匙）—— 改 config 必挂
//  1. 链连续：g1→g10 一环套一环，无断口、无分叉（上一关的尾巴就是下一关的头）
//  2. 每关都有钥匙：钥匙表（tutorialMode.supplyBox.items）覆盖 g1~g10，任何一关都不能没有钥匙
//  3. 钥匙归属合法：每项的 taskIds 只指向真实存在的引导任务
//  4. 数量守恒：钥匙数量 ≥ 该关机制的硬需求（给少了就是卡死，例如 G10 魂铸要 凝魂晶石×10）
//  5. 档位守恒：经验包档位必须 ≥ 该关的等级门槛（合成 Lv40 / 终阶 Lv60）
// 只加载 config.js（纯数据层），不碰 UI / 云端，避免出现"环境桩不足"的假失败。
const fs = require('fs'), vm = require('vm');
const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const C = code => vm.runInContext(code, ctx);

const guide = C(`Config.drop.quests.filter(q => q.category === 'tutorial')`);
const box = C(`Config.tutorialMode.supplyBox.items`);
const ids = guide.map(q => q.id);
const keysOf = id => box.filter(i => (i.taskIds || []).indexOf(id) >= 0);
const sumMat = (id, name) => keysOf(id).filter(i => i.type === 'mat' && i.name === name).reduce((s, i) => s + (i.qty || 0), 0);
const gearsOf = id => keysOf(id).filter(i => i.type === 'gear').reduce((s, i) => s + (i.count || 1), 0);
const packsOf = id => keysOf(id).filter(i => i.type === 'exppack').map(i => i.cap);

(async () => {
  /* ---------- 1. 链连续 ---------- */
  A(guide.length === 10, `引导链 10 关（实际 ${guide.length}）`);
  A(!guide[0].requires, `首关 ${guide[0].id} 无前置（链的起点）`);
  for (let i = 1; i < guide.length; i++) {
    A(guide[i].requires === guide[i - 1].id, `${guide[i].id} 的前置是 ${guide[i - 1].id}（链无断口）`);
  }
  A(guide.filter(q => q.isGuide).length === 9, '引导段 9 关（g1~g9），g10 魂铸是毕业后普通任务');
  A(!guide[9].isGuide, 'g10 不是 isGuide（毕业后任务，不进引导条/加速）');

  /* ---------- 2. 每关都有钥匙 ---------- */
  for (const q of guide) {
    A(keysOf(q.id).length >= 1, `${q.id}「${q.name}」有钥匙（无钥匙 = 玩家卡在这一步）`);
  }

  /* ---------- 3. taskIds 归属合法 ---------- */
  const bad = box.flatMap(i => (i.taskIds || [])).filter(t => ids.indexOf(t) < 0);
  A(bad.length === 0, `钥匙表的 taskIds 全部指向真实引导任务${bad.length ? '（异常：' + bad.join('、') + '）' : ''}`);

  /* ---------- 4. 数量守恒：给少了就是卡死 ---------- */
  A(sumMat('g9', '传说进化素材') >= 5, 'G9 终阶：传说进化素材 ≥5（四阶1 + 终阶 extra 3 已算在内）');
  A(sumMat('g9', '精粹进化素材') >= 1, 'G9 二阶：精粹进化素材 ≥1');
  A(sumMat('g10', '凝魂晶石') >= C(`Config.soulCast.materialCount`),
    `G10 魂铸：凝魂晶石 ≥ soulCast.materialCount（${C('Config.soulCast.materialCount')}）—— 给少了 G10 必卡`);
  A(sumMat('g7', '合成之石') >= C(`Config.synthesize.material.amount`),
    'G7 合成：合成之石 ≥ 合成基础材料需求');
  A(sumMat('g4', '重铸石') >= 1, 'G4 打造：重铸石 ≥1');
  A(gearsOf('g3') >= 1, 'G3 穿装备：至少 1 件装备（不送会卡死）');
  A(gearsOf('g8') >= 1, 'G8 上架：至少 1 件可上架装备');

  /* ---------- 5. 经验包档位 ≥ 该关等级门槛 ---------- */
  const p7 = packsOf('g7'), p9 = packsOf('g9'), p1 = packsOf('g1');
  A(p1.length >= 1 && Math.max.apply(null, p1) >= 10, 'G1 有 Lv10 档经验包（升到进化门槛）');
  A(p7.length >= 1 && Math.max.apply(null, p7) >= C(`Config.synthesize.minLevel`),
    `G7 经验包档位 ≥ 合成门槛 Lv${C('Config.synthesize.minLevel')}（双宠都要够级）`);
  A(p9.length >= 1 && Math.max.apply(null, p9) >= 60, 'G9 经验包档位 ≥ Lv60（终阶进化门槛）');
  const caps = C(`Config.tutorialMode.expPacks.map(p => p.cap)`);
  A(box.filter(i => i.type === 'exppack').every(i => caps.indexOf(i.cap) >= 0),
    '钥匙表里的经验包档位都在 expPacks 配置中（不存在发不出来的档）');

  /* ---------- 6. 钥匙来源唯一：引导关 reward 必须清空 ---------- */
  A(guide.filter(q => q.isGuide && q.reward && Object.keys(q.reward).length).length === 0,
    '引导段（g1~g9）reward 已清空 —— 钥匙统一走 supplyBox，两套并行玩家会看到来路不明的重复资源');

  console.log('\nALL GUIDE CHAIN TESTS PASSED');
})().catch(e => { console.error('FAIL: 测试异常', e); process.exit(1); });
