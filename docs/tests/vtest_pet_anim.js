/* ============================================================
 * vtest_pet_anim.js —— 宠物逐帧动画立绘（2026-08-30）
 * 守两条踩过的坑，改 pet-sprites.js / game.css / 动画素材时必须过：
 *  1. 图片 URL 不许进自定义属性：--as 里的相对 url() 会被浏览器按【样式表目录 css/】解析
 *     → /css/assets/... 404 → 立绘整块空白（2026-08-30 实测：图没问题，路径被吃了一层）
 *  2. 帧条宽 = 帧数×100%，播放由【JS 定时器直驱 transform（像素）】：
 *     ⛔ 不能用 background-position 的百分比（那个百分比相对容器宽−图宽，必错）
 *     ⛔ 动画里不能出现 CSS 变量（解析失败的症状是"立绘静止"，不报错，极难查）
 *     ⛔ 不能用 CSS animation 播（reduced-motion 的全局降压规则会把它压成静帧）
 *     ⛔ 重复挂载同一只宠不许重建节点（重建 = 每场战斗播放进度归零，看着永远不动）
 * 另：素材必须是【单行】帧图
 * ============================================================ */
const fs = require('fs'), vm = require('vm'), path = require('path'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..');

/* 极简 PNG 解码（只为了读像素做"素材有没有超框"的检查）。
 * 支持 8bit 灰度/RGB/RGBA、非隔行 —— 够读我们的精灵图。 */
function decodePNG(file) {
  const b = fs.readFileSync(file);
  let o = 8, w = 0, h = 0, ctype = 0;
  const idat = [];
  while (o < b.length - 8) {
    const len = b.readUInt32BE(o), t = b.slice(o + 4, o + 8).toString('ascii');
    if (t === 'IHDR') { w = b.readUInt32BE(o + 8); h = b.readUInt32BE(o + 12); ctype = b[o + 17]; }
    else if (t === 'IDAT') idat.push(b.slice(o + 8, o + 8 + len));
    o += 12 + len;
    if (t === 'IEND') break;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (!ch) throw new Error('不支持的 PNG 颜色类型 ' + ctype);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p++], line = raw.slice(p, p + stride); p += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, bb = prev[x], c = x >= ch ? prev[x - ch] : 0, v = line[x];
      let r = v;
      if (ft === 1) r = v + a;
      else if (ft === 2) r = v + bb;
      else if (ft === 3) r = v + ((a + bb) >> 1);
      else if (ft === 4) {
        const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c);
        r = v + (pa <= pb && pa <= pc ? a : (pb <= pc ? bb : c));
      }
      cur[x] = r & 255;
    }
  }
  return { w, h, ch, px: out };
}

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
    get firstElementChild() { return this.children[0] || null },
    appendChild(c) { this.children.push(c); return c },
    querySelector() { return this.children[0] || null }
  };
}
const ctx = { console, setTimeout, clearTimeout,
  // 逐帧播放器要用 interval：桩里回一个非 0 句柄即可（__frameTimer 真值 = "在播"）
  setInterval: () => 1, clearInterval: () => {},
  navigator: {}, location: { href: 'http://x' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { getElementById: () => node(), createElement: () => node(), querySelector: () => node(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} } };
ctx.window = ctx; ctx.addEventListener = () => {}; ctx.removeEventListener = () => {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/core/pet-sprites.js'), 'utf8'), ctx);
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1) } console.log('PASS: ' + m) };
const PS = ctx.PetSprites;
const srcJs = fs.readFileSync(path.join(ROOT, 'js/core/pet-sprites.js'), 'utf8');
const srcHtml = fs.readFileSync(path.join(ROOT, '游戏.html'), 'utf8');
const srcCss = fs.readFileSync(path.join(ROOT, 'css/game.css'), 'utf8');

/* ---------- 1. 图片 URL 只走 background-image，不走自定义属性 ---------- */
// 逐帧当前默认关停（一批合格素材都没有，见 pet-sprites.js 的 ANIM_ENABLED 注释）；
// 打开开关后挂载逻辑仍必须正确 —— 用 animMap 里现存的「影刃兔」验，它同时有 idle/attack。
const ANIM_FOR_TEST = '影刃兔';
/* 2026-09-21 起逐帧【已启用】：血月神狐换成重做的 3×3 九格素材（边缘实心 0%，守值达标）。
 * ⚠️ 下面 ANIM_DEFAULT 会变成 true ⇒ 每条素材的"不许超框"立刻成为【硬断言】，
 *    以后谁塞不合格素材进来，CI 直接拦住（这正是当初加这条守值的目的）。 */
A(PS.ANIM_ENABLED === true, '逐帧已启用（血月神狐 3×3 九格素材 + 影刃兔/霜影兔），总开关必须是 true');
const ANIM_DEFAULT = PS.ANIM_ENABLED;   // 记下发布默认值，素材质量守值只对"真正启用的素材"强制
// 总开关必须真的被 mountAnimated 尊重（否则关掉等于没关）
PS.ANIM_ENABLED = true;
PS.ANIM_ENABLED = false;
A(PS.mountAnimated(node(), ANIM_FOR_TEST) === false, '总开关关着时，即使有素材也回退静态立绘');
PS.ANIM_ENABLED = true;
A(PS.mountAnimated(node(), '腐噜兽') === false, 'animMap 里没有的形态返回 false（回退静态立绘）');
const host = node();
A(PS.mountAnimated(host, ANIM_FOR_TEST) === true, 'animMap 里有素材的形态挂载成功');
const anim = host.children[0];
A(!!anim && anim.className === 'pet-anim', '挂载产物的类名是 .pet-anim');
const strip = anim.firstElementChild;
A(!!strip && strip.className === 'pet-anim-strip', '.pet-anim 里是帧条 .pet-anim-strip（裁切层 + 帧条两层）');
A(typeof strip.style.backgroundImage === 'string' && strip.style.backgroundImage.indexOf('url(') === 0,
  '图片 URL 写在 background-image 上（内联样式按文档解析，与 img.src 一致）');
A(anim._vars['--as'] === undefined, '不再用 --as 传图（自定义属性里的相对 url 会被解析到 css/ 下 → 404）');
A(!srcJs.includes('--as') && !srcHtml.includes('--as') && !srcCss.includes('--as'),
  '全站（pet-sprites.js / 游戏.html 内联副本 / game.css）都不再出现 --as');

/* ---------- 2. 帧条宽 = 帧数×100%，播放由【JS 定时器】直驱 transform ----------
 * 🔴 三轮实测（血月神狐 24 帧，素材已撤但踩过的坑要一直守住），
 *    每一轮的失败方式都不同、都不报错：
 *   ① background-position 的百分比做位移：那个百分比相对【容器宽−图宽】而不是图宽，
 *      图宽=帧数×容器宽 ⇒ 100% 只等于「帧数−1 帧」，写 −帧数×100% 把整张图推出容器
 *      （症状：只在每轮开头闪一帧，其余全白）。
 *   ② 动画里放 CSS 变量：解析不出来时症状是"立绘静止"，分不出是动画坏了还是素材只有一帧。
 *   ③ CSS animation 播放：design-tokens.css / market-cascade.css 的
 *      `@media (prefers-reduced-motion:reduce){ *{animation-duration:.01ms!important;iteration-count:1!important} }`
 *      会把动画压成一瞬间播完 ⇒ 定格第 1 帧，而它是 `* {}` + !important，针对性规则盖不动。
 *      —— 这条最阴：同一个浏览器里，独立页面能跑、游戏页不动，看不出和 CSS 有关。
 *   ⇒ 最终方案：JS 定时器直接写 transform，单位用【像素】（第 k 帧 = -k × 容器宽），
 *     不碰 CSS animation、不碰百分比位移，以上三条全部免疫。 */
const frames = PS.animMap[ANIM_FOR_TEST].idle.frames;
A(strip.style.width === (frames * 100) + '%', `帧条宽 = 帧数×100%（${frames} 帧 → ${frames * 100}%）`);
A(typeof PS.playFrames === 'function' && typeof PS.stopFrames === 'function',
  '有 JS 逐帧播放器 playFrames / stopFrames');
A(!!strip.__frameTimer, '挂载后立刻起了帧定时器');
// 🔴 立绘播放绝不能再回到 CSS animation：那套会被 reduced-motion 的全局降压规则压成静帧
A(!srcCss.includes('@keyframes pet-anim-play'), 'game.css 里不再有 pet-anim-play 关键帧（播放已不走 CSS animation）');
A(!/style\.animation\s*=\s*['"]?pet-anim-play/.test(srcJs) && !/style\.animation\s*=\s*"pet-anim-play/.test(srcHtml),
  'pet-sprites.js 与内联副本都不再拼 CSS animation 串');
A(/prefers-reduced-motion/.test(srcJs), 'pet-sprites.js 注释里记着 reduced-motion 全局降压这个坑');
A(/-\w*\s*\*\s*w|translateX\(' \+ \(-k \* w\)/.test(srcJs) || /translateX\(" \+ \(-k \* w\)/.test(srcHtml),
  '每帧位移按【像素】算（不碰百分比）');
// ⚠️ 从 `.pet-anim {` 之后开始找 `.pet-anim-strip`：注释里先出现了这两个名字，顺着 indexOf 会切出空串
// ⚠️ 但 `.pet-anim {` 也出现在【选择器列表末尾】（如 `... .stage-avatar.charging .pet-anim {`，2026-09-21 加的），
//    所以"取第一处"会切到别的块里去 ⇒ 改成：把每个 `.pet-anim {` 到它自己的 `}` 都切出来，只要有一个是裁切层就算过。
const animBlocks = [];
for (let i = srcCss.indexOf('.pet-anim {'); i >= 0; i = srcCss.indexOf('.pet-anim {', i + 1)) {
  const end = srcCss.indexOf('}', i);
  animBlocks.push(srcCss.slice(i, end < 0 ? srcCss.length : end + 1));
}
A(animBlocks.some(b => /overflow:hidden/.test(b)),
  '.pet-anim 是裁切层（帧条比容器宽 N 倍，溢出的必须裁掉）');
// 游戏.html 是内联副本（浏览器只跑这一份，js/core/pet-sprites.js 不加载）⇒ 两份必须同步
A(/pet-anim-strip/.test(srcHtml), '游戏.html 内联副本同样产出 .pet-anim-strip');
A(/this\.playFrames\(s, x\.frames, x\.dur/.test(srcHtml),
  '游戏.html 内联副本同样用 JS 播放器（不是内联 animation 串）');
A(!/setProperty\("--steps"/.test(srcHtml) && !/setProperty\("--shift"/.test(srcHtml),
  '游戏.html 内联副本不再写 --steps / --shift（那套"变量驱动动画"会静默失效）');

/* ---------- 2b. 重复挂载不许重建（否则每场战斗动画都被拉回第 1 帧） ---------- */
const hostB = node();
A(PS.mountAnimated(hostB, ANIM_FOR_TEST) === true, '二次挂载：先挂成功');
const nodeB = hostB.children[0];
PS.mountAnimated(hostB, ANIM_FOR_TEST);   // 战斗页每场 resetBattle / 每次 renderAll 都会走到这里
A(hostB.children[0] === nodeB, '重复挂载同一只宠不重建节点（重建会把播放进度归零 ⇒ 看着永远不动）');
A(PS.animOf(ANIM_FOR_TEST).idle.dur === '1.8s', '影刃兔 idle 是 6 帧 / 1.8 秒一轮（换成新素材时这条要一起改）');

/* ---------- 2c. 🔴 游戏.html 内联副本的 animMap 必须与 pet-sprites.js 完全一致 ----------
 * 浏览器只跑内联那一份（js/core/pet-sprites.js 根本没被 <script src> 加载），两份靠人工同步。
 * 2026-09-21 事故：内联那份的"血月神狐"还停在早期的占位
 *   `sheet: 血月神狐-test.png, frames: 1` ⇒ 帧数=1 ⇒ 帧号 i%1 恒为 0 ⇒ 立绘完全静止。
 * 只断言"内联里有 pet-anim-strip"这种字符串特征是抓不到的，必须逐字段比对。 */
// ⚠️ 允许 animMap 和 avatarMap 之间夹一段注释（撤掉血月神狐时就在那里留了说明）
const animBlock = /animMap:\s*(\{[\s\S]*?\})\s*,\s*(?:\/\*[\s\S]*?\*\/\s*)?avatarMap:/.exec(srcHtml);
A(!!animBlock, '从 游戏.html 里能取出内联 animMap（格式变了就要改这条正则）');
const inlineAnim = new Function('return (' + animBlock[1] + ')')();
function deepEq(a, b, p) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    console.error('   差异 @ ' + p + '：js=' + JSON.stringify(a) + ' 内联=' + JSON.stringify(b)); return false;
  }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join(',') !== kb.join(',')) {
    console.error('   差异 @ ' + p + ' 键不同：js=[' + ka + '] 内联=[' + kb + ']'); return false;
  }
  return ka.every(k => deepEq(a[k], b[k], p + '.' + k));
}
A(deepEq(PS.animMap, inlineAnim, 'animMap'),
  '内联 animMap 与 pet-sprites.js 逐字段一致（两份不同步 = 改了等于没改）');
/* 再往下走一步：把【内联那一份】真跑一遍。
 * 上面的字段比对只证明"配置一样"，这条证明"拿它跑出来的帧条也对"
 * —— 真正在浏览器里执行的是内联副本，不是 js/core/pet-sprites.js。 */
// ⚠️ 不能用 /<script>([\s\S]*?window\.PetSprites...)<\/script>/：文件里在它之前还有别的内联 script，
//    非贪婪匹配会从那个更早的 <script> 开始，把它的结束标签一起吞进来 → SyntaxError
const psStart = srcHtml.indexOf('window.PetSprites');
const psEnd = srcHtml.indexOf('</script>', psStart);
A(psStart > 0 && psEnd > psStart, '能从 游戏.html 里取出内联 PetSprites 脚本');
const inlineScript = [null, srcHtml.slice(psStart, psEnd)];
const ctx2 = { console, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
  navigator: {}, location: { href: 'http://x' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { getElementById: () => node(), createElement: () => node(), querySelector: () => node(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} } };
ctx2.window = ctx2; ctx2.addEventListener = () => {}; ctx2.removeEventListener = () => {};
vm.createContext(ctx2);
vm.runInContext(inlineScript[1], ctx2);
const IPS = ctx2.PetSprites;
A(IPS.ANIM_ENABLED === true, '内联副本的总开关与 js 那份一致（发布态要播逐帧）');
IPS.ANIM_ENABLED = true;   // 打开才能验挂载逻辑；发布态由 ANIM_ENABLED 统一关停
const hostIn = node();
A(IPS.mountAnimated(hostIn, ANIM_FOR_TEST) === true, '内联副本能挂上动画');
const stripIn = hostIn.children[0].firstElementChild;
const wantW = (PS.animMap[ANIM_FOR_TEST].idle.frames * 100) + '%';
A(stripIn.style.width === wantW,
  `内联副本跑出来的帧条宽是 ${wantW}（不是 100% —— 100% 意味着帧数被当成 1，画面会完全静止）`);
A(hostIn.children[0].dataset.petName === ANIM_FOR_TEST, '内联副本给节点标了 petName（幂等复用靠它）');
// 帧数=1 的"逐帧动画"等于静帧，本身就是错的配置
for (const name of Object.keys(PS.animMap)) {
  for (const act of ['idle', 'attack']) {
    const a = PS.animMap[name][act];
    if (a) A(a.frames > 1, `${name}/${act} 帧数 > 1（帧数=1 播出来是静帧）`);
  }
}

/* ---------- 3. 素材本身：单行帧图 + 角色不许"超框" ----------
 * 🔴 "超框"＝角色的毛发/尾巴横向超出了格子，被画面边缘切成一条直线。
 * 播起来左右各一道直线切口，看着像"尾巴缺一截 + 旁边漂着半截"（2026-09-21 血月神狐实测：
 * 20/24 格触左边界、19/24 格触右边界）。**代码救不了**：往内裁只是把直线挪进画面，更显眼。
 * 判据：每格最左/最右 8px 条带里，不透明像素占比不能超过 15%。 */
const EDGE = 8, EDGE_LIMIT = 15;      // 边缘条带宽（px）/ 允许的实心占比（%）
let sheetCount = 0;
for (const name of Object.keys(PS.animMap)) {
  for (const act of ['idle', 'attack']) {
    const a = PS.animMap[name][act];
    if (!a) continue;
    sheetCount++;
    const f = path.join(ROOT, a.sheet);
    A(fs.existsSync(f), `${name}/${act} 素材文件存在（${a.sheet}）`);
    const b = fs.readFileSync(f);
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    A(w === h * a.frames, `${name}/${act} 是单行帧图（${w} = ${h}×${a.frames}）`);

    const img = decodePNG(f), ch = img.ch, fw = img.w / a.frames;
    const al = (x, y) => (ch === 4 ? img.px[(y * img.w + x) * ch + 3] : 255);
    let worstPct = 0, worstK = 0;
    for (let k = 0; k < a.frames; k++) {
      const x0 = Math.round(k * fw), x1 = Math.round((k + 1) * fw) - 1;
      let n = 0;
      for (let y = 0; y < img.h; y++) {
        for (let x = x0; x < x0 + EDGE; x++) if (al(x, y) > 24) n++;
        for (let x = x1 - EDGE + 1; x <= x1; x++) if (al(x, y) > 24) n++;
      }
      const pct = n / (2 * EDGE * img.h) * 100;
      if (pct > worstPct) { worstPct = pct; worstK = k + 1; }
    }
    const msg = `${name}/${act} 角色没超框（最严重第 ${worstK} 格边缘实心 ${worstPct.toFixed(0)}%，上限 ${EDGE_LIMIT}%）`;
    if (ANIM_DEFAULT) {
      A(worstPct <= EDGE_LIMIT, msg);
    } else {
      // 逐帧关停中：animMap 里的历史素材只是数据留存，不该长期挂着红。
      // 但只要有人把总开关打开，这条立刻变成硬断言（上面的分支）——素材不合格会在 CI 里被拦住。
      console.log(worstPct <= EDGE_LIMIT ? 'PASS: ' + msg
        : `NOTE: ${name}/${act} 超框（第 ${worstK} 格边缘实心 ${worstPct.toFixed(0)}%）—— 逐帧已关停，重导素材后必须达标`);
    }
  }
}
A(sheetCount > 0, `animMap 里登记了 ${sheetCount} 张 spritesheet`);

/* ---------- 4. 回退与幂等 ---------- */
A(PS.mountAnimated(node(), '腐噜兽') === false, '无动画素材的形态返回 false（调用方回退静态立绘）');
A(PS.animOf('影刃兔·异变') === PS.animOf('影刃兔'), '「·异变」后缀回退到基础形态的动画');
// 切动作要拿【有 attack 素材】的形态验（血月神狐小样只有 idle）
const anim2 = PS.makeAnimNode(PS.animOf('影刃兔'), 'idle');
anim2.dataset.petName = '影刃兔';
let restarts = 0, plays = [];
const orig = PS.restartAnim, origPlay = PS.playFrames;
PS.restartAnim = function (n) { restarts++; return orig.call(this, n) };
PS.playFrames = function (s, f, dur, once) { plays.push({ f, dur, once }); };
PS.setAnim(anim2, 'attack');
A(restarts === 1 && anim2.dataset.anim === 'attack', '切到 attack 会换图并重播');
A(plays.length === 1 && plays[0].once === true, 'attack 播一遍就停（once=true，没有 CSS 的 forwards 空白问题）');
PS.setAnim(anim2, 'attack');
A(restarts === 1 && plays.length === 1, '重复切同一动作不重启动画（避免攻击途中被重置）');
PS.setAnim(anim2, 'idle');
A(restarts === 2 && /idle/.test(anim2.firstElementChild.style.backgroundImage), '切回 idle 换回 idle 图并重播');
A(plays.length === 2 && plays[1].once === false, '切回 idle 恢复无限循环（once=false）');
PS.restartAnim = orig; PS.playFrames = origPlay;

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

/* ---------- 7. 命中特效：已改用【素材版·脚底墨爆】，原来那套纯 CSS 的必须【不许回来】 ----------
 * 2026-09-21 用户要求「移除原来 css 做的那些特效」：它们和墨爆是同一件事的两套做法，同时播会糊成一团。
 * 这一节因此从"断言存在"翻成"**断言不存在**"——防止以后有人看代码里没有环就顺手加回来。
 * ⚠️ 断言"代码里没有"时**必须先剥掉 CSS 注释**：删除处留注释是必须的（下一个人要知道删了什么），
 *    但注释里出现的名字不该算"实现还在"。第一次写就踩了：注释里写了 @keyframes hit-ring 直接报红。 */
const cssCode = srcCss.replace(/\/\*[\s\S]*?\*\//g, '');
A(!cssCode.includes('@keyframes hit-ring') && !cssCode.includes('@keyframes hit-flash'),
  '原来的 CSS 命中特效（冲击环 hit-ring / 轮廓闪光 hit-flash）必须已经移除，不许长回来');
A(!/--sprite/.test(cssCode) && !/setProperty\('--sprite'/.test(srcBattle),
  '闪光层删掉后 --sprite 整条链路（CSS 的 mask-image 遮罩 + JS 两处写入）也要一并清掉，不许留死代码');
// filter 动画跑在合成器线程，主线程读不到插值、跨机器表现不一致，别再用回它做受击闪白
const hitKf = keyframesBlock(srcCss, 'pet-hit') + keyframesBlock(srcCss, 'pet-hit-crit');
A(!/filter:/.test(hitKf), '受击动作不用 filter 做闪白（合成器动画不可预期）');
// ⚠️ 暴击现在与普通命中共用同一套墨爆（用户选的"一套通用不分档"）⇒ 全屏反馈是暴击唯一的区分度，必须还在
A(srcCss.includes('@keyframes stage-shake') && /\.battle-stage\.crit-impact::after/.test(srcCss)
  && /flashStage\('stage-shake'/.test(srcBattle) && /flashStage\('crit-impact'/.test(srcBattle),
  '暴击的全屏区分度（舞台震屏 + 屏幕边缘红脉冲）必须保留 —— 它是暴击与普通命中唯一的差别');

/* ---------- 8. 逐帧立绘的 CSS 契约（2026-09-21 用户实测两个 bug 后补的守值）
 * 病因是同一个：动作类选择器只写了 `img.pet-breathe`，而逐帧立绘是 `div.pet-anim`。
 *   · 挂不上 ⇒ "跑到怪脸上那个动作没了"（没有前摇/冲锋/回位/受击形变）
 *   · 朝向那条依赖"素材朝哪边"，换素材最容易失效 ⇒ "宠物朝向反了"
 * ⇒ 这两件事以后必须由代码拦，不能靠人记得。 */
const ANIM_CSS_CASES = [['charging', '前摇蓄力'], ['attacking', '冲锋与回位'], ['hit', '受击后仰'], ['crit-hit', '暴击受击']];
for (const [cls, what] of ANIM_CSS_CASES) {
  const re = new RegExp('#tab-battle \\.stage-avatar\\.' + cls.replace('-', '\\-') + '\\s+\\.pet-anim');
  A(re.test(srcCss), `逐帧立绘也能播【${what}】（选择器里必须带上 .stage-avatar.${cls} .pet-anim，否则逐帧立绘这一套动作全没有）`);
}
const flipPetCss = srcCss.match(/#tab-battle \.fighter-pet \.stage-avatar \.pet-anim\s*\{[^}]*\}/);
A(!!flipPetCss, '显式声明了【我方逐帧立绘的朝向】（⚠️ 换逐帧素材后必须重新确认素材里角色朝哪边，注释已写明）');
A(!!flipPetCss && /--flip\s*:/.test(flipPetCss[0]) && /transform\s*:\s*var\(--flip/.test(flipPetCss[0]),
  '我方逐帧立绘的翻转走 --flip 变量（直接写 transform 会被冲锋/受击的 keyframes 整体覆盖 → 播动作时又翻回去）');
A(/#tab-battle \.fighter-enemy \.stage-avatar \.pet-anim\s*\{[^}]*\}/.test(srcCss),
  '敌方逐帧立绘的朝向也显式声明了（将来敌方用逐帧素材时不用现想）');
A(/\.pet-anim\s*\{[^}]*transform-origin\s*:\s*50%\s*88%/.test(srcCss),
  '逐帧立绘的形变支点与静态立绘一致（50% 88% ≈ 脚底，否则压扁/弹起看着像在飘）');

/* ---------- 9. 出手时序契约：冲过去 → 在脸上挥完 → 再退（2026-09-21 用户要求） ----------
 * 用户原话："跑到怪物脸上之后才播放出手动作" + "停在怪脸上挥完再退"。
 * 这三件事任何一件被改坏，观感都会退回"原地挥爪 / 边退边挥"，所以都要守住。 */
A(/--dash-hold/.test(srcCss) && /calc\(var\(--dash-out[^)]*\)\s*\+\s*var\(--dash-hold/.test(srcCss.replace(/\s+/g, ' ')),
  'CSS 的"回退"被滞空推后（dash-back 的 delay = dash-out + --dash-hold ⇒ 挥完才退）');
/* 🔴 两段位移动画都必须带 forwards：滞空那段空档里若没有 forwards，元素身上没有动画在写 transform
 * ⇒ 立刻回到原位，观感变成"冲到怪面前完全没有前停"（2026-09-21 实测踩到的坑）。 */
// ⚠️ 用 [^;]* 而不是 [^,;]*：`var(--dash-out, .42s)` 里就带逗号，按逗号截断会永远匹配不上
A(/pet-dash-out[^;]*forwards/.test(srcCss) && /pet-dash-back[^;]*forwards/.test(srcCss),
  '冲刺与回退两段都带 forwards（否则"滞空"期间宠物会弹回原位，看起来根本没有停）');
A(/setProperty\('--dash-hold'/.test(srcBattle), 'ui-battle.js 注入 --dash-hold（滞空时长来自逐帧攻击素材）');
const attackAnimIdx = srcBattle.indexOf("PetSprites.setAnim(node, 'attack')");
const contactIdx = srcBattle.indexOf('const contactMs = pace.charge + dashMs');
A(contactIdx > 0 && attackAnimIdx > contactIdx,
  '攻击帧是【冲到脸上才播】的（setAnim attack 必须写在 contactMs 定时器里，不能在函数开头就播）');
// ⚠️ 别只看第一处 `lastBackMs =`：文件里还有 `let lastBackMs = 0;` 的声明（那是初值，不含滞空）
const backLines = (srcBattle.match(/lastBackMs\s*=[^\n;]*/g) || []);
const backLine = backLines.find(l => /atkDurMs/.test(l)) || (backLines[0] || '');
A(backLines.some(l => /atkDurMs/.test(l)),
  `归位时长/行动条冻结必须把滞空算进去（现在的写法：${backLine.trim()}）—— 漏了会出现"人还贴在怪脸上，下一手已经在原地蓄力"`);

/* ---------- 10. 命中特效（脚底墨爆） ----------
 * 2026-09-21 按"一个文件一个职责"迁出：播放器 = js/fx/hit-fx.js、样式 = css/fx.css。
 * 这组守值钉住：播放驱动、触发口径、层级、素材 IHDR、缓存版本，以及【模块边界】（实现不许回流 ui-battle.js）。
 * 特别注意：不能只断言字符串存在；每条都要在实现被改坏时真实报红。 */
const srcFx = fs.readFileSync(path.join(ROOT, 'js', 'fx', 'hit-fx.js'), 'utf8');
const srcFxCss = fs.readFileSync(path.join(ROOT, 'css', 'fx.css'), 'utf8');
const fxStart = srcFx.indexOf('function play(');
const fxEnd = srcFx.indexOf('window.HitFx', fxStart);
const fxBody = fxStart >= 0 && fxEnd > fxStart ? srcFx.slice(fxStart, fxEnd) : '';
A(fxStart >= 0 && /setInterval/.test(fxBody) && /backgroundPositionX/.test(fxBody),
  '命中特效播放器在 js/fx/hit-fx.js 里，且由 JS setInterval + backgroundPositionX 驱动');
A(!/function playFx/.test(srcBattle) && !/FX_FRAMES/.test(srcBattle) && !/FX_DEFAULT_MS/.test(srcBattle),
  '命中特效实现不许回流 ui-battle.js（播放器要待在 js/fx/hit-fx.js —— 一个文件一个职责）');
A(/js\/fx\/hit-fx\.js\?v=/.test(srcHtml) && /css\/fx\.css\?v=/.test(srcHtml),
  '游戏.html 必须同时加载 fx 模块（js/fx/hit-fx.js）与它的样式（css/fx.css）');
const fxPosAssign = (fxBody.match(/backgroundPositionX\s*=\s*[^;\n]*/) || [''])[0];
A(/backgroundPositionX\s*=\s*[^;\n]*['"]px['"]/.test(fxPosAssign) && !/%/.test(fxPosAssign),
  `命中特效每帧位移使用像素单位（当前赋值：${fxPosAssign || '缺失'}），不使用百分比量程`);
/* ⭐ 特效节奏必须**跟出手动作对齐**（用户 2026-09-21：「你这个不应该和攻击对齐吗」）：
 * 帧间隔要从出手者的【攻击素材时长】算出来，不许硬编码一个拍脑袋的数
 * （曾经写成 45ms/帧 = 全程 405ms，被用户判为"播放的太快了"）。 */
const fxDurStart = srcFx.indexOf('function durationMs');
const fxDurBlock = fxDurStart >= 0 ? srcFx.slice(fxDurStart, fxDurStart + 600) : '';
A(!!fxDurBlock && /anim\.attack/.test(fxDurBlock) && /\.dur/.test(fxDurBlock),
  '特效时长由出手者攻击素材的 attack.dur 推导（与出手动作同一拍；换素材/改时长会自动跟着走）');
const fxFallback = /var DEFAULT_MS\s*=\s*(\d+)/.exec(srcFx);
A(!!fxFallback && Number(fxFallback[1]) >= 700,
  `没有逐帧攻击素材时的兜底时长 = ${fxFallback ? fxFallback[1] : '缺失'}ms，必须 ≥700（405ms 那版被用户判为"太快、看不清"）`);

const damageStart = srcBattle.indexOf('function showDamage');
const damageEnd = srcBattle.indexOf('/* ---------- 挂机状态徽章', damageStart);
const damageBlock = damageStart >= 0 && damageEnd > damageStart ? srcBattle.slice(damageStart, damageEnd) : '';
const fxTriggerLine = damageBlock.split(/\r?\n/).find(line => /HitFx\.play/.test(line)) || '';
A(/HitFx\.play/.test(fxTriggerLine) && /miss/.test(fxTriggerLine) && /lifesteal/.test(fxTriggerLine),
  `showDamage 里 HitFx.play 的触发口径同时排除 miss 与 lifesteal（当前行：${fxTriggerLine.trim() || '缺失'}）`);
const hitStart = srcBattle.indexOf('function animateHit');
const hitEnd = srcBattle.indexOf('/* 命中特效（脚底墨爆）已迁出本文件', hitStart);
const hitBlock = hitStart >= 0 && hitEnd > hitStart ? srcBattle.slice(hitStart, hitEnd) : '';
A(!/HitFx/.test(hitBlock), 'animateHit 不调用命中特效（避免 isMiss 判定前把闪避播成命中）');

const fxCss = srcFxCss.match(/#tab-battle \.stage-avatar \.hit-fx\s*\{[^}]*\}/);
A(!!fxCss && /position\s*:\s*absolute/.test(fxCss[0]) && /bottom\s*:/.test(fxCss[0])
  && /width\s*:\s*120%/.test(fxCss[0]) && /height\s*:\s*120%/.test(fxCss[0])
  && /pointer-events\s*:\s*none/.test(fxCss[0]) && /z-index\s*:\s*5/.test(fxCss[0]),
  '脚底墨爆 CSS 位置、尺寸、穿透与层级契约齐全');
A(!!fxCss && !/(?:animation|transition)\s*:/.test(fxCss[0]),
  '脚底墨爆 CSS 块不使用 animation 或 transition（避免 reduced-motion 压成静帧）');
const fxZ = fxCss && /z-index\s*:\s*(\d+)/.exec(fxCss[0]);
A(!!fxZ && Number(fxZ[1]) < 6, `脚底墨爆 z-index=${fxZ ? fxZ[1] : '缺失'}，必须低于 .fs-float 的 6`);
const fxClassJs = /className\s*=\s*['"]([^'"]+)['"]/.exec(fxBody);
const fxClassCss = fxCss && /\.hit-fx\b/.exec(fxCss[0]);
A(!!fxClassJs && fxClassJs[1] === 'hit-fx' && !!fxClassCss,
  `JS 创建类名与 CSS 选择器一致（JS=${fxClassJs ? fxClassJs[1] : '缺失'}，CSS=${fxClassCss ? 'hit-fx' : '缺失'}）`);

const fxPng = path.join(ROOT, 'assets', 'effects', 'hit-ink', '命中墨爆.png');
A(fs.existsSync(fxPng), '命中墨爆 PNG 素材文件存在');
const pngHead = fs.existsSync(fxPng) ? fs.readFileSync(fxPng).subarray(0, 33) : Buffer.alloc(0);
// ⚠️ PNG colorType：6 = RGBA、4 = 灰度+透明、2 = RGB。特效**必须带真透明通道**（6），
//    否则黑底会糊在立绘上（当初就是因为"图省事用 RGB + 混合模式"才改成抠通道的）。
const pngOk = pngHead.length === 33
  && pngHead.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  && pngHead.readUInt32BE(16) === 2304 && pngHead.readUInt32BE(20) === 256
  && pngHead[24] === 8 && pngHead[25] === 6;
A(pngOk,
  `命中墨爆 PNG IHDR 为 2304×256、bitDepth=8、colorType=6（RGBA，真透明通道）`);
// ⚠️ 版本号会各自往前走（只改 JS 就别动 CSS 的号，白拉 285KB 没意义）：
//   game.css      → fx4（fx3 之后又移走了命中特效的样式）
//   fx.css        → fx1（新文件：素材特效样式）
//   ui-battle.js  → fx6（fx5 = 命中特效迁出；fx6 = 敌方悬浮提示迁出）
//   hit-fx.js     → fx1（新文件：命中特效播放器）
//   ui-battle-tip.js → split1（新文件：敌方悬浮提示）
A(/css\/game\.css\?v=20260921fx4/.test(srcHtml)
  && /css\/fx\.css\?v=20260921fx1/.test(srcHtml)
  && /js\/ui\/ui-battle\.js\?v=20260921fx6/.test(srcHtml)
  && /js\/fx\/hit-fx\.js\?v=20260921fx1/.test(srcHtml)
  && /js\/ui\/ui-battle-tip\.js\?v=20260921split1/.test(srcHtml),
  '游戏.html 里 game.css(fx4)/fx.css(fx1)/ui-battle.js(fx6)/hit-fx.js(fx1)/ui-battle-tip.js(split1) 的版本号都要对（改了 JS/CSS 不升号=改了等于没改）');

/* ⭐ 立绘尺寸有【三处】要同步：基准（min(Npx, Ncqh)）/ 矮视口写死（@media max-height:880px）/ 变异怪写死。
 * 2026-09-21 用户"宠物素材有点小"的根因就是**矮视口那档把立绘锁死在 200px**，而基准那条
 * `min(350px,58cqh)` 在可视高度 ≤880px 的窗口里根本不生效 ⇒ 只改基准 = 改了等于没改。
 * 守这条：矮视口的写死值不得比基准小太多（倒挂 ⇒ 报红提醒你两处都要改）。 */
const petBase = /#tab-battle \.fighter-pet \.stage-avatar\s*\{[^}]*width\s*:\s*min\(\s*(\d+)px/.exec(srcCss);
const petShort = /@media \(max-height:\s*880px\)\s*\{[\s\S]*?#tab-battle \.fighter-pet \.stage-avatar\s*\{[^}]*width:\s*(\d+)px/.exec(srcCss);
A(!!petBase && !!petShort && Number(petShort[1]) / Number(petBase[1]) >= 0.6,
  `立绘尺寸要三处同步（基准 ${petBase ? petBase[1] : '?'}px / 矮视口写死 ${petShort ? petShort[1] : '?'}px）——矮视口那档太小的话，矮窗口里放大立绘等于没改`);

/* ---------- 11. 头像 vs 立绘：谁放哪个位置（2026-09-21 用户拍板 A） ----------
 * · **大图位**（战斗页 350px）= 逐帧**动画立绘**（要看动作）；
 * · **小肖像框**（资料页/装备页 `.pet-avatar` 158px、装备环绕 `.equip-orbit-art` 220px 圆框）= **头像版**（要看脸）。
 * 两处顺序**故意相反**，别顺手"统一"：一百多像素的框里塞全身立绘 = 一只小蚂蚁在动、脸都看不清；
 * 圆框还会把全身的头脚切掉。 */
const petJsSrc = fs.readFileSync(path.join(ROOT, 'js/ui/ui-pet.js'), 'utf8');
const avThenAnim = (petJsSrc.match(/mountAvatar\([a-z]+,\s*pet\.name\)\)\s*\{\}\s*\n\s*else if[^\n]*mountAnimated\([a-z]+,\s*pet\.name\)\)\s*\{\}/g) || []).length;
A(avThenAnim >= 3,
  `小肖像框必须是【头像版优先】（找到 ${avThenAnim} 处，要求 ≥3：资料页 pet-avatar / 装备页 eqp-avatar / 装备环绕 equip-orbit-art）`);
A(!/mountAnimated\([a-z]+,\s*pet\.name\)\)\s*\{\}\s*\n\s*else if[^\n]*mountAvatar/.test(petJsSrc),
  '小肖像框不许退回"动画立绘优先"（那是 2026-09-21 改掉的老写法：小框里放全身立绘看不清）');
A(/PetSprites\.mountAnimated\(el, n\)\) return true;/.test(srcBattle),
  '战斗页（350px 大位）必须【动画立绘优先】看动作 —— 与上面的小框顺序相反，这是刻意的');

console.log('\\nALL PET ANIM TESTS PASSED');
