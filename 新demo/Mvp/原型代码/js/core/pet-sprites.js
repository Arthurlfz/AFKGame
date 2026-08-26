/* 宠物形态名 -> 立绘/头像路径（由 meowa 生成素材，勿手改） */
window.PetSprites = {
  // 素材版本号：每次替换素材图片后递增，防止浏览器缓存旧图
  V: '20260827f',
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
