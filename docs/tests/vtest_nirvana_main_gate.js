// vtest_nirvana_main_gate.js —— 涅槃「主宠门槛」守值（2026-09-17）
//
// 守的是什么：**穿着一身装备的神宠，必须能出现在涅槃的主宠列表里。**
//
// 背景（用户实测报的 bug）：「神宠无法涅槃，都不能选择」。
//   查库发现：唯一的神宠「血月神狐」Lv60 神级、**穿满 12 件装备** → 主宠列表是空的。
//   根因：涅槃页的主宠筛选误用了 `Merge.canMerge` —— 那是【副宠】的门槛，含"未穿装备"
//   （副宠涅槃后会消失，穿着装备会连带出事，所以它必须脱）；
//   而主宠涅槃后是【保留】的，装备留着完全没问题。
//   服务端 `pet_merge.js:nirvanaInner` 对主宠也只校验等级 —— UI 与服务端口径现已一致。
//
// 这个 bug 的性质是「拿另一套判据套错了对象」，很容易再犯，所以把它钉成纯函数 + 测试。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const VTF = require('./vtest_files');

const ctx = {
  console, setTimeout, clearTimeout, JSON, Object, Array, String, Number, Math, Date, Boolean,
  navigator: {}, localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() { } }
};
ctx.window = ctx;
vm.createContext(ctx);
// pet_merge.js 顶层就解构了 window.Pet / window.Materials，所以要先把依赖喂上
for (const f of ['../js/core/config.js', '../js/equipment/equipment.js', '../js/pet/pet.js',
                 '../js/core/materials.js', '../js/pet/pet_merge.js']) VTF.load(ctx, f);

const Merge = ctx.Merge;
let failures = 0;
const A = (ok, msg) => { if (ok) console.log('PASS: ' + msg); else { console.error('FAIL: ' + msg); failures++; } };

if (!Merge || typeof Merge.canNirvanaMain !== 'function') {
  console.error('FAIL: Merge.canNirvanaMain 不存在（主宠门槛的唯一实现）');
  process.exit(1);
}
console.log('PASS: Merge.canNirvanaMain 存在');

// 满身装备（12 槽，模拟用户那只神宠的真实状态）
const fullGear = {};
['武器', '戒指', '项链', '头盔', '护甲', '盾牌', '靴子', '腰带', '斗篷', '饰品', '护符', '徽章']
  .forEach((s, i) => { fullGear[s] = 'eq-' + i; });

const godGeared = { name: '血月神狐', level: 60, growth: 75.6, cloudId: 'c-1', isGodPet: true, equipment: fullGear };
const godBare = { name: '血月神狐', level: 60, growth: 75.6, cloudId: 'c-2', equipment: {} };
const lowLevel = { name: '小兽', level: 59, cloudId: 'c-3', equipment: {} };
const noCloud = { name: '小兽', level: 60, equipment: {} };

/* ---------- ① 主宠门槛：穿满装备也要能选（这就是那个 bug） ---------- */
A(Merge.canNirvanaMain(godGeared) === true,
  '穿满 12 件装备的 Lv60 神宠 = 可作主宠（装备不影响主宠，主宠涅槃后保留）');
A(Merge.canNirvanaMain(godBare) === true, '没穿装备的 Lv60 宠 = 可作主宠');
A(Merge.canNirvanaMain(lowLevel) === false, 'Lv59 = 不可作主宠（门槛 ' + ((ctx.Config.nirvana || {}).minLevel || 60) + '）');
A(Merge.canNirvanaMain(noCloud) === false, '没有 cloudId = 不可作主宠（没法同步云端）');

/* ---------- ② 副宠门槛保持不变：必须没穿装备（副宠会消失） ---------- */
A(Merge.canMerge(godGeared) === false,
  '穿装备的宠【不能当副宠】（副宠涅槃后会消失，装备必须脱 —— 这条规则是对的，别改）');
A(Merge.canMerge(godBare) === true, '没穿装备的 Lv60 宠 = 可作副宠');

/* ---------- ③ UI 用的是正确的那一个 ---------- */
const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'ui-pet-merge.js'), 'utf8');
A(/Merge\.canNirvanaMain\(/.test(uiSrc), '涅槃页的主宠筛选调用 Merge.canNirvanaMain');
// 主宠筛选那一段里不许再出现 canMerge（副宠候选在另一个函数里，用的是 getMergeCandidates）
const mainBlock = (uiSrc.match(/const cands = getPets\(\)\.filter[\s\S]{0,300}?;/) || [''])[0];
A(mainBlock.length > 0 && !/canMerge\(/.test(mainBlock),
  '主宠筛选里不再出现 canMerge（避免再被误套副宠判据）');

console.log(failures ? `\n${failures} 条失败` : '\n全部通过');
process.exit(failures ? 1 : 0);
