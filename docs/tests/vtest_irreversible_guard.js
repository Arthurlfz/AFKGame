// vtest_irreversible_guard.js —— 不可逆操作必须有确认（2026-09-17）
//
// 守的是什么：**玩家手里的东西不会因为他"点了一下 / 按了一下键"就永久消失。**
// 起因是一次交互审查：背包里 Ctrl+Enter = 一键分解全部装备，没有确认、不能撤销，
// 而 Ctrl+Enter 在聊天框还是"发送"键；Ctrl/Alt+点装备同样是点了直接拆。
// 分解、丢弃、吞噬这类操作以后还会再加，这条底线不能靠人记。
//
// 判据（三条，缺一不可）：
//   ① 任何分解入口都必须先走确认（UI.salvageConfirm / askThenSalvage），不许直接调 salvageList
//   ② 键盘快捷键只在"背包确实开着、且焦点不在输入框里"时才生效
//   ③ 引导 spotlight 的锚点在页面上必须存在（否则引导会整块消失，玩家点「去XX」没反应）
const fs = require('fs'), path = require('path');
const VTF = require('./vtest_files');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
let failures = 0;
const A = (ok, msg) => { if (ok) console.log('PASS: ' + msg); else { console.error('FAIL: ' + msg); failures++; } };

const bagSrc = read('js/ui/ui-bag.js');
const equipSrc = read('js/ui/ui-equipment.js');
const htmlSrc = read('游戏.html');

/* ---------- ① 分解必须过确认 ---------- */
// quickSalvage / bulkSalvage 都改成走 askThenSalvage 了；谁要是图省事直接调 salvageList，这里会红。
const askDefined = /function\s+askThenSalvage\s*\(/.test(bagSrc);
A(askDefined, 'ui-bag.js 里有统一的分解确认出口 askThenSalvage');

const quickBody = (bagSrc.match(/function\s+quickSalvage\s*\(eq\)\s*\{[\s\S]{0,400}?\n\s*\}/) || [''])[0];
A(askDefined && /askThenSalvage\(/.test(quickBody) && !/Salvage\.salvageList/.test(quickBody),
  '单件快分解（Ctrl/Alt+点）先弹确认，不直接调 salvageList');

const bulkBody = (bagSrc.match(/function\s+bulkSalvage\s*\(\)\s*\{[\s\S]{0,400}?\n\s*\}/) || [''])[0];
A(askDefined && /askThenSalvage\(/.test(bulkBody) && !/Salvage\.salvageList/.test(bulkBody),
  '批量分解（Ctrl/Alt+Enter）先弹确认，不直接调 salvageList');

// 确认面板本身：四个入口共用一份实现，取消按钮必须真的能关
A(/function\s+salvageConfirm\s*\(/.test(equipSrc), '分解确认面板有唯一实现 salvageConfirm');
A(/UI\.salvageConfirm\s*=/.test(equipSrc), 'salvageConfirm 已导出（背包那两个入口要能用）');
A(/cancel\.onclick\s*=\s*closeSalvagePanel/.test(equipSrc), '确认面板的「取消」按钮绑了关闭（以前点了没反应）');

// 面板不可用时也不能无确认就拆
A(/window\.confirm/.test(equipSrc) || /window\.confirm/.test(bagSrc),
  '面板拿不到时降级为 window.confirm，不会静默直接分解');

/* ---------- ② 快捷键的两道闸 ---------- */
const keyBody = (bagSrc.match(/document\.addEventListener\('keydown'[\s\S]{0,700}?\n\s*\}\);/) || [''])[0];
A(/ctrlKey\s*\|\|\s*e\.altKey/.test(keyBody), '批量分解快捷键仍是 Ctrl/Alt + Enter');
A(/INPUT|TEXTAREA|isContentEditable/.test(keyBody),
  '焦点在输入框里时不触发分解（Ctrl+Enter 是聊天发送键，不能顺带拆背包）');
A(/bag-window/.test(keyBody) && /is-open/.test(keyBody),
  '只有背包窗口开着时才触发分解（在市集/商店按到不该有事发生）');

/* ---------- ③ 引导锚点必须存在 ---------- */
// 引导 spotlight 的 target 写错 → 元素找不到 → 挖洞和气泡一起被隐藏，玩家点「去XX」毫无反应。
// 这里把 config 里所有 target 选择器抓出来，逐个去 游戏.html 里找 id（#xxx 的才查得动）。
const cfgSrc = read('js/core/config.js');
const targets = [...cfgSrc.matchAll(/target:\s*'([^']+)'/g)].map(m => m[1]);
const idTargets = [...new Set(targets.filter(t => t.startsWith('#')))];
const missing = idTargets.filter(t => htmlSrc.indexOf('id="' + t.slice(1) + '"') === -1);
A(missing.length === 0,
  '引导 spotlight 的 #id 锚点在页面上都能找到（共 ' + idTargets.length + ' 个）'
  + (missing.length ? '｜找不到：' + missing.join('、') : ''));

// 就算锚点真的丢了，也不能把气泡一起藏掉（降级：只不挖洞，文案照常显示）
const obSrc = read('js/ui/ui-onboarding.js');
const noFind = obSrc.slice(obSrc.indexOf('spotlight target 不可见'));
A(/float\.style\.display\s*=\s*'flex'/.test(noFind.slice(0, 600)),
  '锚点缺失时气泡仍然显示（降级为居中），不会让引导整块消失');

console.log(failures ? `\n${failures} 条失败` : '\n全部通过');
process.exit(failures ? 1 : 0);
