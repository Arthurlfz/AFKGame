// vtest_material_info.js —— 材料元数据完整性（2026-09-14 用户拍板「以后加道具怎么办」的答案）
// 守住的东西：**凡是能产出或消耗材料的地方，那个名字必须在 Config.materialInfo 里登记过**。
//   这样"以后加一种新材料"就不会漏：漏了 = 这条测试红 = 提交不过。
//   等价于"给物品打 tag"，但只在唯一一处登记（Config.materialInfo / materialInfoGroups），
//   不散在 items / craft / 掉落表 / 商店 payload 好几份名单里。
// 怎么加新材料：
//   ① 掉落表 / craft / items 等处照旧加；② 回 config.js 的 Config.materialInfo 加一条 { group: ... }；
//   ③ 如果是**新开一种产出方式**（比如新的档位表），把它的读法补到下面 collectSources() 里。
// 已知盲区（测试看不到，靠人工）：魔石商店的商品在云端 products 表，其 payload.materials 不在客户端配置里。
const fs = require('fs'), vm = require('vm');
const VTF = require('./vtest_files');
const ctx = { console, setTimeout, clearTimeout, JSON, Object, Array, String, Number, Math, Date, Boolean,
  navigator: {}, localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() { } } };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['../js/core/config.js', '../js/tower/tower-config.js', '../js/trial/trial-config.js']) VTF.load(ctx, f);
const C = ctx.Config;
let failures = 0; const A = (ok, msg) => { if (ok) console.log('PASS: ' + msg); else { console.error('FAIL: ' + msg); failures++; } };

/* ---------- 收集：所有"会出现材料名"的地方 ---------- */
const SKIP = { '区域材料': 1, '宠物蛋': 1 };  // 占位键 / 有独立账（pet_egg 表）
const src = {};                                // name -> 第一个出处（报错时给人指路）
const add = (n, where) => { if (typeof n === 'string' && n.trim() && !SKIP[n] && !src[n]) src[n] = where; };
const itemName = idOrName => {                 // 有的字段存的是 items 的 id（如 'synth_stone'），要翻成名字
  if (typeof idOrName !== 'string') return null;
  const hit = (C.items || []).find(i => i.id === idOrName);
  return hit ? hit.name : idOrName;
};
const addRef = (v, where) => add(itemName(v), where);
const addWeights = (o, where) => {             // 只认"权重表"：值必须是数字，避免把 enabled/items/note 当材料
  if (!o || typeof o !== 'object') return;
  Object.keys(o).forEach(k => { if (typeof o[k] === 'number') add(k, where); });
};
const addNames = (arr, where) => (arr || []).forEach(x => x && add(x.name, where));

/* 产出与消耗材料的全部地方（新开产出方式时补这里） */
addNames(C.items, 'items 元数据');
addNames(C.trade && C.trade.materials, 'trade 白名单');
Object.keys(C.craft || {}).forEach(k => addRef(C.craft[k] && C.craft[k].name, 'craft.' + k));
Object.keys(C.drop.materialWeightsByTier || {}).forEach(t => addWeights(C.drop.materialWeightsByTier[t], '地图掉落表 图' + t));
Object.keys(C.drop.areaMaterials || {}).forEach(k => add(C.drop.areaMaterials[k] && C.drop.areaMaterials[k].name, '区域材料表'));
addWeights(C.drop.evoMaterialWeights, '进化素材档位');
addWeights(C.drop.lootTiers, '掉落播报档位');
add(C.drop.phoenixName, 'phoenixName');
add(C.drop.synthesizeName, 'synthesizeName');
((C.pet && C.pet.evolution && C.pet.evolution.stages) || []).forEach(s => { add(s.material, '进化需求 stage' + s.stage); add(s.extraMaterial, '进化需求 stage' + s.stage); });
addRef(C.pet && C.pet.evolution && C.pet.evolution.materialName, 'evolution.materialName');
addNames(C.pet && C.pet.evolution && C.pet.evolution.boostItems, '进化加成道具');
add(C.pet && C.pet.expPool && C.pet.expPool.material, '满级经验池');
addRef(C.nirvana && C.nirvana.defaultItem, '涅槃默认道具');
add(C.nirvana && C.nirvana.crystalBonus && C.nirvana.crystalBonus.material, '涅槃加成道具');
addRef(C.synthesize && C.synthesize.defaultItem, '合成默认道具');
add(C.synthesize && C.synthesize.material, '合成需求');
addRef(C.synthesize && C.synthesize.mutation && C.synthesize.mutation.material, '合成·变异道具');
addNames(C.tower && C.tower.affix && C.tower.affix.items, '通天塔·腐印');
addRef(C.tower && C.tower.resetCardName, '通天塔重置卡');
(C.tower && C.tower.materialBands || []).forEach(b => addWeights(b.weights, '通天塔材料池'));
(C.tower && C.tower.floorTiers || []).forEach(t => addNames(t.items, '通天塔档位'));
addNames(C.tower && C.tower.consolation, '通天塔保底');
addNames(C.towerDrops && C.towerDrops.items, 'towerDrops');
add(C.resourceTrials && C.resourceTrials.ticketName, '副本门票');
(C.resourceTrials && C.resourceTrials.routes || []).forEach(r => (r.floorTiers || []).forEach(t => addNames(t.items, '副本·' + r.name + '档位')));
Object.keys(C.soulCast || {}).forEach(k => { const v = C.soulCast[k]; if (v && typeof v === 'object') { addRef(v.material, 'soulCast.' + k); addRef(v.materialName, 'soulCast.' + k); } });
(C.drop.quests || []).forEach(q => {
  addWeights(q.reward, '任务奖励 ' + (q.id || ''));
  (q.matList || []).forEach(m => add(m, '任务需求 ' + (q.id || '')));
  add(q.matName, '任务需求 ' + (q.id || ''));
  addWeights(q.cost, '任务花费 ' + (q.id || ''));
});

/* ---------- ① 每个名字都登记过 ---------- */
const info = C.materialInfo || {};
const groups = C.materialInfoGroups || [];
const unregistered = Object.keys(src).filter(n => !info[n]);
A(unregistered.length === 0,
  '所有产出/消耗的材料都登记在 Config.materialInfo（' + Object.keys(src).length + ' 个名字全过）'
  + (unregistered.length ? '｜漏了：' + unregistered.map(n => n + '(见 ' + src[n] + ')').join(' / ') : ''));

/* ---------- ② 登记表里的 group 必须是合法分区 ---------- */
const badGroup = Object.keys(info).filter(n => !groups.some(g => g.id === (info[n] || {}).group));
A(badGroup.length === 0, '每条登记都指向一个存在的分区' + (badGroup.length ? '｜有问题：' + badGroup.join(' / ') : ''));

/* ---------- ③ 分区表本身要能用（id 不重复、label 不空） ---------- */
const ids = groups.map(g => g.id);
A(new Set(ids).size === ids.length && ids.length >= 3, '分区 id 不重复且至少 3 组（当前 ' + ids.length + ' 组）');
A(groups.every(g => g.label && String(g.label).trim()), '每个分区都有中文名');

/* ---------- ④ 每个分区都得有东西（防"空分区"永远看不见） ---------- */
const empty = groups.filter(g => !Object.keys(info).some(n => (info[n] || {}).group === g.id));
A(empty.length === 0, '没有空分区' + (empty.length ? '｜空的：' + empty.map(g => g.label).join(' / ') : ''));

/* ---------- ⑤ 规模自检（材料数掉一半多半是登记表被误删） ---------- */
A(Object.keys(info).length >= 40, '登记材料数 ' + Object.keys(info).length + ' 条（>=40，掉太多说明表被误删）');

console.log(failures ? 'MATERIAL INFO TESTS FAILED: ' + failures : 'ALL MATERIAL INFO TESTS PASSED');
process.exit(failures ? 1 : 0);
