// vtest_mat_wiki.js —— 材料词条派生（2026-09-14，对齐流亡编年史的「用途 / 来源」）
// 守的是什么：**每个材料都真的能说出「怎么用」和「从哪来」**（派生不出来就是数据缺了口）。
//   用途/来源不是手写文案，而是从 Config 现场算的（craft.effect / items.effect / 进化需求 /
//   合成 / 涅槃 / 魂铸 / 塔 / 副本 / 任务 / 掉落表 / 区域材料 / 经验池）。
//   谁要是把某个产出表改了名、或新加了材料没登记，这里会立刻红。
const fs = require('fs'), vm = require('vm');
const VTF = require('./vtest_files');
const ctx = { console, setTimeout, clearTimeout, JSON, Object, Array, String, Number, Math, Date, Boolean,
  navigator: {}, localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() { } } };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['../js/core/config.js', '../js/tower/tower-config.js', '../js/trial/trial-config.js', '../js/core/mat-wiki.js']) VTF.load(ctx, f);
const C = ctx.Config, W = ctx.MatWiki;
let failures = 0; const A = (ok, msg) => { if (ok) console.log('PASS: ' + msg); else { console.error('FAIL: ' + msg); failures++; } };

const all = Object.keys(C.materialInfo);

/* ---- ① 每个材料都能说出"怎么用" ---- */
const noUse = all.filter(n => { const e = W.entry(n); return !e.handUse && e.uses.length === 0; });
A(noUse.length === 0, '每个材料都能派生出用途（' + all.length + ' 个）' + (noUse.length ? '｜说不出用途：' + noUse.join('、') : ''));

/* ---- ② 每个材料都能说出"从哪来" ---- */
const noSrc = all.filter(n => W.entry(n).sources.length === 0);
A(noSrc.length === 0, '每个材料都能派生出来源' + (noSrc.length ? '｜查不到来源：' + noSrc.join('、') : ''));

/* ---- ③ 三条产出路径都被接上了（打造石 / 道具 / 腐印） ---- */
const craftNames = Object.keys(C.craft || {}).map(k => C.craft[k] && C.craft[k].name).filter(Boolean);
const craftBad = craftNames.filter(n => W.uses(n).filter(u => u.where.indexOf('打造页') === 0).length === 0);
A(craftBad.length === 0, '每颗打造石都接上了 Config.craft 的效果文案' + (craftBad.length ? '｜没接上：' + craftBad.join('、') : ''));

const itemBad = (C.items || []).filter(i => W.uses(i.name).filter(u => u.what).length === 0);
A(itemBad.length === 0, '每件道具（' + (C.items || []).length + ' 件）都接上了 Config.items 的效果文案'
  + (itemBad.length ? '｜没接上：' + itemBad.map(i => i.name).join('、') : ''));

const affixBad = (((C.tower || {}).affix || {}).items || []).filter(i => W.uses(i.name).length === 0 || W.sources(i.name).length === 0);
A(affixBad.length === 0, '每枚腐印都有用途（进塔消耗）与来源（掉落）'
  + (affixBad.length ? '｜有问题：' + affixBad.map(i => i.name).join('、') : ''));

/* ---- ④ 结构合法：where 不为空、无重复行 ---- */
const badRow = [];
all.forEach(n => {
  const e = W.entry(n);
  [].concat(e.uses, e.sources).forEach(r => {
    if (!r.where || typeof r.what !== 'string') badRow.push(n + '/' + r.where);
  });
  const key = e.uses.map(r => r.where + '|' + r.what);
  if (new Set(key).size !== key.length) badRow.push(n + '(用途有重复行)');
});
A(badRow.length === 0, '词条行结构合法且无重复' + (badRow.length ? '｜有问题：' + badRow.join('、') : ''));

/* ---- ⑤ 图号映射抽查：掉落表键 1~10 要能翻成真实图名 ---- */
const fury = W.entry('腐印·暴怒');
const furySrc = fury.sources.map(s => s.where + '｜' + s.what).join(' ');
A(W.areaName(10).indexOf('腐变之源') >= 0, 'materialWeightsByTier 的键能翻成图名：10 → ' + W.areaName(10));
A(furySrc.indexOf('图10 腐变之源') >= 0, '腐印·暴怒 的来源里点出了"最高在 图10 腐变之源"（实际：' + fury.sources.map(s => s.where).join(' / ') + '）');

/* ---- ⑥ 手写兜底的只有极少数（多了说明在拿手写替配置） ---- */
const handN = all.filter(n => C.materialInfo[n].use || C.materialInfo[n].from).length;
A(handN <= 6, '手写「怎么用/来源」的条目控制在 6 条以内（当前 ' + handN + ' 条：'
  + all.filter(n => C.materialInfo[n].use || C.materialInfo[n].from).join('、') + '）');

console.log(failures ? 'MAT WIKI TESTS FAILED: ' + failures : 'ALL MAT WIKI TESTS PASSED');
process.exit(failures ? 1 : 0);
