/* 宠物形态名 -> 立绘/头像路径（由 meowa 生成素材，勿手改） */
window.PetSprites = {
  // 素材版本号：每次替换素材图片后递增，防止浏览器缓存旧图
  V: '20260921-godfox3',
  // 立绘（全身透明图）路径：查不到时自动去掉「·异变」后缀回退到基础形态
  pathOf: function (name) {
    if (!name) return null;
    var p = this.map[name] || (name.indexOf('·异变') > 0 ? this.map[name.replace('·异变','')] : null);
    return p ? p + '?v=' + this.V : null;
  },
  avatarOf: function (name) {
    if (!name) return null;
    var p = this.avatarMap[name] || (name.indexOf('·异变') > 0 ? this.avatarMap[name.replace('·异变','')] : null);
    return p ? p + '?v=' + this.V : null;
  },
  elm: function (name) {
    var p = this.pathOf(name);
    if (!p) return null;
    var img = document.createElement('img');
    img.src = p; img.alt = name || ''; img.className = 'pet-sprite';
    return img;
  },
  mount: function (el, name) {
    if (!el) return false;
    var img = this.elm(name);
    if (!img) return false;
    el.textContent = '';
    el.appendChild(img);
    return true;
  },
  mountAvatar: function (el, name) {
    if (!el) return false;
    var p = this.avatarOf(name);
    if (!p) return false;
    el.textContent = '';
    var img = document.createElement('img');
    img.src = p; img.alt = name || ''; img.className = 'pet-avatar-sprite';
    el.appendChild(img);
    return true;
  },
  /* ---------- 逐帧动画（meowa animate-run spritesheet） ---------- */
  // 形态名 -> { idle/attack: { sheet(单行帧图), frames(帧数), dur(单轮时长) } }
  animOf: function (name) {
    if (!name) return null;
    return this.animMap[name] || (name.indexOf('·异变') > 0 ? this.animMap[name.replace('·异变', '')] : null);
  },
  // 取（必要时创建）.pet-anim 里的帧条子节点。
  // 结构：.pet-anim（裁切层，＝目标容器大小） > .pet-anim-strip（帧条，宽 = 帧数×容器宽）
  stripOf: function (node) {
    if (!node) return null;
    var s = node.firstElementChild;
    if (s && s.className === 'pet-anim-strip') return s;
    s = document.createElement('div');
    s.className = 'pet-anim-strip';
    node.appendChild(s);
    return s;
  },
  // 🔴🔴 逐帧播放【不走 CSS animation】，由 JS 定时器直接写 transform。三条血泪教训：
  //   ① background-position 的百分比相对【容器宽−图宽】而不是图宽 ⇒ 位移必算错，
  //      整张图被推出容器（症状：只在每轮开头闪一帧）。
  //   ② 动画里放 CSS 变量（var(--steps) 等），一旦解析不出来症状是"立绘静帧"，
  //      不报任何错，肉眼分不出是动画坏了还是素材只有一帧。
  //   ③ 项目有两处系统级降压规则 design-tokens.css / market-cascade.css：
  //      @media (prefers-reduced-motion: reduce) { * { animation-duration:.01ms !important;
  //                                                    animation-iteration-count:1 !important } }
  //      开了「减少动态效果」的机器上，CSS 动画会被压成一瞬间播完 ⇒ 永远定格在第 1 帧；
  //      它带 !important，普通规则盖不动它（2026-09-21 血月神狐"完全不播放"的真凶）。
  //   JS 直驱 transform 不受以上任何一条影响，而且"有没有在动"能直接被读出来（好排查）。
  //   位移用【像素】：每格宽 = 容器 clientWidth，第 k 帧 = translateX(-k × 容器宽)，无百分比歧义。
  playFrames: function (strip, frames, durStr, once) {
    this.stopFrames(strip);
    var ms = ((parseFloat(durStr) || 1.6) * 1000) / frames;
    var i = 0;
    strip.__frameTimer = setInterval(function () {
      if (!strip.isConnected) {                       // 节点已被 renderAll 换掉：停表，不留悬挂定时器
        clearInterval(strip.__frameTimer);
        strip.__frameTimer = null;
        return;
      }
      // 宽每次现取：立绘尺寸是响应式的（min(280px,46cqh)），窗口一变化就跟上。
      // 拿到 0 时再退一步用 getBoundingClientRect：容器若不是块级布局，clientWidth 可能报 0
      // 而 rect 仍能给出真实宽度（宽度真为 0 就说明还没上屏，下个 tick 再试）。
      var box = strip.parentNode;
      var w = box ? (box.clientWidth || box.getBoundingClientRect().width) : 0;
      if (!w) return;
      var k = once ? Math.min(i, frames - 1) : (i % frames);
      strip.style.transform = 'translateX(' + (-k * w) + 'px)';
      i++;
      if (once && i >= frames) {                      // attack：播一遍就停，收招
        clearInterval(strip.__frameTimer);
        strip.__frameTimer = null;
      }
    }, ms);
  },
  stopFrames: function (strip) {
    if (strip && strip.__frameTimer) { clearInterval(strip.__frameTimer); strip.__frameTimer = null; }
  },
  // 把一段动作素材画到帧条上。
  // ⚠️ 图片 URL 必须写进 background-image 内联样式，不能塞进自定义属性：
  // 自定义属性里的相对 url() 由浏览器按【样式表所在目录】解析（会得到 /css/assets/... → 404），
  // 而内联样式的相对 url() 按【文档】解析，与 img.src 一致。
  paintAnim: function (node, a, act) {
    var strip = this.stripOf(node);
    if (!strip) return;
    var url = "url('" + a.sheet + '?v=' + this.V + "')";
    var sameSheet = (strip.style.backgroundImage === url);
    strip.style.backgroundImage = url;
    // 帧条撑成 帧数 倍容器宽 + background-size:100% 100% 铺满整条 ⇒ 每格正好是一帧宽
    strip.style.width = (a.frames * 100) + '%';
    /* 🔴 同一张图且已经在播时【绝不重新开始】。
     * 播放器的帧号是它自己数的，一旦被重新调用就从第 0 帧重来 ——
     * 战斗页每场 resetBattle、每次 renderAll 都可能重挂一次，
     * 重开频率只要快过一轮时长，动作就永远停在开头几帧，看起来就是"完全不动"
     * （2026-09-21 实测：诊断显示 transform 恒为 translateX(0px)）。 */
    if (sameSheet && strip.__frameTimer && act !== 'attack') return;
    this.playFrames(strip, a.frames, a.dur || '1.6s', act === 'attack');
  },
  // 换图/换动作后立刻回到第 1 帧（避免切换时还定在上一张图的某一格）
  restartAnim: function (node) {
    var strip = node && node.firstElementChild;
    if (!strip) return;
    strip.style.transform = 'translateX(0)';
    void node.offsetWidth;
  },
  makeAnimNode: function (anim, act) {
    var a = anim[act] || anim.idle;
    if (!a || !a.sheet) return null;
    var d = document.createElement('div');
    d.className = 'pet-anim';
    d.dataset.anim = act;
    this.paintAnim(d, a, act);
    return d;
  },
  // 逐帧动画【总开关】：关着 = 全站一律回退静态立绘（+ CSS 变换动作）。
  // ✅ 2026-09-21 已启用（血月神狐重做上线：每格左右 8px 条带不透明 0%，守值达标）。
  // 历史教训（留着，别再犯）：
  //   ① pack3-shadowrabbit（影刃兔/霜影兔 6 帧）：角色质心几乎不动，但相邻帧像素差 37%~77%
  //      —— 是"被 AI 重绘了 6 遍"而不是动作，播起来是闪烁（那两条登记还留着，质量未复核）。
  //   ② 血月神狐旧 24 帧：生成时镜头贴着狐，尾巴一摆动就出画被切平；三种源都一样，救不回来。
  //   ⇒ 现在这条路：**先出"留白合格"的源图（用工具量，不靠肉眼）→ 再做动**；
  //      且**一次 3×3 九格生图** → 切格 → repack-sheet 统一取景（同一缩放同一位置）压掉抖动。
  ANIM_ENABLED: true,
  // 挂动画立绘：成功 true；无动画素材（或逐帧关停）返回 false（调用方回退静态立绘）
  mountAnimated: function (el, name) {
    if (!el) return false;
    if (!this.ANIM_ENABLED) return false;   // 总开关关着：一律回退静态立绘
    var anim = this.animOf(name);
    if (!anim || !anim.idle) return false;
    /* 已经是同一只宠的同一段动画 → 原样返回，绝不重建。
     * 战斗页每场 resetBattle / 每次 renderAll 都会走到这里，重建一个新节点
     * 会把播放进度拉回第 1 帧 ⇒ 一轮 2.4 秒的动作永远播不完，玩家看到的就是"一直不动"。
     * ⚠️ 用 querySelector 找而不是 firstElementChild：#pet-icon 里还会被塞进飘字等别的子节点，
     * 谁先谁后不确定，靠"第一个子节点"判断会漏。 */
    var cur = el.querySelector ? el.querySelector('.pet-anim') : null;
    if (cur && cur.dataset.petName === name) {
      var s = cur.firstElementChild;
      if (s && s.__frameTimer) return true;
    }
    var node = this.makeAnimNode(anim, 'idle');
    if (!node) return false;
    node.dataset.petName = name;
    el.textContent = '';
    el.appendChild(node);
    return true;
  },
  // 切换已挂载动画节点的动作（idle <-> attack）；无对应动作时保持现状
  setAnim: function (node, act) {
    if (!node || !act || node.dataset.anim === act) return;
    var anim = node.dataset.petName && this.animOf(node.dataset.petName);
    if (!anim || !anim[act]) return;
    node.dataset.anim = act;
    this.paintAnim(node, anim[act], act);
    this.restartAnim(node);
  },
  map:
  {
  "墨灵": "assets/pets/pack9-moyuan/墨灵.png",
  "墨影": "assets/pets/pack9-moyuan/墨影.png",
  "墨煞": "assets/pets/pack9-moyuan/墨煞.png",
  "墨渊魔君": "assets/pets/pack9-moyuan/墨渊魔君.png",
  "腐噜兽": "assets/pets/pack0-base/monster-00.png",
  "血狐": "assets/pets/pack0-base/monster-01.png",
  "瘟熊": "assets/pets/pack0-base/monster-02.png",
  "疫毛兽": "assets/pets/pack0-base/monster-03.png",
  "骨狼": "assets/pets/pack0-base/monster-04.png",
  "毒沼蛙": "assets/pets/pack0-base/monster-05.png",
  "尸犬": "assets/pets/pack0-base/monster-06.png",
  "幽影兔": "assets/pets/pack0-base/monster-07.png",
  "血牙狐": "assets/pets/pack1-bloodfox/monster-00.png",
  "幽火狐": "assets/pets/pack1-bloodfox/monster-01.png",
  "血灾领主": "assets/pets/pack1-bloodfox/monster-02.png",
  "幽火王": "assets/pets/pack1-bloodfox/monster-03.png",
  "血月魔狐": "assets/pets/pack1-bloodfox/monster-04.png",
  "幽火魔狐": "assets/pets/pack1-bloodfox/monster-05.png",
  "血狐·异变": "assets/pets/pack1-bloodfox/monster-06.png",
  "骨刃狼": "assets/pets/pack2-bonewolf/monster-00.png",
  "冥霜狼": "assets/pets/pack2-bonewolf/monster-01.png",
  "骨刃王": "assets/pets/pack2-bonewolf/monster-02.png",
  "霜狼祭司": "assets/pets/pack2-bonewolf/monster-03.png",
  "骸骨君主": "assets/pets/pack2-bonewolf/monster-04.png",
  "霜寒领主": "assets/pets/pack2-bonewolf/monster-05.png",
  "骨狼·异变": "assets/pets/pack2-bonewolf/monster-06.png",
  "影刃兔": "assets/pets/pack3-shadowrabbit/monster-00.png",
  "霜影兔": "assets/pets/pack3-shadowrabbit/monster-01.png",
  "影舞者": "assets/pets/pack3-shadowrabbit/monster-02.png",
  "霜影魔兔": "assets/pets/pack3-shadowrabbit/monster-03.png",
  "影蚀魔君": "assets/pets/pack3-shadowrabbit/monster-04.png",
  "霜魂兔皇": "assets/pets/pack3-shadowrabbit/monster-05.png",
  "幽影兔·异变": "assets/pets/pack3-shadowrabbit/monster-06.png",
  "瘟甲熊": "assets/pets/pack4-plaguebear/monster-00.png",
  "血瘟熊": "assets/pets/pack4-plaguebear/monster-01.png",
  "瘟神巨熊": "assets/pets/pack4-plaguebear/monster-02.png",
  "血疫暴君": "assets/pets/pack4-plaguebear/monster-03.png",
  "瘟疫之主": "assets/pets/pack4-plaguebear/monster-04.png",
  "血瘟暴君": "assets/pets/pack4-plaguebear/monster-05.png",
  "瘟熊·异变": "assets/pets/pack4-plaguebear/monster-06.png",
  "腐沼兽": "assets/pets/pack5-rotten/monster-00.png",
  "毒噜兽": "assets/pets/pack5-rotten/monster-01.png",
  "腐沼王": "assets/pets/pack5-rotten/monster-02.png",
  "毒沼霸主": "assets/pets/pack5-rotten/monster-03.png",
  "腐烂之母": "assets/pets/pack5-rotten/monster-04.png",
  "剧毒魔君": "assets/pets/pack5-rotten/monster-05.png",
  "疫刺兽": "assets/pets/pack6-plaguecat/monster-00.png",
  "冥毛兽": "assets/pets/pack6-plaguecat/monster-01.png",
  "疫魔刺龙": "assets/pets/pack6-plaguecat/monster-02.png",
  "冥幽兽": "assets/pets/pack6-plaguecat/monster-03.png",
  "刺骨魔兽": "assets/pets/pack6-plaguecat/monster-04.png",
  "幽冥疫君": "assets/pets/pack6-plaguecat/monster-05.png",
  "毒沼王": "assets/pets/pack7-bogfrog/monster-00.png",
  "咒沼蛙": "assets/pets/pack7-bogfrog/monster-01.png",
  "毒沼魔君": "assets/pets/pack7-bogfrog/monster-02.png",
  "咒毒蛙王": "assets/pets/pack7-bogfrog/monster-03.png",
  "剧毒魔神": "assets/pets/pack7-bogfrog/monster-04.png",
  "深渊蛙帝": "assets/pets/pack7-bogfrog/monster-05.png",
  "尸牙犬": "assets/pets/pack8-corpsehound/monster-00.png",
  "幽灵犬": "assets/pets/pack8-corpsehound/monster-01.png",
  "尸魔犬王": "assets/pets/pack8-corpsehound/monster-02.png",
  "幽冥猎犬": "assets/pets/pack8-corpsehound/monster-03.png",
  "尸界狱主": "assets/pets/pack8-corpsehound/monster-04.png",
  "幽魂犬皇": "assets/pets/pack8-corpsehound/monster-05.png",
  /* 变异立绘（mut1-rotten：腐噜兽家族 7 个异变形态，manifest.json 对号入座） */
  "腐噜兽·异变": "assets/pets/mut1-rotten/mut-00.png",
  "腐沼兽·异变": "assets/pets/mut1-rotten/mut-01.png",
  "毒噜兽·异变": "assets/pets/mut1-rotten/mut-02.png",
  "腐沼王·异变": "assets/pets/mut1-rotten/mut-03.png",
  "毒沼霸主·异变": "assets/pets/mut1-rotten/mut-04.png",
  "腐烂之母·异变": "assets/pets/mut1-rotten/mut-05.png",
  "剧毒魔君·异变": "assets/pets/mut1-rotten/mut-06.png",
  /* 神级宠（外观复用该线终形态立绘，config.godPets.sprite 同源；接进映射表让战斗页/地图页等
   * 所有按名字取图的路径统一解析，不必每处单独写 godInfoOf 兜底） */
  "腐界母神": "assets/pets/pack5-rotten/monster-04.png",
  /* 2026-09-21：血月神狐换成【水墨站立拟人】专属立绘（512×512，源图 1024×1536 → 工具面积平均降采样）。
   * 不再复用血月魔狐的图；config.godPets.sprite 保持 "血月魔狐" 不动（它只用于查技能，与图片无关）。 */
  "血月神狐": "assets/pets/god/bloodmoonfox/血月神狐.png",
  "疫神巨像": "assets/pets/pack4-plaguebear/monster-04.png",
  "万刺冥神": "assets/pets/pack6-plaguecat/monster-04.png",
  "骸骨神狼": "assets/pets/pack2-bonewolf/monster-04.png",
  "毒渊神蟾": "assets/pets/pack7-bogfrog/monster-04.png",
  "狱门神犬": "assets/pets/pack8-corpsehound/monster-04.png",
  "霜月神兔": "assets/pets/pack3-shadowrabbit/monster-04.png"
},
  /* 逐帧动画素材：meowa animate-run 生成的 spritesheet（网格帧），帧尺寸 256×256、6 帧 3×2
   * 只有具备动画素材的形态才会动，其余形态回退静态立绘（mount/mountAvatar）。 */
  animMap: {
  "影刃兔": {
    idle:   { sheet: "assets/pets/anim/pack3-shadowrabbit/monster-00-idle.png",   frames: 6, dur: "1.8s" },
    attack: { sheet: "assets/pets/anim/pack3-shadowrabbit/monster-00-attack.png", frames: 6, dur: "0.7s" }
  },
  "霜影兔": {
    idle:   { sheet: "assets/pets/anim/pack3-shadowrabbit/monster-01-idle.png",   frames: 6, dur: "1.8s" },
    attack: { sheet: "assets/pets/anim/pack3-shadowrabbit/monster-01-attack.png", frames: 6, dur: "0.7s" }
  },
  /* 血月神狐（2026-09-21 重做上线）：水墨站立拟人。**一次生图出 3×3 九格**（画布只有生图模型、
   * 没有视频模型）→ 切格 → 拼成单行 → repack-sheet 统一取景（同一缩放同一位置，压掉抖动）。
   * 1~3 格站立 = 待机；4~9 格 = 抬手蓄力 → 猫腰下劈 → 收招。源图留在
   * docs/assets/pets/god/bloodmoonfox/_源-9格动作图.png（要重切时从它来）。 */
  "血月神狐": {
    idle:   { sheet: "assets/pets/god/bloodmoonfox/血月神狐-idle.png",   frames: 3, dur: "2.4s" },
    attack: { sheet: "assets/pets/god/bloodmoonfox/血月神狐-attack.png", frames: 6, dur: "0.8s" }
  }
},
  avatarMap: {
  "墨灵": "assets/pets/avatars/pack9-moyuan/墨灵.png",
  "墨影": "assets/pets/avatars/pack9-moyuan/墨影.png",
  "墨煞": "assets/pets/avatars/pack9-moyuan/墨煞.png",
  "墨渊魔君": "assets/pets/avatars/pack9-moyuan/墨渊魔君.png",
  "腐噜兽": "assets/pets/avatars/pack0-base/腐噜兽.png",
  "血狐": "assets/pets/avatars/pack0-base/血狐.png",
  "瘟熊": "assets/pets/avatars/pack0-base/瘟熊.png",
  "疫毛兽": "assets/pets/avatars/pack0-base/疫毛兽.png",
  "骨狼": "assets/pets/avatars/pack0-base/骨狼.png",
  "毒沼蛙": "assets/pets/avatars/pack0-base/毒沼蛙.png",
  "尸犬": "assets/pets/avatars/pack0-base/尸犬.png",
  "幽影兔": "assets/pets/avatars/pack0-base/幽影兔.png",
  "血牙狐": "assets/pets/avatars/pack1-bloodfox/血牙狐.png",
  "幽火狐": "assets/pets/avatars/pack1-bloodfox/幽火狐.png",
  "血灾领主": "assets/pets/avatars/pack1-bloodfox/血灾领主.png",
  "幽火王": "assets/pets/avatars/pack1-bloodfox/幽火王.png",
  "血月魔狐": "assets/pets/avatars/pack1-bloodfox/血月魔狐.png",
  "幽火魔狐": "assets/pets/avatars/pack1-bloodfox/幽火魔狐.png",
  "血狐·异变": "assets/pets/avatars/pack1-bloodfox/血狐·异变.png",
  "骨刃狼": "assets/pets/avatars/pack2-bonewolf/骨刃狼.png",
  "冥霜狼": "assets/pets/avatars/pack2-bonewolf/冥霜狼.png",
  "骨刃王": "assets/pets/avatars/pack2-bonewolf/骨刃王.png",
  "霜狼祭司": "assets/pets/avatars/pack2-bonewolf/霜狼祭司.png",
  "骸骨君主": "assets/pets/avatars/pack2-bonewolf/骸骨君主.png",
  "霜寒领主": "assets/pets/avatars/pack2-bonewolf/霜寒领主.png",
  "骨狼·异变": "assets/pets/avatars/pack2-bonewolf/骨狼·异变.png",
  "影刃兔": "assets/pets/avatars/pack3-shadowrabbit/影刃兔.png",
  "霜影兔": "assets/pets/avatars/pack3-shadowrabbit/霜影兔.png",
  "影舞者": "assets/pets/avatars/pack3-shadowrabbit/影舞者.png",
  "霜影魔兔": "assets/pets/avatars/pack3-shadowrabbit/霜影魔兔.png",
  "影蚀魔君": "assets/pets/avatars/pack3-shadowrabbit/影蚀魔君.png",
  "霜魂兔皇": "assets/pets/avatars/pack3-shadowrabbit/霜魂兔皇.png",
  "幽影兔·异变": "assets/pets/avatars/pack3-shadowrabbit/幽影兔·异变.png",
  "瘟甲熊": "assets/pets/avatars/pack4-plaguebear/瘟甲熊.png",
  "血瘟熊": "assets/pets/avatars/pack4-plaguebear/血瘟熊.png",
  "瘟神巨熊": "assets/pets/avatars/pack4-plaguebear/瘟神巨熊.png",
  "血疫暴君": "assets/pets/avatars/pack4-plaguebear/血疫暴君.png",
  "瘟疫之主": "assets/pets/avatars/pack4-plaguebear/瘟疫之主.png",
  "血瘟暴君": "assets/pets/avatars/pack4-plaguebear/血瘟暴君.png",
  "瘟熊·异变": "assets/pets/avatars/pack4-plaguebear/瘟熊·异变.png",
  "腐沼兽": "assets/pets/avatars/pack5-rotten/腐沼兽.png",
  "毒噜兽": "assets/pets/avatars/pack5-rotten/毒噜兽.png",
  "腐沼王": "assets/pets/avatars/pack5-rotten/腐沼王.png",
  "毒沼霸主": "assets/pets/avatars/pack5-rotten/毒沼霸主.png",
  "腐烂之母": "assets/pets/avatars/pack5-rotten/腐烂之母.png",
  "剧毒魔君": "assets/pets/avatars/pack5-rotten/剧毒魔君.png",
  "疫刺兽": "assets/pets/avatars/pack6-plaguecat/疫刺兽.png",
  "冥毛兽": "assets/pets/avatars/pack6-plaguecat/冥毛兽.png",
  "疫魔刺龙": "assets/pets/avatars/pack6-plaguecat/疫魔刺龙.png",
  "冥幽兽": "assets/pets/avatars/pack6-plaguecat/冥幽兽.png",
  "刺骨魔兽": "assets/pets/avatars/pack6-plaguecat/刺骨魔兽.png",
  "幽冥疫君": "assets/pets/avatars/pack6-plaguecat/幽冥疫君.png",
  "毒沼王": "assets/pets/avatars/pack7-bogfrog/毒沼王.png",
  "咒沼蛙": "assets/pets/avatars/pack7-bogfrog/咒沼蛙.png",
  "毒沼魔君": "assets/pets/avatars/pack7-bogfrog/毒沼魔君.png",
  "咒毒蛙王": "assets/pets/avatars/pack7-bogfrog/咒毒蛙王.png",
  "剧毒魔神": "assets/pets/avatars/pack7-bogfrog/剧毒魔神.png",
  "深渊蛙帝": "assets/pets/avatars/pack7-bogfrog/深渊蛙帝.png",
  "尸牙犬": "assets/pets/avatars/pack8-corpsehound/尸牙犬.png",
  "幽灵犬": "assets/pets/avatars/pack8-corpsehound/幽灵犬.png",
  "尸魔犬王": "assets/pets/avatars/pack8-corpsehound/尸魔犬王.png",
  "幽冥猎犬": "assets/pets/avatars/pack8-corpsehound/幽冥猎犬.png",
  "尸界狱主": "assets/pets/avatars/pack8-corpsehound/尸界狱主.png",
  "幽魂犬皇": "assets/pets/avatars/pack8-corpsehound/幽魂犬皇.png",
  /* 变异头像（mut1-rotten） */
  "腐噜兽·异变": "assets/pets/avatars/mut1-rotten/腐噜兽·异变.png",
  "腐沼兽·异变": "assets/pets/avatars/mut1-rotten/腐沼兽·异变.png",
  "毒噜兽·异变": "assets/pets/avatars/mut1-rotten/毒噜兽·异变.png",
  "腐沼王·异变": "assets/pets/avatars/mut1-rotten/腐沼王·异变.png",
  "毒沼霸主·异变": "assets/pets/avatars/mut1-rotten/毒沼霸主·异变.png",
  "腐烂之母·异变": "assets/pets/avatars/mut1-rotten/腐烂之母·异变.png",
  "剧毒魔君·异变": "assets/pets/avatars/mut1-rotten/剧毒魔君·异变.png",
  /* 神级宠头像（同上：复用该线终形态） */
  "腐界母神": "assets/pets/avatars/pack5-rotten/腐烂之母.png",
  /* 2026-09-21：神狐专属头肩像（从同一张定稿裁出，256×256），不再复用血月魔狐头像 */
  "血月神狐": "assets/pets/god/bloodmoonfox/血月神狐-头像.png",
  "疫神巨像": "assets/pets/avatars/pack4-plaguebear/瘟疫之主.png",
  "万刺冥神": "assets/pets/avatars/pack6-plaguecat/刺骨魔兽.png",
  "骸骨神狼": "assets/pets/avatars/pack2-bonewolf/骸骨君主.png",
  "毒渊神蟾": "assets/pets/avatars/pack7-bogfrog/剧毒魔神.png",
  "狱门神犬": "assets/pets/avatars/pack8-corpsehound/尸界狱主.png",
  "霜月神兔": "assets/pets/avatars/pack3-shadowrabbit/影蚀魔君.png"
}
};
