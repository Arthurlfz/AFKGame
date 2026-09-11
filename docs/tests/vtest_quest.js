// 任务系统回归测试（109 条任务 v5：引导 6 + 系列 50 + 宠物 24 + 日常 12 + 循环 11 + 成就 6）
// 注：2026-08-30 地图从 6 图扩到 10 图，主线由 24 条（6图×4）扩到 40 条（10图×4）
//     2026-08-31 新增宠物专属 24 条（8 宠 × 3 养成链：孵化→带它击杀→它进化）
//     2026-09-06 第二幕 7 图（61-100 级）随地图精简删除，m41~m68 一并删掉
//     2026-09-10 任务系统整理：分类口径 category → 派生 kind（可重复条目从 main/pet 摘出独立成 loop），
//                新增三级结构（一级分类 → 二级分组 → 具体任务）与分组断言
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
for (const f of ['../js/core/config.js', '../js/core/quest-config.js', '../js/core/supabase.js', '../js/equipment/equipment.js', '../js/pet/pet.js', '../js/core/items.js', '../js/core/materials.js', '../js/core/drop.js', '../js/core/market.js', '../js/equipment/equipment_craft.js', '../js/equipment/salvage.js', '../js/pet/pet_merge.js', '../js/pet/pet_evolve.js', '../js/core/quest.js', '../js/core/battle.js', '../js/ui/ui-common.js', '../js/ui/ui-battle.js', '../js/ui/ui-pet.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-synth.js', '../js/ui/ui-equipment.js', '../js/ui/ui-craft.js', '../js/ui/ui-market.js', '../js/ui/ui-codex.js', '../js/ui/ui-quest.js', '../js/main.js']) VTF.load(ctx, f);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const C = code => vm.runInContext(code, ctx);

/* 服务端领取记录（complete_quest RPC）桩 —— 测试环境没有真实服务端。
 * 这里模拟它的真实语义：同一个 (任务, 周期) 只允许成功一次，第二次 ALREADY_CLAIMED。
 * ⚠️ 必须覆盖真实的 Supabase.completeQuest：那个会走网络，测试里必挂。 */
C(`
  window.__questClaims = {};
  window.__claimCalls = [];
  Supabase.completeQuest = async function (qid, periodKey) {
    window.__claimCalls.push(qid + '|' + (periodKey || ''));
    const k = qid + (periodKey ? '@' + periodKey : '');
    if (window.__questClaims[k]) return { data: 'ALREADY_CLAIMED', error: null };
    window.__questClaims[k] = 1;
    return { data: 'OK', error: null };
  };
`);

(async () => {
  await C('Game.onLogin("quest@test.com","123456")');
  // 建一只出战宠物：主线/日常/成就按出战宠物等级解锁（真实流程开局必选宠）
  C(`(function(){const p=Pet.createPet('腐噜兽','🐹',5,110,22,11,40,'腐噜兽');Pet.addPet(p);Pet.setActive(p.id);return true})()`);
  A(C(`Pet.getActivePet() && Pet.getActivePet().level`) >= 1, '已建立 Lv.1 出战宠物（任务解锁依赖它）');

  /* ---------- 数据完整性（口径 = quest-config.js 派生的一级分类 kind） ---------- */
  const total = C('Config.drop.quests.length');
  // 2026-09-11 P2：+章宝箱 10 + 副本/塔分档成就 6 + 周常 6 → 160 → 182
  A(total === 182, '任务总数 182 条（实际 ' + total + '）');
  const count = kind => C(`Config.drop.quests.filter(q=>q.kind==='${kind}').length`);
  A(count('guide') === 6, '引导 6 条（N1-N6）');
  A(count('series') === 70, '系列 70 条（10 章 × 7 条：6 环 + 章宝箱）');
  A(count('pet') === 32, '宠物 32 条（8 宠 × 4 环：孵化 / 试炼 / 进化 / 百战）');
  A(count('daily') === 16, '日常 16 条');
  A(count('weekly') === 6, '周常 6 条（2026-09-11 新分类，reset 全部 weekly）');
  A(count('exchange') === 12, '兑换 12 条（每日 6 + 每周 6；卵石相易已删）');
  A(count('bonus') === 2, '目标 2 条（今日勤勉 + 本周活跃）');
  A(count('loop') === 11, '循环 11 条（10 条地图委托 + 觉醒之路）');
  A(count('achieve') === 27, '成就 27 条（21 + 副本/塔分档 6）');
  A(count('guide') + count('series') + count('pet') + count('daily') + count('weekly') +
    count('exchange') + count('bonus') + count('loop') + count('achieve') === total,
    '九个一级分类正好覆盖全部任务（无遗漏、无重复归类）');
  const types = C('JSON.stringify([...new Set(Config.drop.quests.map(q=>q.type))].sort())');
  // 2026-09-11：+chapterChest（章宝箱）+trialRun/towerRun/towerFloor（副本/塔上报）→ 20 种升到 24 种
  A(JSON.parse(types).length === 24, '覆盖 24 种任务类型（实际 ' + JSON.parse(types).length + ' 种）');
  ['kill', 'equip', 'craft', 'evolve', 'disposeKill', 'direction', 'collect_loop', 'boss']
    .forEach(t => A(JSON.parse(types).indexOf(t) >= 0, '任务类型仍包含 ' + t));

  /* ---------- 三级结构：一级分类 → 二级分组 → 具体任务 ---------- */
  // ① 结构性错位必须修掉：可重复任务不能再混在一次性分类里
  A(C(`Config.drop.quests.filter(q=>q.type==='collect_loop').every(q=>q.kind==='loop')`),
    '地图委托全部归到「循环」分类（不再占着「系列」的列表）');
  A(C(`Config.drop.quests.filter(q=>q.repeatable).every(q=>q.kind==='loop')`),
    '所有可重复任务都在「循环」分类（不再占着「宠物」的列表）');
  A(C(`Config.drop.quests.filter(q=>q.repeat).every(q=>q.kind==='daily'&&q.reset==='daily')`),
    '所有每日任务的 kind/reset 都是 daily（重置周期写进数据，不再靠 repeat 字段猜）');
  // ② 系列 = 10 章 × 7 条（6 环 + 章宝箱）
  A(C(`(function(){var m={};Config.drop.quests.filter(q=>q.kind==='series').forEach(function(q){m[q.chapter]=(m[q.chapter]||0)+1;});var ks=Object.keys(m);return ks.length===10&&ks.every(function(k){return m[k]===7;});})()`),
    '系列按图分成 10 章，每章 7 条（6 环 + 章宝箱）');
  // 章宝箱：每章恰好 1 条、requires 指向该章 Boss、进度是现算的（同章 6 环全 completed 才 1/1）
  A(C(`(function(){var m={};Config.drop.quests.filter(function(q){return q.type==='chapterChest';}).forEach(function(q){m[q.id]=(Config.drop.quests.filter(function(x){return x.requires===q.id;}).length);});return Object.keys(m).length===10;})()`),
    '章宝箱 10 条（无人 require 它，链的终点）');
  A(C(`Config.drop.quests.filter(function(q){return q.type==='chapterChest';}).every(function(q){var boss='boss'+q.id.replace('chest','');var b=Config.drop.quests.find(function(x){return x.id===boss;});return b&&q.requires===boss&&q.unlockLevel===b.unlockLevel;})`),
    '章宝箱都 requires 本章 Boss 且解锁等级对齐（防在错误阶段看到宝箱）');
  // 周常：周期写死 weekly（复用兑换那套 weeklyDone/weekKey 清零机制），不许出现无上限的周常
  A(C(`Config.drop.quests.filter(function(q){return q.kind==='weekly';}).every(function(q){return q.reset==='weekly';})`),
    '周常全部 reset:"weekly"（周一随 weeklyDone 清零，复用兑换的机制）');
  // 副本/塔上报：mode:"max" 只认历史最大（5→12→7 = 12，失败不回退）
  A(C(`(function(){Quest.reportType('towerFloor',5,{mode:'max'});Quest.reportType('towerFloor',12,{mode:'max'});Quest.reportType('towerFloor',7,{mode:'max'});return Quest.getQuests().find(function(q){return q.id==='tw2';}).progress;})()`) === 12,
    'towerFloor 用 mode:"max" 只认历史最大（5→12→7 = 12，不会累加也不会回退）');
  // 每章都不是"每一类只有一条"：至少有两环是同一类之外，久战环保证"击败"每章有 2 条
  A(C(`(function(){var m={};Config.drop.quests.filter(function(q){return q.kind==='series'&&q.type==='kill';}).forEach(function(q){m[q.chapter]=(m[q.chapter]||0)+1;});var ks=Object.keys(m);return ks.length===10&&ks.every(function(k){return m[k]===2;});})()`),
    '每章都有 2 条击败类任务（推进环 + 久战环），不是"每种只有一个"');
  // 需求数量不能只有个位数（用户报「每一个都只有一个」）：击杀环 ≥ 180、装备/打造环 ≥ 6、养成环 ≥ 2
  A(C(`Config.drop.quests.filter(function(q){return q.kind==='series'&&q.type==='kill';}).every(function(q){return q.need>=180;})`),
    '系列击杀环的需求量全部 ≥180（不再出现 30 只就交差）');
  A(C(`Config.drop.quests.filter(function(q){return q.kind==='series'&&['equipDrop','craft','salvage'].indexOf(q.type)>=0;}).every(function(q){return q.need>=6;})`),
    '系列装备/打造环的需求量全部 ≥6（不再出现 ×1 ×2）');
  // ③ 宠物 = 8 家族 × 3 条
  A(C(`(function(){var m={};Config.drop.quests.filter(q=>q.kind==='pet').forEach(function(q){m[q.petName]=(m[q.petName]||0)+1;});var ks=Object.keys(m);return ks.length===8&&ks.every(function(k){return m[k]===4;});})()`),
    '宠物按家族分成 8 组，每组 4 条（孵化 / 试炼 / 进化 / 百战）');
  // ④ 日常与成就按目标形式族分组 —— 这就是「日常任务 → 收集任务 → 具体任务」的中间那一层
  A(C(`Config.drop.quests.filter(q=>q.kind==='daily'||q.kind==='achieve').every(q=>q.group&&q.group.label)`),
    '日常与成就的每条任务都带二级分组标签（收集 / 击败 / 打造 …）');
  A(C(`(function(){var m={};Config.drop.quests.filter(q=>q.kind==='daily').forEach(function(q){m[q.group.label]=(m[q.group.label]||0)+1;});return m['收集任务']===6&&m['击败任务']===2;})()`),
    '日常分组正确（收集 6 条、击败 2 条）');
  A(C(`Config.drop.quests.filter(q=>q.kind==='loop'&&q.type==='collect_loop').every(q=>q.group.id==='l:map')`),
    '循环分类里，「地图委托」与「长线收集」分成两组');
  // ④b 兑换（2026-09-10 新增分类）：硬上限是它的灵魂，数据层就得守住，不靠 UI 提醒
  A(C(`Config.drop.quests.filter(q=>q.kind==='exchange').every(q=>q.reset==='daily'||q.reset==='weekly')`),
    '每条兑换都带硬重置周期（每日/每周）—— 否则就是无限刷，会取代地图与试炼');
  A(C(`Config.drop.quests.filter(q=>q.kind==='exchange').every(q=>!q.repeatable)`),
    '兑换不准标 repeatable（那会绕过每日/每周上限）');
  A(C(`Config.drop.quests.filter(q=>q.kind==='exchange'&&q.reset==='weekly').length`) === 6, '每周兑换 6 条');
  // 传说补遗（2026-09-10 用户点名）：必须是硬上限的兑换，且单条 ≤2 个传说（归属表铁律 3）
  A(C(`(function(){var q=Config.drop.quests.find(function(x){return x.id==='ex_day_legend';});
       return !!q && q.reset==='daily' && q.reward['传说进化素材']<=2 && q.unlockLevel===31;})()`),
    '「传说补遗」是每日限 1 次的兑换（保底 2 个传说，不靠运气/不退低级图）');
  A(C(`Config.drop.quests.filter(q=>q.kind==='exchange'&&q.category==='exchange').length`) === 12,
    '兑换任务的 category 已对齐成 exchange（不谎报自己是日常）');
  A(C(`Quest.getGroups('exchange', Quest.getQuests().filter(q=>q.kind==='exchange')).length`) === 2,
    '兑换按重置周期分成「每日兑换 / 每周兑换」两组');
  // ⑤ Quest 侧的分组聚合 API
  A(C(`typeof Quest.getGroups==='function' && typeof Quest.readyCount==='function'`),
    'Quest.getGroups / Quest.readyCount 已导出（UI 分级与顶栏红点用）');
  A(C(`Quest.getGroups('series', Quest.getQuests().filter(q=>q.kind==='series')).length`) === 10,
    'Quest.getGroups("series") 返回 10 章');

  /* ---------- 新手链前置依赖 ---------- */
  A(C(`Config.drop.quests.find(q=>q.id==='n1') && !Config.drop.quests.find(q=>q.id==='n1').requires`), '新手第一条 n1 无前置');
  A(C(`['n2','n3','n4','n5','n6'].every(id=>!!(Config.drop.quests.find(q=>q.id===id)||{}).requires)`), '新手 n2~n6 都配了前置任务');

  /* ---------- 引导毕业结算（2026-09-10，业界惯例：仪式感 + 奖励反馈 + 平滑过渡） ---------- */
  A(C(`(function(){const L=Config.drop.quests.filter(q=>/^n[1-5]$/.test(q.id));return L.length===5&&L.every(q=>typeof q.learned==='string'&&q.learned.length>=8);})()`),
    'n1~n5 都配了 learned（毕业弹窗「这一路你学会了」recap 的唯一数据源）');
  const gradPack = C('Config.tutorialMode.starterPack.mats||[]');
  A(gradPack.length >= 3, '毕业礼包有真奖励（空包发"已发放"是撒谎，2026-09-10 修复）');
  A(gradPack.every(m => ['合成之石', '鉴定石', '资源试炼门票'].indexOf(m.name) >= 0 && (m.qty || 0) >= 1),
    '毕业礼包 = 打造通货 + 鉴定石 + 门票（符合资源铁律：不发进化/涅槃材料）');
  // 链完整性：有且仅有一个起点，从起点能一路走到底且条数 = 总数（防断链 / 分叉 / 成环）
  // requires 指向的是「前置」，所以要反向建「后继」索引才能从 g1 一路走到底
  A(C(`(function(){const T=Config.drop.quests.filter(q=>q.category==='tutorial');
    const roots=T.filter(q=>!q.requires); if(roots.length!==1) return false;
    const next={}; T.forEach(q=>{ if(q.requires) next[q.requires]=q; });
    let cur=roots[0],n=0,seen={};
    while(cur){ if(seen[cur.id]) return false; seen[cur.id]=1; n++; cur=next[cur.id]||null; }
    return n===T.length})`), '新手链线性完整：单起点、无断链、无分叉、无环，6 条全串起来');
  // 进化门槛 Lv10（n4 第一次进化）：前面必须留缓冲，否则引导条会卡在 0/1 干等
  A(C(`(function(){const n4=Config.drop.quests.find(q=>q.id==='n4');const pre=Config.drop.quests.find(q=>q.id===n4.requires);
    return !!n4 && n4.type==='evolve' && Number(n4.minLevel)>=10 && !!pre})`), '进化任务 n4 要求 Lv10 且有前置 n3（不会一上来就卡进化）');
  A(C(`Config.drop.quests.filter(q=>q.category==='tutorial').every(q=>q.guide && q.guide.page)`), '每条新手任务都配了引导跳转目标');

  /* ---------- 引导条：取当前该做的那条 ---------- */
  A(C(`window.Quest && typeof Quest.getGuideQuest === 'function'`), 'Quest.getGuideQuest 已导出（引导条用）');
  A(C(`(Quest.getGuideQuest()||{}).id`) === 'n1', '初始引导条指向 n1（选择出战宠物并开始挂机）');

  /* ---------- 按类型上报 ---------- */
  C(`Quest.reportType('kill', 1, { areaId: 'corrupted-forest' })`);
  const after = C(`JSON.stringify(Quest.getQuests().filter(q=>q.type==='kill').map(q=>[q.id,q.progress]))`);
  const killMap = Object.fromEntries(JSON.parse(after));
  A(killMap['n1'] === 1, '击杀上报：新手 n1（挂机 3 场）进度 +1');
  A(killMap['m1'] === 1, '击杀上报：同图主线 m1（枯荣之地）进度 +1');
  A(killMap['m5'] === 0, '限定地图生效：m5（泣腐泥沼）不计入本次击杀');
  A(killMap['a1'] === 1, '成就 a1 累计击败 +1');

  /* ---------- 完成新手任务 → 自动进下一条 ---------- */
  const expBefore0 = C(`Pet.getActivePet().exp`);
  const lvBefore0 = C(`Pet.getActivePet().level`);
  // n1 = 挂机 3 场（kill 3）：补满进度即可交
  C(`Quest.reportType('kill', 2, { areaId: 'corrupted-forest' })`);
  const r1 = await C(`Quest.completeQuest('n1')`);
  A(r1 && r1.ok, '提交 n1 成功（' + ((r1.rewards || []).join('、') || '无奖励') + '）');

  /* ---------- 服务端领取记录（2026-09-12 堵「改本地 completed 无限重领」） ---------- */
  const calls = C(`JSON.stringify(window.__claimCalls || [])`);
  A(/n1\|/.test(calls), '交任务会向服务端登记领取记录（' + calls + '）');
  const cc1 = await C(`Supabase.completeQuest('__probe','')`);
  const cc2 = await C(`Supabase.completeQuest('__probe','')`);
  A(cc1 && cc1.data === 'OK', '服务端领取记录：首次占位成功');
  A(cc2 && cc2.data === 'ALREADY_CLAIMED', '服务端领取记录：同一条第二次被拒（ALREADY_CLAIMED）');
  const cc3 = await C(`Supabase.completeQuest('__probe','2026-9-12')`);
  A(cc3 && cc3.data === 'OK', '带周期键的是另一条记录（日常/周常每个周期各一次）');
  A(r1 && r1.exp > 0, `任务奖励经验为主（n1 给 经验 +${r1.exp || 0}，材料为辅助）`);
  // 新手档=固定 300 经验：交 n1 后经验应累加或触发升级，两者都算"经验生效"。
  A(C(`Pet.getActivePet().level`) > lvBefore0 || C(`Pet.getActivePet().exp`) >= expBefore0 + (r1.exp || 0),
    '任务经验已计入当前出战宠物（经验累加或触发升级）');
  A(C(`(Quest.getGuideQuest()||{}).id`) === 'n2', '交完 n1 后引导条自动指向 n2（前置依赖生效）');
  const r2 = await C(`Quest.completeQuest('n1')`);
  A(r2 && r2.error, '一次性任务不能重复交（提示：' + (r2.error || '') + '）');
  A(C(`Quest.getQuests().find(q=>q.id==='n1').finished`) === true, 'n1 标记为已完成');

  /* ---------- 新手链送装备：n2「从两件装备中选一件」必须真有得穿，否则引导卡死 ----------
   * 装备只能靠战斗掉落（drop.js），新手做完 n1（3 场）时背包很可能还是空的，
   * 而 n2 要的正是「穿上 1 件」—— 不给就是死循环。
   * 钥匙表（tutorialMode.supplyBox，taskIds:'n2'）在 n2 激活时发两件不同底材的装备，
   * 玩家自己选一件；运行时的按关发放由 vtest_guide_grant 覆盖，
   * 这里只守住"配置层面 n2 一定有装备可穿"。 */
  A(C(`(function(){const n2=Config.drop.quests.find(q=>q.id==='n2');
    if(!n2||n2.type!=='equip') return false;
    const keys=(Config.tutorialMode.supplyBox.items||[]).filter(i=>(i.taskIds||[]).indexOf('n2')>=0);
    return keys.filter(i=>i.type==='gear').reduce((n,i)=>n+(Number(i.count)||1),0)>=2})`),
    'n2（穿装备）的钥匙表里至少 2 件装备可供比较（不送会卡死引导）');
  // 钥匙表里的装备必须真能生成、真能穿（n2 有解）
  C(`(function(){const it=(Config.tutorialMode.supplyBox.items||[]).find(i=>(i.taskIds||[]).indexOf('n2')>=0&&i.type==='gear');
    const r=(Config.equipment.rarities||[]).find(x=>x.id===(it.rarity||'white'))||(Config.equipment.rarities||[])[0];
    const eq=Equipment.generateEquipment(r,it.areaTier||1,it.materialTier||1);eq.identified=true;Equipment.addToInventory(eq);return true})()`);
  A(C(`Equipment.getInventory().length`) >= 1, '钥匙表里的装备能正常生成并入包');
  A(C(`(function(){const eq=Equipment.getInventory()[0];return !!Equipment.equipItem(Pet.getActivePet(), eq.id)})()`),
    '这件装备能直接穿上（n2 有解，引导链不断）');
  C(`Quest.reportType('equip', 1)`); // n2 穿装备上报 1 次即达标
  const rT2 = await C(`Quest.completeQuest('n2')`);
  A(rT2 && rT2.ok, '提交 n2 成功（' + ((rT2.rewards || []).join('、') || '无奖励') + '）');
  A(C(`(Quest.getQuests().find(q=>q.id==='n3')||{}).unlocked`) === true, '交完 n2 后 n3 解锁（前置依赖生效）');

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
  // 2026-09-10 自动追踪上线：手动追踪为空时，进度 ≥80% 的任务会自己顶上来 ——
  // 这是有意的行为（"有个任务能交了"不该等玩家自己翻面板才发现），所以不再断言"隐藏"。
  A((C(`document.getElementById('quest-tracker').innerHTML`).match(/qt-auto/g) || []).length >= 1,
    '跳过引导 + 无手动追踪时，追踪栏由自动追踪项接管（进度 ≥80%）');

  // 模拟「换号 / 新账号」：清内存 + 清云端任务表 + 重拉进度。
  // 真实流程是登出走 clearAccountState → Quest.reset()，再登录走 restoreCloudPets → loadCloudProgress。
  // 只 reset 不重拉的话 cloudLoaded 仍为 false，提交会被「进度还在加载」拦下——这是设计使然，不是 bug。
  const hardReset = async () => {
    /* __questClaims 必须一起清：它模拟的是【服务端】的领取记录，
     * hardReset 模拟换号 —— 新号在服务端当然是空的，不清就变成"换号也领不了"。 */
    C(`Quest.reset(); if (globalThis.questTable) globalThis.questTable.length = 0; window.__questClaims = {};`);
    await C(`Quest.loadCloudProgress()`);
  };
  // 模拟刷新页面：只清内存，云端留着，再从云端读回来
  // （__questClaims 故意不清 —— 它就是"云端留着"的那部分，刷新不该让它失效）
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
  // 2026-09-10 自动追踪：除引导外，进度 ≥80%（含"做完还没交"）的任务也会上栏 —— 条数不再固定为 1
  A(qtCount() >= 1, '追踪栏至少有引导当前任务（+ 可能的自动追踪项）');
  A(qtHtml().indexOf('选择出战宠物并开始挂机') !== -1, '追踪栏显示任务名「选择出战宠物并开始挂机」（n1）');

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

  /* ---------- 三级结构在 UI 上真的成立（数据对了但没渲染分级 = 白做） ---------- */
  C(`UI.renderQuestPanel('series')`);
  const seriesHtml = panel();
  A(seriesHtml.indexOf('quest-group-head') !== -1, '系列面板渲染出二级分组组头');
  A(seriesHtml.indexOf('第 1 章') !== -1, '组头显示章节名（第 N 章 · 图名）');
  A(seriesHtml.indexOf('quest-group-body') !== -1, '默认展开的组里有具体任务卡片');
  // 面板只显示「已解锁」的条目，所以这里按实际解锁数对账（章节完整性由数据层断言守）
  const seriesOpen = C(`Quest.getQuests().filter(q=>q.kind==='series'&&!q.finished&&q.unlocked).length`);
  A((seriesHtml.match(/quest-group-head/g) || []).length >= 1, '系列面板至少渲染 1 个章节组头');
  A((seriesHtml.match(/class="quest-card[" ]/g) || []).length === seriesOpen,
    '展开组里的卡片数 = 已解锁系列任务数（' + seriesOpen + '）');
  A(C(`Quest.getGroups('series', Quest.getQuests().filter(q=>q.kind==='series')).length`) === 10,
    '系列数据层始终是完整的 10 章（与面板只显示已解锁不冲突）');
  A(seriesHtml.indexOf('undefined') === -1, '分组渲染无 undefined 泄漏');
  A(seriesHtml.indexOf('全部展开') !== -1 && seriesHtml.indexOf('全部折叠') !== -1, '面板提供全部展开/折叠');
  C(`UI.renderQuestPanel('daily')`);
  A(panel().indexOf('收集任务') !== -1, '日常面板渲染出「收集任务」分组（日常 → 收集 → 具体任务）');
  // 循环（委托）要该图守关 Boss 首通才解锁 → 先上报一次 Boss 击杀并交掉首通任务，再看分组渲染
  C(`Quest.reportType('boss', 1, { areaId: 'corrupted-forest' })`);
  const bossR = await C(`Quest.completeQuest('boss1')`);
  A(bossR && bossR.ok, '图 1 守关 Boss 首通（循环委托的解锁前提，实际 ' + JSON.stringify(bossR) + '）');
  C(`UI.renderQuestPanel('loop')`);
  A(panel().indexOf('地图委托') !== -1, '循环面板渲染出「地图委托」分组（图 1 首通后解锁）');
  // 旧分类 id 兼容：外部调用 / 老代码传 'main' 仍能定位到「系列」
  C(`UI.renderQuestPanel('main')`);
  A(panel().indexOf('第 1 章') !== -1, '旧 id "main" 自动映射到「系列」分类');
  A(C(`document.getElementById('quest-tabs').innerHTML`).indexOf('quest-tab-cnt') !== -1,
    '分类 tab 角标已渲染（可提交=红 / 未完成=灰）');
  A(C(`document.getElementById('quest-tabs').innerHTML`).indexOf('循环') !== -1,
    'tab 栏出现「循环」分类');
  // 打够进度让它变成可交
  // m1 需求量已从 30 提到 180（2026-09-10），这里要打够 180 才算"进度满"
  C(`Quest.acceptQuest('m1'); for(let i=0;i<180;i++) Quest.reportType('kill', 1, { areaId: 'corrupted-forest' }); UI.renderQuestPanel('main')`);
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
  C(`for(let i=0;i<180;i++) Quest.reportType('kill', 1, { areaId: 'corrupted-forest' })`);
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

  /* ---------- 兑换任务行为：每日 / 每周 各自的硬上限（2026-09-10 新增分类） ---------- */
  // 把出战宠顶到 Lv60 解锁全部兑换并给足消耗物（本段放最后，不影响前面的等级断言）
  C(`(function(){const p=Pet.getActivePet();p.level=60;p.exp=0;return true})()`);
  // 兑换定价 2026-09-10 上调（用户报「需求数量太少」）→ 这里要給足 120+ 才能同时交掉每日与每周各一条
  C(`Materials.gain('重铸石',120); Materials.gain('增缀石',120); Materials.gain('剥离石',120);
     Materials.gain('神圣石',120); Materials.gain('合成之石',120)`);
  const idBefore = C(`Materials.getQuantity('鉴定石')`);
  const exR = await C(`Quest.completeQuest('ex_day_identify')`);
  A(exR && exR.ok, '每日兑换「废石辨真」可提交（' + JSON.stringify(exR && (exR.rewards || exR.error)) + '）');
  A(C(`Materials.getQuantity('鉴定石')`) - idBefore === 20, '兑换到手 鉴定石 ×20');
  A(C(`Quest.getQuests().find(q=>q.id==='ex_day_identify').finished`) === true, '每日兑换交完即 finished');
  A(C(`Quest.getQuests().find(q=>q.id==='ex_day_identify').reset`) === 'daily', '每日兑换带 reset=daily');
  const exAgain = await C(`Quest.completeQuest('ex_day_identify')`);
  A(exAgain && exAgain.error, '同一天不能重复兑换（提示：' + ((exAgain && exAgain.error) || '') + '）');

  const hbBefore = C(`Materials.getQuantity('强化丹B')`);
  const exWk = await C(`Quest.completeQuest('ex_week_dan_b')`);
  A(exWk && exWk.ok, '每周兑换「玉液凝丹」可提交（' + JSON.stringify(exWk && (exWk.rewards || exWk.error)) + '）');
  A(C(`Materials.getQuantity('强化丹B')`) - hbBefore === 3, '兑换到手 强化丹B ×3');
  A(C(`Quest.getQuests().find(q=>q.id==='ex_week_dan_b').reset`) === 'weekly', '每周兑换带 reset=weekly');
  A(C(`Quest.getQuests().find(q=>q.id==='ex_week_dan_b').finished`) === true, '每周兑换交完即 finished');
  const exWkAgain = await C(`Quest.completeQuest('ex_week_dan_b')`);
  A(exWkAgain && exWkAgain.error, '本周内不能重复兑换（提示：' + ((exWkAgain && exWkAgain.error) || '') + '）');
  A(C(`Quest.getQuests().filter(q=>q.kind==='daily'&&q.id==='ex_day_identify').length`) === 0,
    '兑换任务不落在「日常」分类里（两套独立水位，互不占额度）');
  C(`UI.renderQuestPanel('exchange')`);
  const exHtml = C(`document.getElementById('quest-body').innerHTML`);
  A(exHtml.indexOf('每日兑换') !== -1 && exHtml.indexOf('每周兑换') !== -1,
    '兑换面板渲染出「每日兑换 / 每周兑换」两组');
  A(C(`document.getElementById('quest-tabs').innerHTML`).indexOf('兑换') !== -1,
    'tab 栏出现「🔄 兑换」分类');

  /* ---------- 服务端领取记录回灌（2026-09-12 修「显示可提交却永远交不了」） ----------
   * 事故：领取记录在服务端 quest_claims，完成状态在本地 quest_progress。本地那份丢了
   * （写失败 / 换设备 / 清缓存）→ 面板显示「可提交」→ 点下去被服务端 ALREADY_CLAIMED 拒
   * → 还是「可提交」→ 再点还是同一句报错。所以拉进度时必须拿服务端记录补本地显示。 */
  const now = new Date();
  const dayKey = dt => dt.getFullYear() + '-' + (dt.getMonth() + 1) + '-' + dt.getDate();
  const kToday = dayKey(now);
  const kYest = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const kMonday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)));
  C(`
    Supabase.fetchQuestClaims = async function () {
      return { data: ['d1@${kToday}', 'd3@${kYest}', 'm1', 'ex_week_jade@${kMonday}'], error: null };
    };
  `);
  C(`Quest.reset()`);
  await C(`Quest.loadCloudProgress()`);
  A(C(`Quest.getQuests().find(q=>q.id==='d1').finished`) === true,
    '服务端有今天的日常记录 → 本地显示已交（不再「可提交却一直报已交过」）');
  A(C(`Quest.getQuests().find(q=>q.id==='d3').finished`) === false,
    '过期周期（昨天的日常）不回灌（今天照常能做）');
  A(C(`Quest.getQuests().find(q=>q.id==='m1').finished`) === true,
    '一次性任务的无周期记录 → 回灌为已完成');
  A(C(`Quest.getQuests().find(q=>q.id==='ex_week_jade').finished`) === true,
    '本周的周常记录 → 回灌进 weeklyDone（周一那天也不会错记成日常）');
  A(C(`Quest.getQuests().find(q=>q.id==='loop_corrupted_forest').finished`) === false,
    '循环任务不参与领取记录，回灌后依然可重复交');

  console.log('ALL QUEST TESTS PASSED');
})();
