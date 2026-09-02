/* ============================================================
 * vtest_pet_anim.js —— 宠物逐帧动画立绘（2026-08-30）
 * 守两条踩过的坑，改 pet-sprites.js / game.css / 动画素材时必须过：
 *  1. 图片 URL 不许进自定义属性：--as 里的相对 url() 会被浏览器按【样式表目录 css/】解析
 *     → /css/assets/... 404 → 立绘整块空白（2026-08-30 实测：图没问题，路径被吃了一层）
 *  2. steps 必须等于帧数、位移总量必须是 帧数×100%：steps(帧数-1) + (帧数-1)×100%
 *     在 end 模式下永远丢掉最后一帧
 * 另：素材必须是【单行】帧图（CSS steps() 在 2D 网格上无法逐帧定位）
 * ============================================================ */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');

// 最小 DOM 桩：记录 setProperty 的自定义属性，并允许直接写 backgroundImage
function node() {
  const vars = {};
  return {
    className: '', dataset: {}, children: [], textContent: '', innerHTML: '',
    style: {
      setProperty(k, v) { vars[k] = v },
      getPropertyValue(k) { return vars[k] },
      set backgroundImage(v) { vars.__bg = v },
      get backgroundImage() { return vars.__bg }
    },
    _vars: vars,
    appendChild(c) { this.children.push(c); return c },
    querySelector() { return this.children[0] || null }
  };
}
const ctx = { console, setTimeout, clearTimeout, navigator: {}, location: { href: 'http://x' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { getElementById: () => node(), createElement: () => node(), querySelector: () => node(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} } };
ctx.window = ctx; ctx.addEventListener = () => {}; ctx.removeEventListener = () => {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/core/pet-sprites.js'), 'utf8'), ctx);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const PS = ctx.PetSprites;
const srcJs = fs.readFileSync(path.join(ROOT, 'js/core/pet-sprites.js'), 'utf8');
const srcHtml = fs.readFileSync(path.join(ROOT, 'docs/游戏.html'), 'utf8');
const srcCss = fs.readFileSync(path.join(ROOT, 'docs/css/game.css'), 'utf8');

/* ---------- 1. 图片 URL 只走 background-image，不走自定义属性 ---------- */
// 逐帧当前默认关停（素材是重绘不是动作，见 pet-sprites.js 注释）；打开开关后逐帧逻辑仍必须正确
A(PS.ANIM_ENABLED === false, '逐帧默认关停（当前帧间是重绘，播起来是闪烁）');
PS.ANIM_ENABLED = true;
const host = node();
A(PS.mountAnimated(host, '影刃兔') === true, '有动画素材的形态挂载成功');
const anim = host.children[0];
A(!!anim && anim.className === 'pet-anim', '挂载产物的类名是 .pet-anim');
A(typeof anim.style.backgroundImage === 'string' && anim.style.backgroundImage.indexOf('url(') === 0,
  '图片 URL 写在 background-image 上（内联样式按文档解析，与 img.src 一致）');
A(anim._vars['--as'] === undefined, '不再用 --as 传图（自定义属性里的相对 url 会被解析到 css/ 下 → 404）');
A(!srcJs.includes('--as') && !srcHtml.includes('--as') && !srcCss.includes('--as'),
  '全站（pet-sprites.js / 游戏.html 内联副本 / game.css）都不再出现 --as');

/* ---------- 2. steps = 帧数，位移总量 = 帧数×100% ---------- */
const frames = PS.animMap['影刃兔'].idle.frames;
A(String(anim._vars['--steps']) === String(frames), `--steps 等于帧数（${frames}），不是帧数-1`);
A(String(anim._vars['--af']) === String(frames), `--af 等于帧数（${frames}）`);
const kf = srcCss.slice(srcCss.indexOf('@keyframes pet-anim-play'));
A(/calc\(var\(--af\)\s*\*\s*-100%\)/.test(kf.slice(0, 400)), '帧位移总量 = 帧数×100%（steps(N) end 模式才播得到最后一帧）');
A(!/var\(--af\)\s*-\s*1/.test(srcCss), 'CSS 里不再出现 (帧数-1) 的位移写法');
A(!/\.frames\s*-\s*1/.test(srcJs) && !/\.frames\s*-\s*1/.test(srcHtml), 'JS 里不再出现 frames-1 的 steps 写法');

/* ---------- 3. 素材本身必须是单行帧图 ---------- */
let sheetCount = 0;
for (const name of Object.keys(PS.animMap)) {
  for (const act of ['idle', 'attack']) {
    const a = PS.animMap[name][act];
    if (!a) continue;
    sheetCount++;
    const f = path.join(ROOT, 'docs', a.sheet);
    A(fs.existsSync(f), `${name}/${act} 素材文件存在（${a.sheet}）`);
    const b = fs.readFileSync(f);
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    A(w === h * a.frames, `${name}/${act} 是单行帧图（${w} = ${h}×${a.frames}），CSS steps 只能逐行定位`);
  }
}
A(sheetCount > 0, `animMap 里登记了 ${sheetCount} 张 spritesheet`);

/* ---------- 4. 回退与幂等 ---------- */
A(PS.mountAnimated(node(), '腐噜兽') === false, '无动画素材的形态返回 false（调用方回退静态立绘）');
A(PS.animOf('影刃兔·异变') === PS.animOf('影刃兔'), '「·异变」后缀回退到基础形态的动画');
let restarts = 0;
const orig = PS.restartAnim;
PS.restartAnim = function (n) { restarts++; return orig.call(this, n) };
PS.setAnim(anim, 'attack');
A(restarts === 1 && anim.dataset.anim === 'attack', '切到 attack 会换图并重播');
PS.setAnim(anim, 'attack');
A(restarts === 1, '重复切同一动作不重启动画（避免攻击途中被重置）');
PS.setAnim(anim, 'idle');
A(restarts === 2 && /idle/.test(anim.style.backgroundImage), '切回 idle 换回 idle 图并重播');
PS.restartAnim = orig;

/* ---------- 5. 静态立绘的 CSS 动作（逐帧关停时的表现层，必须连贯不闪） ---------- */
const srcBattle = fs.readFileSync(path.join(ROOT, 'js/ui/ui-battle.js'), 'utf8');
A(srcCss.includes('@keyframes pet-breathe'), 'game.css 有静态立绘的待机呼吸动画');
A(/--flip/.test(srcCss) && /transform:var\(--flip/.test(srcCss.replace(/\s/g, '')),
  '我方翻转走 --flip 变量并拼进 keyframes（否则会被呼吸动画的 transform 覆盖）');
A(srcBattle.includes("classList.add('pet-breathe')"), 'ui-battle.js 给静态立绘挂上呼吸动作');
A(srcCss.includes('@keyframes pet-hit'),
  '有受击后仰的立绘形变（只有位移没有形变，动作就没力度）');
const kfAll = srcCss.slice(srcCss.indexOf('@keyframes pet-breathe'));
A((kfAll.match(/var\(--flip/g) || []).length >= 11,
  '所有动作关键帧的 transform 都带 var(--flip)（我方翻转不能被动画吃掉）');

/* ---------- 6. 出手整套：前摇 → 冲到对方脸上（距离按实测量，不写死） ---------- */
A(srcCss.includes('@keyframes pet-charge') && srcCss.includes('@keyframes pet-dash-out')
  && srcCss.includes('@keyframes pet-dash-back'),
  '出手拆成前摇 + 冲出去 + 回位三段');
// 冲刺时长必须随距离自适应：写死时长的话，舞台越宽两只宠离得越远，速度就越快（宽屏上等于瞬移，晃眼）
A(/Math\.abs\(dist\) \/ speed/.test(srcBattle) && /--dash-out/.test(srcBattle) && /--dash-x/.test(srcBattle),
  '冲刺时长按恒定速度随距离自适应（不是写死时长，否则舞台越宽冲得越快）');
A(/PACE\s*=/.test(srcBattle) && /--dash-charge/.test(srcBattle) && /--dash-back/.test(srcBattle),
  '前摇 / 后摇按角色类型注入 CSS 变量（我方 / 普通 / 进化 / 变异各有节奏）');
A(/pet-charge var\(--dash-charge/.test(srcCss) && /pet-dash-back var\(--dash-back/.test(srcCss),
  'CSS 的前摇与回位时长走变量（写死就会和 JS 的节奏表对不上）');
A(/mutant/.test(srcBattle) && /charge:\s*300/.test(srcBattle),
  '变异体的前摇明显更长（抬手慢、收招沉，类型辨识度靠这个建立）');
A(/return pace\.charge \+ dashMs/.test(srcBattle),
  '命中时刻由表现层返回（前摇按类型、冲刺按距离，写死必然对不上）');
A(/classList\.remove\('charging', 'attacking'\)/.test(srcBattle) && /offsetWidth/.test(srcBattle),
  '连击时先摘旧 class 再强制重排（同名 class 的动画不会自己重播，否则第二次出手丢前摇）');
A(/var\(--dash-x/.test(srcCss), '扑击位移走 --dash-x 变量（由 JS 按两个立绘的实际间距算出）');
A(/OVERLAP/.test(srcBattle) && /getBoundingClientRect/.test(srcBattle),
  'ui-battle.js 按两个立绘的实际间距计算冲刺距离（布局是响应式的，写死必然对不上）');
// translate/rotate 必须排在 var(--flip) 之前：写在后面会被 scaleX(-1) 一起翻成反方向。
// 必须精确截取这几个 @keyframes 块本身——按起点一刀切到文件尾会把舞台动画(rotate 开头的 slash-arc 等)也算进来
function keyframesBlock(css, name) {
  const i = css.indexOf('@keyframes ' + name);
  if (i < 0) return '';
  let depth = 0;
  for (let k = css.indexOf('{', i); k < css.length; k++) {
    if (css[k] === '{') depth++;
    else if (css[k] === '}' && --depth === 0) return css.slice(i, k + 1);
  }
  return '';
}
const kfFight = ['pet-charge', 'pet-dash-out', 'pet-dash-back', 'pet-hit'].map(n => keyframesBlock(srcCss, n)).join('');
const tfs = kfFight.match(/transform:[^;}]+/g) || [];
A(tfs.length >= 10 && tfs.every(t => t.replace(/\s/g, '').indexOf('transform:translate(') === 0),
  '战斗动作的 transform 一律以 translate 开头（位移/旋转排在 var(--flip) 之前）');
A(/#tab-battle \.stage-avatar\.attacking\s*\{\s*z-index/.test(srcCss),
  '攻击时立绘抬到对手之上（否则按 DOM 顺序冲上去像钻进对方身后）');

/* ---------- 7. 命中特效：冲击环 + 立绘轮廓闪光（暴击走加强版） ---------- */
A(srcCss.includes('@keyframes hit-ring') && srcCss.includes('@keyframes hit-flash'),
  '命中特效两层：冲击环 + 闪光');
A(/mask-image:var\(--sprite\)/.test(srcCss) && /setProperty\('--sprite'/.test(srcBattle),
  '闪光层用立绘自己的轮廓做遮罩（不是糊一个方框），--sprite 由 JS 写成绝对 URL');
// filter 动画跑在合成器线程，主线程读不到插值、跨机器表现不一致，别再用回它做闪白
const hitKf = keyframesBlock(srcCss, 'pet-hit') + keyframesBlock(srcCss, 'pet-hit-crit');
A(!/filter:/.test(hitKf), '受击动作不用 filter 做闪白（合成器动画不可预期）');
A(srcCss.includes('@keyframes hit-ring-crit') && /--hit-flash:#/.test(srcCss),
  '暴击有加强版特效（更大的红环 + 红橙色闪光）');

console.log('\nALL PET ANIM TESTS PASSED');
