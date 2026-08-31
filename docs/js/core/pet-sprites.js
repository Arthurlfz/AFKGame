/* 宠物形态名 -> 立绘/头像路径（由 meowa 生成素材，勿手改） */
window.PetSprites = {
  // 素材版本号：每次替换素材图片后递增，防止浏览器缓存旧图
  V: '20260830e',
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
  // 把一段动作素材画到节点上。
  // ⚠️ 图片 URL 必须写进 background-image 内联样式，不能塞进自定义属性：
  // 自定义属性里的相对 url() 由浏览器按【样式表所在目录】解析（会得到 /css/assets/... → 404），
  // 而内联样式的相对 url() 按【文档】解析，与 img.src 一致。
  paintAnim: function (node, a) {
    node.style.backgroundImage = "url('" + a.sheet + '?v=' + this.V + "')";
    // steps 取帧数本身：steps(N) end 模式呈现前 N 个采样点，配合 -N×100% 位移正好播满 N 帧
    node.style.setProperty('--af', a.frames);
    node.style.setProperty('--steps', a.frames);
    node.style.setProperty('--dur', a.dur || '1.6s');
  },
  // 换图/换动作后让 CSS 动画从头播：改 background-image 或 iteration-count 都不会重置已在运行的动画计时
  restartAnim: function (node) {
    node.style.animation = 'none';
    void node.offsetWidth;
    node.style.animation = '';
  },
  makeAnimNode: function (anim, act) {
    var a = anim[act] || anim.idle;
    if (!a || !a.sheet) return null;
    var d = document.createElement('div');
    d.className = 'pet-anim';
    d.dataset.anim = act;
    this.paintAnim(d, a);
    return d;
  },
  // 逐帧动画总开关。当前这批素材（pack3-shadowrabbit）实测不可用：
  // 6 帧的角色质心几乎不动（idle <0.3px、attack <1.2px），但相邻帧像素差异 37%~77%，
  // 高斯降噪后仍有 29%~73% —— 即角色没做动作，只是被 AI 重绘了 6 遍（毛发/光影每帧都变）。
  // 播放效果是闪烁而不是动作。关掉后全部形态走静态立绘 + CSS 变换动作（连贯）。
  // 数据保留在 animMap，以后拿到真正连贯的 spritesheet 把这里改回 true 即可。
  ANIM_ENABLED: false,
  // 挂动画立绘：成功 true；无动画素材（或逐帧关停）返回 false（调用方回退静态立绘）
  mountAnimated: function (el, name) {
    if (!el || !this.ANIM_ENABLED) return false;
    var anim = this.animOf(name);
    if (!anim || !anim.idle) return false;
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
    this.paintAnim(node, anim[act]);
    this.restartAnim(node);
  },
  map:
  {
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
  "幽魂犬皇": "assets/pets/pack8-corpsehound/monster-05.png"
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
  }
},
  avatarMap: {
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
  "幽魂犬皇": "assets/pets/avatars/pack8-corpsehound/幽魂犬皇.png"
}
};
