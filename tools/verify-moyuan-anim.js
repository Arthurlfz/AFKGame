// 验证游戏.html内联 PetSprites 对墨渊魔君是否挂载动画
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('D:/Ai/游戏原型/docs/游戏.html', 'utf8');
// 提取内联 PetSprites 对象源码（window.PetSprites = {...}; 到第一个 }; 结束）
const m = html.match(/window\.PetSprites = (\{[\s\S]*?\n\});/);
if (!m) { console.log('❌ 未找到内联 PetSprites'); process.exit(1); }
console.log('提取长度:', m[1].length, '首行:', m[1].slice(0, 60).replace(/\n/g, '\\n'));

// mock document 用于 makeAnimNode / paintAnim
const elProto = {
  textContent: '', children: [],
  style: { setProperty(k, v) { this[k] = v; }, backgroundImage: '' },
  dataset: {},
  appendChild(c) { this.children.push(c); return c; },
  setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  offsetWidth: 0,
};
function makeEl() { return Object.create(elProto); }
const els = {};
const ctx = {
  window: {},
  document: {
    createElement: () => makeEl(),
    getElementById: (id) => els[id] || (els[id] = makeEl()),
    querySelector: () => null, querySelectorAll: () => [],
  },
};
ctx.window = ctx;
vm.createContext(ctx);
const PS = vm.runInContext('(' + m[1] + ')', ctx);
console.log('V =', PS.V);
console.log('ANIM_ENABLED =', PS.ANIM_ENABLED);

// 1. animOf
const anim = PS.animOf('墨渊魔君');
console.log('\n[animOf 墨渊魔君]', anim ? JSON.stringify(anim) : '❌ null');

// 2. mountAnimated
const el = makeEl();
const ok = PS.mountAnimated(el, '墨渊魔君');
console.log('[mountAnimated 返回]', ok);
console.log('[挂载子节点数]', el.children.length);
if (el.children[0]) {
  console.log('[节点 class]', el.children[0].className);
  console.log('[节点 dataset.petName]', el.children[0].dataset.petName);
  console.log('[节点 data-anim]', el.children[0].dataset.anim);
  console.log('[背景图]', el.children[0].style.backgroundImage);
  console.log('[--af]', el.children[0].style['--af'], '[--steps]', el.children[0].style['--steps'], '[--dur]', el.children[0].style['--dur']);
}

// 3. setAnim attack
if (ok) {
  const node = el.children[0];
  PS.setAnim(node, 'attack');
  console.log('\n[setAnim attack 后]');
  console.log('[data-anim]', node.dataset.anim);
  console.log('[背景图]', node.style.backgroundImage);
  console.log('[--af]', node.style['--af'], '[--steps]', node.style['--steps'], '[--dur]', node.style['--dur']);
}
