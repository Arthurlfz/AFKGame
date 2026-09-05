// 任务系统回归测试（120 条任务 v4：10 新手 + 68 主线 + 12 日常 + 6 成就 + 24 宠物）
// 注：2026-08-30 地图从 6 图扩到 10 图，主线由 24 条（6图×4）扩到 40 条（10图×4）；
//     2026-08-31 新增宠物专属 24 条（8 宠 × 3 养成链：孵化→带它击杀→它进化），独立 pet 分类
//     2026-08-31 第二幕 7 图（61-100 级），主线再扩 28 条（m41~m68，17图×4）
//  - 数据：五类任务数量、新手链前置依赖、类型齐全
//  - 逻辑：引导条取当前任务、按类型上报、限定地图匹配、一次性完成、日常当天只交一次、跳过引导
//  - 宠物专属：petName 过滤（进度只算指定宠出战）、孵化任务已拥有即完成、固定经验档位
//  - UI：引导条渲染不抛错
// 复用 vstub.js 的 VM 桩（vstub.js）
const fs = require('fs'), vm = require('vm');
const VTF=require('./vtest_files');
const mem = (() => { const m = {}; return { getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } })();
function el() { return { dataset: {}, setAttribute() { }, removeAttribute() { }, getAttribute: () => null, textContent: '', innerHTML: '', style: {}, classList: { add() { }, remove() { }, toggle() { }, contains() { return false } }, appendChild(c) { this.children.push(c) }, append() { }, addEventListener() { }, querySelector: () => el(), querySelectorAll: () => [], children: [], removeChild() { }, remove() { }, scrollTop: 0, scrollHeight: 0, disabled: false, value: '' } };
const els = {};
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: global.fetch, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, FormData, Headers, Request, Response, ReadableStream, WritableStream, crypto: global.crypto, WebSocket: globalThis.WebSocket, navigator: { lock: undefined }, location: { href: 'http://x', hash: '' }, localStorage: mem, document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [] }, session: null, petsTable: [], itemsTable: [], listingsTable: [], itemListTable: [], materialsTable: [], petEggTable: [], uidSeq: 0, rpcCalls: [], delCalls: [] };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('vstub.js', 'utf8'), ctx);
for (const f of ['../js/core/config.js', '../js/core/supabase.js', '../js/equipment/equipment.js', '../js/pet/pet.js', '../js/core/items.js', '../js/core/materials.js', '../js/core/drop.js', '../js/core/market.js', '../js/equipment/equipment_craft.js', '../js/equipment/salvage.js', '../js/pet/pet_merge.js', '../js/pet/pet_evolve.js', '../js/core/quest.js', '../js/core/battle.js', '../js/ui/ui-common.js', '../js/ui/ui-battle.js', '../js/ui/ui-pet.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-synth.js', '../js/ui/ui-equipment.js', '../js/ui/ui-craft.js', '../js/ui/ui-market.js', '../js/ui/ui-codex.js', '../js/ui/ui-quest.js', '../js/main.js']) VTF.load(ctx, f);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const C = code => vm.runInContext(code, ctx);
(async () => {
  await C('Game.onLogin("quest@test.com","123456")');
  // 建一只出战宠物：主线/日常/成就按出战宠物等级解锁（真实流程开局必选宠）
  C(`(function(){const p=Pet.createPet('腐噜兽','🐹',5,110,22,11,40,'腐噜兽');Pet.addPet(p);Pet.setActive(p.id);return true})()`);
  A(C(`Pet.getActivePet() && Pet.getActivePet().level`) >= 1, '已建立 Lv.1 出战宠物（任务解锁依赖它）');

  /* ---------- 数据完整性 ---------- */
  const total = C('Config.drop.quests.length');
  A(total === 140, '任务总数 140 条（含 10 条地图委托，实际 ' + total + '）');
  const count = cat => C(`Config.drop.quests.filter(q=>q.category==='${cat}').length`);
  A(count('tutorial') === 10, '新手成长 10 条');
  A(count('main') === 88, '主线 88 条（含 10 条地图委托）');
  A(count('daily') === 12, '日常 12 条');
  A(count('achieve') === 6, '成就 6 条');
  A(count('pet') === 24, '宠物专属 24 条（8 宠 × 3 养成链）');
  const types = C('JSON.stringify([...new Set(Config.drop.quests.map(q=>q.type))].sort())');
  A(JSON.parse(types).length === 16, '覆盖 16 种任务类型（含地图委托，实际 ' + JSON.parse(types).length + ' 种）');

  /* ---------- 新手链前置依赖 ---------- */
  A(C(`Config.drop.quests.find(q=>q.id==='g1') && !Config.drop.quests.find(q=>q.id==='g1').requires`), '新手第一条 g1 无前置');
  A(C(`['g2','g3','g4','g5','g6','g7','g8','g9','g10'].every(id=>!!(Config.drop.quests.find(q=>q.id===id)||{}).requires)`), '新手 g2~g10 都配了前置任务');
  // 链完整性：有且仅有一个起点，从起点能一路走到底且条数 = 总数（防断链 / 分叉 / 成环）
  // requires 指向的是「前置」，所以要反向建「后继」索引才能从 g1 一路走到底
  A(C(`(function(){const T=Config.drop.quests.filter(q=>q.category==='tutorial');
    const roots=T.filter(q=>!q.requires); if(roots.length!==1) return false;
    const next={}; T.forEach(q=>{ if(q.requires) next[q.requires]=q; });
    let cur=roots[0],n=0,seen={};
    while(cur){ if(seen[cur.id]) return false; seen[cur.id]=1; n++; cur=next[cur.id]||null; }
    return n===T.length})`), '新手链线性完整：单起点、无断链、无分叉、无环，10 条全串起来');
  // 进化门槛 Lv10（g1 升级任务达标 = 宠物到 Lv10），g2（初次蜕变·进化）前必须有升级缓冲，否则引导条会卡在 0/1 干等
  A(C(`(function(){const g2=Config.drop.quests.find(q=>q.id==='g2');const pre=Config.drop.quests.find(q=>q.id===g2.requires);
    return !!g2 && g2.type==='evolve' && !!pre && pre.type==='level' && pre.need>=10})`), '进化任务 g2 的前置是升级任务 g1（need≥10，保证玩家刷到 Lv10 再接进化）');
  A(C(`Config.drop.quests.filter(q=>q.category==='tutorial').every(q=>q.guide && q.guide.page)`), '每条新手任务都配了引导跳转目标');

  /* ---------- 引导条：取当前该做的那条 ---------- */
  A(C(`window.Quest && typeof Quest.getGuideQuest === 'function'`), 'Quest.getGuideQuest 已导出（引导条用）');
  A(C(`(Quest.getGuideQuest()||{}).id`) === 'g1', '初始引导条指向 g1 引路人的馈赠');

  /* ---------- 按类型上报 ---------- */
  C(`Quest.reportType('kill', 1, { areaId: 'corrupted-forest' })`);
  const after = C(`JSON.stringify(Quest.getQuests().filter(q=>q.type==='kill').map(q=>[q.id,q.progress]))`);
  const killMap = Object.fromEntries(JSON.parse(after));
  A(!(killMap['g1'] > 0), '击杀上报不影响升级任务 g1（g1 进度=宠物等级）');
  A(killMap['m1'] === 1, '击杀上报：同图主线 m1（枯荣之地）进度 +1');
  A(killMap['m5'] === 0, '限定地图生效：m5（泣腐泥沼）不计入本次击杀');
  A(killMap['a1'] === 1, '成就 a1 累计击败 +1');

  /* ---------- 完成新手任务 → 自动进下一条 ---------- */
  const expBefore0 = C(`Pet.getActivePet().exp`);
  const lvBefore0 = C(`Pet.getActivePet().level`);
  // g1 是 level 任务：进度 = 出战宠等级，达标需 Lv10（对应引导经验包的等效等级）
  C(`(function(){const p=Pet.getActivePet();p.level=10;p.exp=0;return true})()`);
  const r1 = await C(`Quest.completeQuest('g1')`);
  A(r1 && r1.ok, '提交 g1 成功（' + ((r1.rewards || []).join('、') || '无奖励') + '）');
  A(r1 && r1.exp > 0, `任务奖励经验为主（g1 给 经验 +${r1.exp || 0}，材料为辅助）`);
  // 新手档=固定 300 经验：交 g1 后经验应累加或触发升级，两者都算"经验生效"。
  A(C(`Pet.getActivePet().level`) > lvBefore0 || C(`Pet.getActivePet().exp`) >= expBefore0 + (r1.exp || 0),
    '任务经验已计入当前出战宠物（经验累加或触发升级）');
  A(C(`(Quest.getGuideQuest()||{}).id`) === 'g2', '交完 g1 后引导条自动指向 g2（前置依赖生效）');
  const r2 = await C(`Quest.completeQuest('g1')`);
  A(r2 && r2.error, '一次性任务不能重复交（提示：' + (r2.error || '') + '）');
  A(C(`Quest.getQuests().find(q=>q.id==='g1').finished`) === true, 'g1 标记为已完成');

  /* ---------- 新手链送装备：g3「披甲上阵」的前置 g2 必须给一件，否则引导卡死 ----------
   * 装备只能靠战斗 5% 掉落（drop.js），新手做完 g1（升级）时背包很可能还是空的，
   * 而 g3 要的正是「穿上 1 件装备」—— g2 不送就是死循环。 */
  A(C(`(function(){const g3=Config.drop.quests.find(q=>q.id==='g3');
    const g2=Config.drop.quests.find(q=>q.id===g3.requires);
    return !!g3 && g3.type==='equip' && !!g2 && (Number(g2.rewardGear&&g2.rewardGear.count)||Number(g2.rewardGear)||0)>=1})`),
    'g3（穿装备）的前置任务送至少 1 件装备（不送会卡死引导）');
  C(`Quest.reportType('evolve', 1)`); // g2 进化任务上报 1 次即达标
  const bagBefore = C(`Equipment.getInventory().length`);
  const rT2 = await C(`Quest.completeQuest('g2')`);
  A(rT2 && rT2.ok, '提交 g2 成功（' + ((rT2.rewards || []).join('、') || '无奖励') + '）');
  const bagAfter = C(`Equipment.getInventory().length`);
  A(bagAfter === bagBefore + 1, `交 g2 后背包 +1 件装备（${bagBefore} → ${bagAfter}）`);
  const gift = JSON.parse(C(`JSON.stringify(Equipment.getInventory()[0]||{})`));
  A(!!(gift.slot && gift.rarity && gift.rarity.id), `送的是一件完整装备（部位 ${gift.slot} / ${gift.rarity && gift.rarity.label}）`);
  A((rT2.rewards || []).join('').indexOf('装备') >= 0, '奖励列表写明了送的装备（玩家看得见领到什么）');
  // 送的装备必须能立刻穿上 —— g3 就是靠它完成的
  A(C(`(function(){const eq=Equipment.getInventory()[0];return !!Equipment.equipItem(Pet.getActivePet(), eq.id)})()`),
    '送的装备能直接穿上（g3 有解，引导链不断）');
  A(C(`(Quest.getQuests().find(q=>q.id==='g3')||{}).progress`) >= 1, '穿装备上报到 g3 进度（引导链能继续走）');
  A(C(`(Quest.getQuests().find(q=>q.id==='g3')||{}).unlocked`) === true, '交完 g2 后 g3 解锁（前置依赖生效）');

  /* ---------- 日常：当天只能交一次 ---------- */
  C(`for(let i=0;i<200;i++) Quest.reportType('kill', 1, { areaId: 'corrupted-forest' })`);
  const rd1 = await C(`Quest.completeQuest('d1')`);
  A(rd1 && rd1.ok, '提交日常 d1（击败 100 只）成功');
  const rd1b = await C(`Quest.completeQuest('d1')`);
  A(rd1b && rd1b.error, '日常当天不能重复交（提示：' + (rd1b.error || '') + '）');
  A(C(`Quest.getQuests().find(q=>q.id==='d1').finished`) === true, 'd1 标记为今日已完成');

  /* ---------- 跳过引导 ---------- */
  C(`Quest.skipGuide()`);
  A(C(`Quest.getGuideQuest()`) === null, '跳过引导后引导条返回 null（引导条消失）');
  A(C(`Quest.getQuests().filter(q=>q.category==='tutorial').every(q=>q.finished)`), '跳过后整条新手链标记为已完成');

  /* ---------- 追踪栏渲染 + 任务追踪 ---------- */
  C(`UI.renderQuestTracker()`);
  A(C(`document.getElementById('quest-tracker').style.display`) === 'none', '跳过后且无追踪任务时追踪栏隐藏');

  // 模拟「换号 / 新账号」：清内存 + 清云端任务表 + 重拉进度。
  // 真实流程是登出走 clearAccountState → Quest.reset()，再登录走 restoreCloudPets → loadCloudProgress。
  // 只 reset 不重拉的话 cloudLoaded 仍为 false，提交会被「进度还在加载」拦下——这是设计使然，不是 bug。
  const hardReset = async () => {
    C(`Quest.reset(); if (globalThis.questTable) globalThis.questTable.length = 0;`);
    await C(`Quest.loadCloudProgress()`);
  };
  // 模拟刷新页面：只清内存，云端留着，再从云端读回来
  const reload = async () => {
    C(`Quest.reset()`);
    await C(`Quest.loadCloudProgress()`);
  };

  await hardReset();
  C(`UI.renderQuestTracker()`);
  A(C(`document.getElementById('quest-tracker').style.display`) === '', '重置后追踪栏重新显示（新手链未完成）');
  // 测试桩不解析 HTML，所以断言走 innerHTML 字符串
  const qtCount = () => C(`(document.getElementById('quest-tracker').innerHTML.match(/qt-item/g)||[]).length`);
  const qtHtml = () => C(`document.getElementById('quest-tracker').innerHTML`);
  A(qtCount() === 1, '追踪栏当前 1 条（新手链当前任务）');
  A(qtHtml().indexOf('引路人的馈赠') !== -1, '追踪栏显示任务名「引路人的馈赠」');

  // 钉住两个普通任务
  C(`Quest.toggleTrack('m1'); Quest.toggleTrack('d1'); UI.renderQuestTracker()`);
  A(C(`Quest.getTracked().length`) === 2, '已钉住 2 个任务');
  A(qtCount() === 3, '追踪栏显示 3 条（新手 1 + 追踪 2）');
  // 钉满 3 个后，再钉第 4 个才会挤掉最早钉的那个
  C(`Quest.toggleTrack('a1')`);
  A(C(`Quest.getTracked().length`) === 3, '钉满 3 个（上限内不挤）');
  C(`Quest.toggleTrack('a2')`);
  A(C(`Quest.getTracked().length`) === 3, '超过上限仍保持 3 条');
  A(C(`Quest.getTracked().indexOf('m1')`) === -1, '最早钉的 m1 被挤掉');
  // 取消追踪
  C(`Quest.toggleTrack('d1')`);
  A(C(`Quest.getTracked().indexOf('d1')`) === -1, '取消追踪后从列表移除');
  // 追踪的任务交完后自动撤下
  C(`for(let i=0;i<200;i++) Quest.reportType('kill', 1, { areaId: 'corrupted-forest' })`);
  const rd2 = await C(`Quest.completeQuest('d1')`);
  A(rd2 && rd2.ok, '交完被追踪的日常任务');
  C(`Quest.toggleTrack('d1')`); // 重新钉上（已完成）
  C(`UI.renderQuestTracker()`);
  A(qtHtml().indexOf('每日巡守·一') === -1, '已完成的任务不会出现在追踪栏');

  /* ---------- 状态角标 + 放弃任务 ---------- */
  await hardReset();
  // 面板默认分类是新手（第一个非空分类），角标断言显式切到主线分类
  C(`UI.renderQuestPanel('main')`);
  const panel = () => C(`document.getElementById('quest-body').innerHTML`);
  A(panel().indexOf('q-mark--accept') !== -1, '未接取的任务显示可接角标 !');
  // 打够进度让它变成可交
  C(`Quest.acceptQuest('m1'); for(let i=0;i<30;i++) Quest.reportType('kill', 1, { areaId: 'corrupted-forest' }); UI.renderQuestPanel('main')`);
  A(panel().indexOf('q-mark--submit') !== -1, '进度满了的任务显示可交角标 ?');

  // 放弃：进度清零 + 回到未接取 + 从追踪栏撤下
  C(`Quest.toggleTrack('m1')`);
  const ab = C(`Quest.abandonQuest('m1')`);
  A(ab && ab.ok, '放弃已接取的任务成功（' + (ab.name || '') + '）');
  A(C(`Quest.getQuests().find(q=>q.id==='m1').progress`) === 0, '放弃后进度清零');
  A(C(`Quest.getQuests().find(q=>q.id==='m1').accepted`) === false, '放弃后回到未接取状态');
  A(C(`Quest.getTracked().indexOf('m1')`) === -1, '放弃的任务自动从追踪栏撤下');
  // 新手任务不能放弃（只能跳过引导）
  const abT = C(`Quest.abandonQuest('g1')`);
  A(abT && abT.error, '新手任务不能放弃（提示：' + (abT.error || '') + '）');

  /* ---------- 提交幂等（经济系统底线）：连点 / 刷新都不能重复领奖 ----------
   * 奖励走云端 RPC 累加（add_material），重入一次就多给一份材料，所以这里必须卡死。 */
  await hardReset();
  C(`Quest.acceptQuest('m1')`);
  C(`for(let i=0;i<30;i++) Quest.reportType('kill', 1, { areaId: 'corrupted-forest' })`);
  const matBefore = C(`Materials.getQuantity('进化素材')`);
  // 连点 5 次：不等上一次返回就发下一次（模拟玩家狂点，或网络慢时 UI 重复触发）
  const burst = await C(`Promise.all([1,2,3,4,5].map(()=>Quest.completeQuest('m1')))`);
  const okCount = burst.filter(r => r && r.ok).length;
  A(okCount === 1, '连点 5 次只有 1 次提交成功（实际 ' + okCount + ' 次）');
  A(burst.filter(r => r && r.error).length === 4, '其余 4 次被拦下（正在提交中 / 已交过）');
  const gained = C(`Materials.getQuantity('进化素材')`) - matBefore;
  A(gained === 2, '奖励只发了 1 份：m1 给进化素材×2，实际 +' + gained);

  // 并发写不能互相覆盖：交任务的同时挂机在疯狂上报击杀（quest_progress 是整行 JSON 覆盖写）
  await C(`(async()=>{ Quest.acceptQuest('d2');
    for(let i=0;i<200;i++) Quest.reportType('kill',1,{areaId:'corrupted-forest'});
    await Quest.completeQuest('d2'); })()`);
  await reload();
  A(C(`Quest.getQuests().find(q=>q.id==='m1').finished`) === true, '并发上报下，先交的 m1 没被后写的进度覆盖');
  A(C(`Quest.getQuests().find(q=>q.id==='d2').finished`) === true, '同一轮并发里交的 d2 也没丢');

  // 模拟刷新页面：交过的任务必须仍是「已交」，且不能再领一份
  const again = await C(`Quest.completeQuest('m1')`);
  A(again && again.error, '刷新页面后不能重复交同一个任务（提示：' + (again.error || '') + '）');
  const gained2 = C(`Materials.getQuantity('进化素材')`) - matBefore;
  A(gained2 === 2, '刷新后也没有多发出材料（实际 +' + gained2 + '）');

  /* ---------- 宠物专属任务（2026-08-31：pe 分类，8 宠 × 3 养成链） ---------- */
  // 固定等级/经验，保证解锁断言可控（前面交 g1 给固定经验 300 会升级）
  C(`(function(){const p=Pet.getActivePet();p.level=1;p.exp=0;return true})()`);
  // 固定经验档位：questExpOf 按分类给固定值，不再按等级比例
  const expTab = C('JSON.stringify({t:Quest.questExpOf({category:"tutorial"}),m:Quest.questExpOf({category:"main"}),d:Quest.questExpOf({category:"daily"}),a:Quest.questExpOf({category:"achieve"}),p:Quest.questExpOf({category:"pet"})})');
  A(expTab === '{"t":300,"m":1000,"d":100,"a":3000,"p":600}', `任务经验固定值档位正确（${expTab}）`);

  // 解锁按等级：腐噜兽 Lv1 可做，血狐需 Lv7
  A(C(`Quest.getQuests().find(q=>q.id==='pe2').unlocked`) === true, 'pe2（腐噜兽试炼）Lv1 已解锁');
  A(C(`Quest.getQuests().find(q=>q.id==='pe5').unlocked`) === false, 'pe5（血狐试炼）Lv1 未解锁（需 Lv7）');

  // 孵化任务「已拥有该宠」视为完成：出战是腐噜兽 → pe1 完成，pe4（血狐）未完成
  A(C(`Quest.getQuests().find(q=>q.id==='pe1').done`) === true, 'pe1（孵化·腐噜兽）已拥有腐噜兽 → 1/1 完成');
  A(C(`Quest.getQuests().find(q=>q.id==='pe4').done`) === false, 'pe4（孵化·血狐）没有血狐 → 未完成');

  // petName 过滤：带腐噜兽击杀才涨 pe2，带血狐击杀不涨
  C(`Quest.reportType('kill', 1, { petName: '腐噜兽' })`);
  C(`Quest.reportType('kill', 1, { petName: '血狐' })`);
  A(C(`Quest.getQuests().find(q=>q.id==='pe2').progress`) === 1, '带腐噜兽击杀才涨 pe2，带血狐击杀不涨（进度 1）');
  // 不带 petName 的上报（旧调用）不影响宠物专属任务
  C(`Quest.reportType('kill', 1, {})`);
  A(C(`Quest.getQuests().find(q=>q.id==='pe2').progress`) === 1, '不带 petName 的上报不计入宠物专属任务');

  // 完整走一条：带腐噜兽打满 50 只 → 交 pe2 → 固定经验 600 + 材料
  C(`Quest.acceptQuest('pe2')`);
  C(`for(let i=0;i<49;i++) Quest.reportType('kill', 1, { petName: '腐噜兽' })`);
  const pe2r = await C(`Quest.completeQuest('pe2')`);
  A(pe2r && pe2r.ok, '提交 pe2（腐噜兽试炼）成功');
  A(pe2r && pe2r.exp === 600, `pe2 完成给固定经验 600（实际 ${pe2r && pe2r.exp}）`);
  A(pe2r && (pe2r.rewards || []).join('').indexOf('经验 +600') >= 0, 'pe2 奖励列表含「经验 +600」');
  A(C(`Quest.getQuests().find(q=>q.id==='pe2').finished`) === true, 'pe2 已标记完成');

  console.log('ALL QUEST TESTS PASSED');
})();
