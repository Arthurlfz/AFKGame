// N1-N6 guide configuration contract.
const fs = require('fs'), vm = require('vm');
const ctx = { console }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/core/config.js', 'utf8'), ctx);
const C = code => vm.runInContext(code, ctx);
const A = (v, m) => { if (!v) { console.error('FAIL: ' + m); process.exit(1); } console.log('PASS: ' + m); };
const guide = C(`Config.drop.quests.filter(q => q.category === 'tutorial' && q.isGuide)`);
const box = C(`Config.tutorialMode.supplyBox.items`);
const ids = guide.map(q => q.id);
const keysOf = id => box.filter(i => (i.taskIds || []).includes(id));
const sum = (id, name) => keysOf(id).filter(i => i.type === 'mat' && i.name === name).reduce((n, i) => n + (i.qty || 0), 0);

A(guide.length === 6, 'N1-N6 has exactly six guide steps');
A(guide[0].id === 'n1' && !guide[0].requires, 'N1 is the chain start');
for (let i = 1; i < guide.length; i++) A(guide[i].requires === guide[i - 1].id, `${guide[i].id} follows ${guide[i - 1].id}`);
A(guide.map(q => q.id).join(',') === 'n1,n2,n3,n4,n5,n6', 'step order is stable');
A(keysOf('n2').filter(i => i.type === 'gear').reduce((n, i) => n + i.count, 0) >= 2, 'N2 supplies two comparison bases');
A(sum('n3', '重铸石') === 1, 'N3 supplies exactly one reforge stone');
A(sum('n4', '进化素材') === 1, 'N4 supplies one basic evolution material');
A(keysOf('n6').some(i => i.name === '资源试炼门票'), 'N6 supplies a basic trial ticket');
A(!box.some(i => /传说|精粹|凝魂|锁前|锁后|剥离|神圣/.test(i.name || '')), 'advanced currencies are not direct guide rewards');
A(!C(`Config.tutorialMode.expPacks.length`), 'tutorial has no hidden level 40/60 exp packs');
A(guide.every(q => !q.reward || !Object.keys(q.reward).length), 'guide rewards are key-driven, not duplicated on quests');
// 守门铁律：引导不许卡手。守关 Boss 是 200 场冷却 / 1-1600 概率的服务器权威稀有事件，
// 任何引导步骤都不许把「击败 Boss」当条件（2026-09-09：N5 曾因此卡死，改为图内击杀 5 只）。
A(!guide.some(q => q.type === 'boss' || (q.secondType || q.type) === 'boss'), 'no guide step requires a boss kill');
A(guide.every(q => q.type !== 'disposeBoss'), 'guide steps never use the boss combo type');
const n5 = guide.find(q => q.id === 'n5');
A(n5 && n5.type === 'disposeKill' && n5.secondNeed === 5 && n5.area === 'corrupted-forest', 'N5 asks for disposal plus five kills in map one');
// 门票必须有引导之外的稳定来源，否则试炼是一次性演示，循环断开
const loops = C(`Config.drop.quests.filter(q => q.type === 'collect_loop')`);
A(loops.length > 0 && loops.every(q => (q.reward || {})['资源试炼门票'] >= 1), 'every map commission grants a trial ticket');
console.log('\nALL N1-N6 GUIDE CHAIN TESTS PASSED');
