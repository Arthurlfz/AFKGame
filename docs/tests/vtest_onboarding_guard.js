// vtest_onboarding_guard.js —— 引导暗层「只压暗不拦截」契约守值（2026-09-21）
//
// 守的是什么：**新手引导弹层永远不许挡住下层按钮。**
//
// 背景：内测清单 2026-09-21 🔴1 报"开场聚光引导暗层盖全屏、什么都点不动"。
// 现场取证结论：线上=本地=HEAD，`ui-onboarding.css` 里 .ob-host/.ob-veil/.ob-hole 早已全部
// `pointer-events: none`（09-02 教训："只压暗不拦截"），实测无法复现卡死 —— 判定为测试环境误判
// （同清单备注里"背包/孵化弹窗卡死"那一次）。这条契约是静态可判的，所以用源码级检查锁死，
// 防止将来有人（或某次样式重构）把 pointer-events:none 改回 auto，让"进游戏即锁死"真的发生。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;
const A = (ok, msg) => { if (ok) console.log('PASS: ' + msg); else { console.error('FAIL: ' + msg); failures++; } };

/* ---------- 工具：取某个顶层选择器块的声明区（只匹配块起点，不跨块） ---------- */
function blockOf(css, selector) {
  // 选择器后面跟 `{`，取到与之配对的第一个 `}` 为止（本文件没有嵌套 @media 包着这些类）
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = css.match(re);
  return m ? m[1] : null;
}

const css = fs.readFileSync(path.join(ROOT, 'css', 'ui-onboarding.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'js', 'ui', 'ui-onboarding.js'), 'utf8');

/* ---------- ① 压暗层与镂空层必须 pointer-events:none（挡了就是"进游戏即锁死"） ---------- */
[['ob-host', '挂载层（fixed 全屏）'],
 ['ob-veil', '压暗遮罩'],
 ['ob-hole', '聚光镂空'],
 ['ob-float', '导购气泡容器（气泡本体可点，容器必须放行下层点击）'],
 ['ob-hot-ring', 'hotspot 脉冲环'],
 ['ob-hot-bubble', 'hotspot 轻气泡']].forEach(([cls, label]) => {
  const block = blockOf(css, '.' + cls);
  A(block !== null, `.${cls} 规则块仍存在（${label}）`);
  if (block !== null) {
    A(/pointer-events\s*:\s*none/.test(block), `.${cls} 仍为 pointer-events:none（只压暗不拦截）`);
  }
});

/* ---------- ② 可点的交互件必须保留 pointer-events:auto（否则引导自己也没法关） ---------- */
[['ob-float-bubble', '气泡台词卡'],
 ['ob-float-actions', 'spotlight 按钮区'],
 ['ob-actions', '字幕条按钮区']].forEach(([cls, label]) => {
  const block = blockOf(css, '.' + cls);
  A(block !== null, `.${cls} 规则块仍存在（${label}）`);
  if (block !== null) {
    A(/pointer-events\s*:\s*auto/.test(block), `.${cls} 保留 pointer-events:auto（引导自身可操作）`);
  }
});

/* ---------- ③ 引擎 JS 不许在运行时把挂载层改成可拦截 ---------- */
A(!/pointerEvents/.test(js), 'ui-onboarding.js 不出现 pointerEvents 内联覆盖（契约以 CSS 为唯一事实源）');

console.log(failures ? `\n${failures} 条失败` : '\n全部通过');
