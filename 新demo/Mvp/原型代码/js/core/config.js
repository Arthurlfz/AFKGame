/* ============================================================
 * config.js —— 全部游戏数值集中配置（最先加载）
 * 用法：改这里的数字即可调数值，无需动任何逻辑代码。
 * 注意：本文件必须在所有模块之前加载（游戏.html 中第一个 script）。
 * ============================================================ */
window.Config = {

  /* ================= 宠物 ================= */
  pet: {
    // 新玩家必须在 8 只基宠中选择 1 只；老存档中的莱姆仍可正常读取
    // 每只基宠带差异化基础值(baseHp/baseAtk/baseDef) + 独立速度(speeds) + 成长系数(statCoeff)，
    // 定位不同：坦克/输出/敏捷/控制/均衡。进化体/变异宠/融合宠继承来源基宠的 statCoeff（lineId 决定）。
    starters: [
      { name: '腐噜兽', icon: '🐹', growth: 5, baseHp: 110, baseAtk: 22, baseDef: 11, statCoeff: { hp: 5, atk: 2, def: 1 } }, // 均衡
      { name: '血狐',   icon: '🦊', growth: 5, baseHp: 85,  baseAtk: 30, baseDef: 8,  statCoeff: { hp: 3, atk: 3.5, def: 1 } }, // 爆发输出
      { name: '瘟熊',   icon: '🐻', growth: 5, baseHp: 160, baseAtk: 18, baseDef: 18, statCoeff: { hp: 7, atk: 1.5, def: 2.5 } }, // 坦克
      { name: '疫毛兽', icon: '🐱', growth: 5, baseHp: 95,  baseAtk: 26, baseDef: 9,  statCoeff: { hp: 4, atk: 3, def: 1 } }, // 敏捷输出
      { name: '骨狼',   icon: '🐺', growth: 5, baseHp: 105, baseAtk: 25, baseDef: 10, statCoeff: { hp: 5, atk: 2.5, def: 1.2 } }, // 均衡偏输出
      { name: '毒沼蛙', icon: '🐸', growth: 5, baseHp: 130, baseAtk: 20, baseDef: 14, statCoeff: { hp: 6, atk: 1.8, def: 2 } }, // 控制坦克
      { name: '尸犬',   icon: '🐶', growth: 5, baseHp: 120, baseAtk: 21, baseDef: 13, statCoeff: { hp: 6, atk: 2, def: 1.8 } }, // 均衡偏坦
      { name: '幽影兔', icon: '🐰', growth: 5, baseHp: 70,  baseAtk: 24, baseDef: 7,  statCoeff: { hp: 2.5, atk: 3.5, def: 0.8 } }  // 极速脆皮
    ],
    // 旧莱姆只作为历史存档/孵化兼容基准，不再作为新玩家默认初始宠物
    legacyBase: { name: '莱姆', icon: '🟢', growth: 5, hp: 100, atk: 20, def: 10, spd: 40 },
    // 属性公式（《游戏设计理念》5.2）：
    //   生命 = 基础生命 + 等级 × 成长值 × 生命系数（攻击/防御同理）
    // 系数集中在此；以后新宠物只需写 3 个基础值（baseHp/baseAtk/baseDef）
    // 注意：速度不走此公式 —— 速度 = 宠物基础速度（speeds 表）+ 装备加成，成长值/等级不参与
    statCoeff: { hp: 5, atk: 2, def: 1 },
    // 单宠刷怪定位：强项越突出，其他输出乘区越收敛；定位与暴击参数在宠物页公开展示。
    petProfiles: {
      '腐噜兽': { role: '均衡快刷', description: '属性平均，适合前期稳定挂机；没有单项极限。', critRate: 8, critDamage: 145, hit: 90, dodge: 5, lifesteal: 0 },
      '血狐': { role: '暴击爆发', description: '暴击率和暴击伤害最高，单次输出波动大；攻击速度不高。', critRate: 18, critDamage: 190, hit: 92, dodge: 5, lifesteal: 0 },
      '瘟熊': { role: '重甲稳刷', description: '生命、防御最高，适合承受强力敌人持续挂机；攻击速度和爆发偏低。', critRate: 5, critDamage: 135, hit: 95, dodge: 2, lifesteal: 4 },
      '疫毛兽': { role: '敏捷输出', description: '攻击速度较高，攻击与暴击适中；适合快速清理普通敌人。', critRate: 9, critDamage: 150, hit: 92, dodge: 8, lifesteal: 0 },
      '骨狼': { role: '攻击均衡', description: '攻击较高、速度中等，单次伤害和刷怪稳定性平衡。', critRate: 11, critDamage: 160, hit: 92, dodge: 5, lifesteal: 2 },
      '毒沼蛙': { role: '耐久输出', description: '生命、防御较高，牺牲部分速度换取持续作战能力。', critRate: 6, critDamage: 140, hit: 95, dodge: 8, lifesteal: 3 },
      '尸犬': { role: '稳定快刷', description: '速度、攻击和耐久均衡，适合长时间挂机。', critRate: 8, critDamage: 150, hit: 90, dodge: 6, lifesteal: 3 },
      '幽影兔': { role: '极速连击', description: '攻击速度为 110，依靠高频出手清理普通敌人；攻击、暴击率和暴击伤害偏低。', critRate: 4, critDamage: 130, hit: 88, dodge: 12, lifesteal: 0 }
    },
    defaultPetProfile: { role: '均衡型', description: '属性较为平均的单宠挂机伙伴。', critRate: 8, critDamage: 150, hit: 90, dodge: 5, lifesteal: 0 },
    // 每只宠物独立基础速度（新速度规则核心）：
    //   宠物速度 = 该表数值 + 装备加成（饰品基底速度 + 速度词缀），成长值不再参与
    // 数值范围 20~120：坦克 20~40 / 均衡 45~75 / 敏捷 80~110；异变宠独立配置（成长值优势不变）
    speeds: {
      '莱姆': 40,        // 初始宠，中庸
      '腐噜兽': 55,      // 中速偏慢
      '疫毛兽': 85,      // 敏捷
      '尸犬': 65,        // 中速
      '血狐': 95,        // 快速
      '骨狼': 75,        // 快速偏中
      '幽影兔': 110,     // 极速（全游最快）
      '瘟熊': 30,        // 坦克，最慢
      '毒沼蛙': 45,      // 慢速
      // 异变宠（X·异变）速度沿用本体：getBaseSpeed 会去掉「·异变」后缀查原速，无需在此逐条列
      // 进化体：速度沿用对应基宠（进化只提升成长值，速度按名查表不变）
      '腐沼兽': 55, '毒噜兽': 55, '血牙狐': 95, '幽火狐': 95,
      '瘟甲熊': 30, '血瘟熊': 30, '疫刺兽': 85, '冥毛兽': 85,
      '骨刃狼': 75, '冥霜狼': 75, '毒沼王': 45, '咒沼蛙': 45,
      '尸牙犬': 65, '幽灵犬': 65, '影刃兔': 110, '霜影兔': 110
    },
    // 等级上限（到顶后经验条保持满，不再升级）。
    // 放开到 100：为后续更多大陆/更高级图铺路，玩家等级能持续涨。
    // 注意：融合要求 ≥ merge.minLevel（40），上限必须 ≥ 融合门槛。
    maxLevel: 100,
    // 孵化的新宠物成长值范围
    babyGrowth: { min: 3, max: 8 },
    // 进化系统：通用素材 + 可配置多层分叉树；每段独立配置等级门槛
    evolution: {
      maxEvolveTimes: 10,
      materialName: '进化素材',
      // 进化成长提升压到极小（每次 +0.1~0.2，10次最多 +2）：对齐口袋精灵2「普通进化成长基本不动，
      // 成长主要靠合成/涅槃(大后期)暴涨」的机制，避免中期进化几次就把成长从 4 叠到 10 导致同等级碾压秒怪。
      // 进化现在主要价值 = 换形态/小幅变强，成长质变交给融合(合成)与涅槃。
      growthBoost: [0.1, 0.2],
      tree: {
        '腐噜兽': [ { to: '腐沼兽', icon: '🐸', minLevel: 10 }, { to: '毒噜兽', icon: '🐹', minLevel: 10 } ],
        '血狐': [ { to: '血牙狐', icon: '🦷', minLevel: 10 }, { to: '幽火狐', icon: '🔥', minLevel: 10 } ],
        '瘟熊': [ { to: '瘟甲熊', icon: '🛡', minLevel: 10 }, { to: '血瘟熊', icon: '🩸', minLevel: 10 } ],
        '疫毛兽': [ { to: '疫刺兽', icon: '🌵', minLevel: 10 }, { to: '冥毛兽', icon: '🌑', minLevel: 10 } ],
        '骨狼': [ { to: '骨刃狼', icon: '🗡', minLevel: 10 }, { to: '冥霜狼', icon: '❄', minLevel: 10 } ],
        '毒沼蛙': [ { to: '毒沼王', icon: '👑', minLevel: 10 }, { to: '咒沼蛙', icon: '🌀', minLevel: 10 } ],
        '尸犬': [ { to: '尸牙犬', icon: '🦷', minLevel: 10 }, { to: '幽灵犬', icon: '👻', minLevel: 10 } ],
        '幽影兔': [ { to: '影刃兔', icon: '🌙', minLevel: 10 }, { to: '霜影兔', icon: '🧊', minLevel: 10 } ],
        '腐沼兽': [ { to: '腐沼王', icon: '🐸', minLevel: 25 } ],
        '毒噜兽': [ { to: '毒沼霸主', icon: '🐹', minLevel: 25 } ],
        '腐沼王': [ { to: '腐烂之母', icon: '👑', minLevel: 40 } ],
        '毒沼霸主': [ { to: '剧毒魔君', icon: '☠', minLevel: 40 } ],
        '血牙狐': [ { to: '血灾领主', icon: '🦷', minLevel: 25 } ],
        '幽火狐': [ { to: '幽火王', icon: '🔥', minLevel: 25 } ],
        '血灾领主': [ { to: '血月魔狐', icon: '🌕', minLevel: 40 } ],
        '幽火王': [ { to: '幽火魔狐', icon: '🌑', minLevel: 40 } ],
        '瘟甲熊': [ { to: '瘟神巨熊', icon: '🛡', minLevel: 25 } ],
        '血瘟熊': [ { to: '血疫暴君', icon: '🩸', minLevel: 25 } ],
        '瘟神巨熊': [ { to: '瘟疫之主', icon: '☠', minLevel: 40 } ],
        '血疫暴君': [ { to: '血瘟暴君', icon: '🩸', minLevel: 40 } ],
        '疫刺兽': [ { to: '疫魔刺龙', icon: '🌵', minLevel: 25 } ],
        '冥毛兽': [ { to: '冥幽兽', icon: '🌑', minLevel: 25 } ],
        '疫魔刺龙': [ { to: '刺骨魔兽', icon: '🦴', minLevel: 40 } ],
        '冥幽兽': [ { to: '幽冥疫君', icon: '🌒', minLevel: 40 } ],
        '骨刃狼': [ { to: '骨刃王', icon: '⚔', minLevel: 25 } ],
        '冥霜狼': [ { to: '霜狼祭司', icon: '🧙', minLevel: 25 } ],
        '骨刃王': [ { to: '骸骨君主', icon: '💀', minLevel: 40 } ],
        '霜狼祭司': [ { to: '霜寒领主', icon: '❄', minLevel: 40 } ],
        '毒沼王': [ { to: '毒沼魔君', icon: '👑', minLevel: 25 } ],
        '咒沼蛙': [ { to: '咒毒蛙王', icon: '🌀', minLevel: 25 } ],
        '毒沼魔君': [ { to: '剧毒魔神', icon: '🧪', minLevel: 40 } ],
        '咒毒蛙王': [ { to: '深渊蛙帝', icon: '🕳', minLevel: 40 } ],
        '尸牙犬': [ { to: '尸魔犬王', icon: '🦷', minLevel: 25 } ],
        '幽灵犬': [ { to: '幽冥猎犬', icon: '👻', minLevel: 25 } ],
        '尸魔犬王': [ { to: '尸界狱主', icon: '⚰', minLevel: 40 } ],
        '幽冥猎犬': [ { to: '幽魂犬皇', icon: '👻', minLevel: 40 } ],
        '影刃兔': [ { to: '影舞者', icon: '🌙', minLevel: 25 } ],
        '霜影兔': [ { to: '霜影魔兔', icon: '🧊', minLevel: 25 } ],
        '影舞者': [ { to: '影蚀魔君', icon: '✨', minLevel: 40 } ],
        '霜影魔兔': [ { to: '霜魂兔皇', icon: '❄', minLevel: 40 } ]
      }
    }
  },

  /* ================= 经验 ================= */
  exp: {
    // 全局经验倍率：1.0 为基准，想整体调快/调慢改这一个数（如 2.0 = 获得经验翻倍）
    // 之前临时设为 1000 做压力测试，已调回 1.0（否则 1 场就能升几十级，等级失去意义）
    rate: 100.0,
    // 每级所需经验 = needBase × 等级^needExponent（指数越大后期越慢）
    // 1.3：前期更快（Lv1~10 约 40 场、Lv20 约 120 场），后期仍慢（Lv60 约 800 场），
    // 让新手第一分钟能升 5~6 级，有连续升级的爽感，不磨叽
    needBase: 22, needExponent: 1.3,
    // 每胜获得经验范围：20~35，保证前期几乎场场升一级、进度条明显跳动
    perWin: { min: 20, max: 35 }
  },

  /* ================= 战斗 ================= */
  // 单宠刷怪定位：强项越突出，其他输出乘区越收敛；所有定位和属性都在宠物页公开展示。
  petProfiles: {
    '腐噜兽': { role: '均衡快刷', description: '属性平均，适合前期稳定挂机；没有单项极限。', critRate: 8, critDamage: 145 },
    '血狐': { role: '暴击爆发', description: '暴击率和暴击伤害最高，单次输出波动大；攻击速度不高。', critRate: 18, critDamage: 190 },
    '瘟熊': { role: '重甲稳刷', description: '生命、防御最高，适合承受强力敌人持续挂机；攻击速度和爆发偏低。', critRate: 5, critDamage: 135 },
    '疫毛兽': { role: '敏捷输出', description: '攻击速度较高，攻击与暴击适中；适合快速清理普通敌人。', critRate: 9, critDamage: 150 },
    '骨狼': { role: '攻击均衡', description: '攻击较高、速度中等，单次伤害和刷怪稳定性平衡。', critRate: 11, critDamage: 160 },
    '毒沼蛙': { role: '耐久输出', description: '生命、防御较高，牺牲部分速度换取持续作战能力。', critRate: 6, critDamage: 140 },
    '尸犬': { role: '稳定快刷', description: '速度、攻击和耐久均衡，适合长时间挂机。', critRate: 8, critDamage: 150 },
    '幽影兔': { role: '极速连击', description: '攻击速度为 110，依靠高频出手清理普通敌人；攻击、暴击率和暴击伤害偏低。', critRate: 4, critDamage: 130 }
  },

  defaultPetProfile: { role: '均衡型', description: '属性较为平均的单宠挂机伙伴。', critRate: 8, critDamage: 150 },

  battle: {
    /* 攻速刻度（速度系统 v2 校正节奏用）：
     * 进度条满值固定 100 点，tick 每 100ms 累加 spd/speedScale。
     * 所以"打一次所需秒数"≈ 10 × speedScale / 速度：
     *   speedScale=12：最慢 30 → 4 秒、均衡 40 → 3 秒、最快 110 → 1.1 秒。
     * 注意：速度属性本身=攻速，speedScale 只是全局比例尺，改它等于给所有速度整体缩放，
     * 会稀释"速度拉开出手差距"的意义。已改回设计原值 12，不绕开速度属性本身调节奏。
     */
    speedScale: 12,
    // 区域配置：由玩家手动选择；只影响怪物池、掉落来源与背景名。
    // 第1大陆 6 图，承载成长 0→60。growthRange = 该图怪成长值范围（scaleEnemyStats 取怪成长×攻击系数3，保证能破该图推荐成长档玩家的防）。
    // enemyIds 目前为占位（图4~6沿用高级怪），专属怪/专属材料后续单独补。
    areas: [
      { id: 'corrupted-forest', name: '枯荣之地', levelRange: [1, 10], recommended: '成长 3', background: '枯荣之地', difficulty: 1.0, growthRange: [1, 2], enemyIds: ['wild-rotten', 'wild-bloodfox'] },
      // 怪池按等级段匹配：图2用[11,20]中怪、图3用[21,35]高级怪、图4用[21,35]高级+异变、图5/6用[36,60]异变
      { id: 'plague-swamp', name: '泣腐泥沼', levelRange: [10, 20], recommended: '成长 5', background: '泣腐泥沼', difficulty: 1.0, growthRange: [3, 4], enemyIds: ['wild-bonewolf', 'wild-shadowrabbit', 'wild-plaguebear', 'wild-bogfrog', 'wild-corpsehound', 'wild-plaguecat'] },
      { id: 'shadow-mountains', name: '白骨旷野', levelRange: [20, 30], recommended: '成长 8', background: '白骨旷野', difficulty: 1.0, growthRange: [5, 6], enemyIds: ['wild-bloodfang-fox', 'wild-netherfrost-wolf', 'wild-withermaw', 'wild-blightspine', 'wild-umbra-rabbit', 'wild-bog-king'] },
      { id: 'bone-wastes', name: '幽影迷境', levelRange: [30, 40], recommended: '成长 11', background: '幽影迷境', difficulty: 1.0, growthRange: [7, 8], enemyIds: ['wild-bog-king', 'wild-umbra-rabbit', 'wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-bloodfox-mutant'] },
      { id: 'blood-rift', name: '血潮裂谷', levelRange: [40, 50], recommended: '成长 15', background: '血潮裂谷', difficulty: 1.0, growthRange: [9, 11], enemyIds: ['wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-plaguebear-mutant', 'wild-bloodfox-mutant'] },
      { id: 'blight-heart', name: '腐变之源', levelRange: [50, 60], recommended: '成长 20', background: '腐变之源', difficulty: 1.0, growthRange: [12, 14], enemyIds: ['wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-plaguebear-mutant', 'wild-bloodfox-mutant'] }
    ],
    // 野怪池改由 enemy-data.js 维护；此处保留空壳，实际读取在 battle.js 延迟获取。
    enemies: [],
    // 暴击率 / 暴击伤害倍率
    critRate: 0.1, critMultiplier: 1.5,
    // 血量低于最大值的这个比例时自动停止挂机（0.3 = 30%）
    stopHpRatio: 0.3,
    // 场与场之间的间隔（毫秒）
    nextFightDelay: 600
  },

  /* ================= 掉落 ================= */
  drop: {
    // 各掉落概率（之和 < 1，剩余 = 无掉落，只给经验）
    // 注意：通货（碎片）已移除，原概率并入「无掉落」
    // 设计决策（用户 2026-08-27 拍板）：挂机游戏不产出过密，装备/宠物蛋保持稀缺，
    // 防止装备/宠物通胀。5%/5% = 约 20 场掉 1 件装备 + 20 场掉 1 颗蛋，惊喜感更稀。
    // 注意：此数值是【有意调低】，别当 bug 改回高值。
    equipmentChance: 0.05, // 装备掉率（核心循环：捡到装备→穿/卖）
    eggChance: 0.05,       // 宠物蛋掉率（核心循环：掉蛋→孵化新宠物）
    // 涅磐兽（涅槃材料）：每场胜利【独立】概率掉落，不挤占上面两种掉率。
    // 初始值很低（2%），以后做 Boss 可以给高掉率怪加加成，现在先不分怪
    phoenixChance: 0.002,
    phoenixName: '涅磐兽',
    // 合成之石（合成材料）：每场胜利【独立】概率掉落，略高于涅磐兽
    synthesizeChance: 0.03,
    synthesizeName: '合成之石',
    // 打造材料（重铸石/剥离石/神圣石/增缀石）：也是【独立】掉落，不挤占其他掉率。
    // 初始值偏低但有差异化：重铸石掉率最高（主循环），剥离石次之，神圣石与增缀石最低（高价值）。
    reforgeStoneChance: 0.05,  // 重铸石掉率（最高，作为主循环）
    stripStoneChance: 0.04,    // 剥离石掉率（低于重铸石）
    holyStoneChance: 0.05,     // 神圣石掉率（与增缀石同为最低）
    augmentStoneChance: 0.05,  // 增缀石掉率（与神圣石同为最低）
    // 进化素材分 3 档（1~3阶用普通/4~6阶用精粹/7~10阶用传说）：每场独立掉落，不挤占装备/宠物蛋掉率
    // 分图掉落（防轻易接触）：图1只掉普通、图2掉普通+精粹、图3起掉精粹+传说。
    // evolutionMaterialChance 为进化素材的独立掉落概率（一次只掉一档，按当前图决定能掉哪些档，随机选一档）。
    evolutionMaterialChance: 0.03,
    evolutionMaterials: { '进化素材': 0.03, '精粹进化素材': 0.03, '传说进化素材': 0.03 },
    // 每图允许掉的进化素材档位：key=区域 id，value=该图可掉的素材名数组（掉落时随机选一个）
    areaEvolutionTiers: {
      'corrupted-forest': ['进化素材'],
      'plague-swamp':    ['进化素材', '精粹进化素材'],
      'shadow-mountains':['进化素材', '精粹进化素材', '传说进化素材'],
      'bone-wastes':     ['精粹进化素材', '传说进化素材'],
      'blood-rift':      ['精粹进化素材', '传说进化素材'],
      'blight-heart':    ['传说进化素材']
    },
    // 每图专属材料：key=区域 id，value={ name 材料名, chance 掉率 }
    // 独立掉落，不挤占其他掉率；玩家为收集某材料会去对应图挂机（驱动"任务收集"）
    areaMaterials: {
      'corrupted-forest': { name: '枯荣种荚', chance: 0.05 },
      'plague-swamp':    { name: '泣腐之泪', chance: 0.05 },
      'shadow-mountains':{ name: '白骨残片', chance: 0.05 },
      'bone-wastes':     { name: '幽影魂丝', chance: 0.05 },
      'blood-rift':      { name: '血潮凝晶', chance: 0.05 },
      'blight-heart':    { name: '腐变之心', chance: 0.05 }
    },
    // 任务系统：每图一个收集任务（收集该图专属材料），数量大胆、奖励含少量进化素材（辅助，非主力）。
    // 进化素材奖励控制在低量（1次任务给2个，够几小步进化），避免玩家靠刷任务白嫖进化、失去"刷图掉素材"的意义。
    // 任务跟图绑定：打过图N才解锁图N任务。
    quests: [
      { id: 'q1', area: 'corrupted-forest',  matName: '枯荣种荚', need: 50,  reward: { 进化素材: 2 },             unlockLevel: 1 },
      { id: 'q2', area: 'plague-swamp',      matName: '泣腐之泪', need: 80,  reward: { 进化素材: 2, 涅磐兽: 1 },  unlockLevel: 11 },
      { id: 'q3', area: 'shadow-mountains',  matName: '白骨残片', need: 120, reward: { 精粹进化素材: 2, 涅磐兽: 1 }, unlockLevel: 21 },
      { id: 'q4', area: 'bone-wastes',       matName: '幽影魂丝', need: 160, reward: { 精粹进化素材: 2, 重铸石: 2 }, unlockLevel: 31 },
      { id: 'q5', area: 'blood-rift',        matName: '血潮凝晶', need: 200, reward: { 传说进化素材: 2 },          unlockLevel: 41 },
      { id: 'q6', area: 'blight-heart',      matName: '腐变之心', need: 300, reward: { 传说进化素材: 2, 涅磐兽: 1 }, unlockLevel: 51 }
    ]
  },

  /* ================= 装备 ================= */
  equipment: {
    // 各部位基底属性数值范围 [最小, 最大]
    baseValues: {
      武器: { atk: [5, 9] },
      防具: { def: [3, 6], hp: [20, 40] },
      饰品: { spd: [2, 4], atk: [2, 5] }   // 饰品带少量速度基底（基础速度 20~110，+2~4 属"少量加速"）
    },
    // 词缀 T 阶表：T1 最强 → T5 最弱（打造「强化石」把词缀 T 阶提升 1 级，即数值升一档）
    // value 范围 = 该 T 阶下词缀百分比数值的随机区间
    affixTiers: [
      { tier: 1, min: 25, max: 30 },  // T1 封顶，不能再强化
      { tier: 2, min: 19, max: 24 },
      { tier: 3, min: 14, max: 18 },
      { tier: 4, min: 9,  max: 13 },
      { tier: 5, min: 5,  max: 8 }
    ],
    // 词缀 T 阶的随机范围 [最小, 最大]，按稀有度区分（白装差、金装好）
    affixTierByRarity: { white: [4, 5], blue: [3, 4], gold: [1, 3] },
    // 稀有度（白/蓝/金）：affixMin~affixMax = 词缀条数范围；color = 展示颜色（design-tokens v2 规范色）
    // 白装：铁灰；蓝装：幽蓝；金装：熔金（普通词缀常见 → 稀有词缀）
    rarities: [
      { id: 'white', label: '白色', color: '#b2aa9c', affixMin: 1, affixMax: 1 },
      { id: 'blue',  label: '蓝色', color: '#4a6fa8', affixMin: 1, affixMax: 2 },
      { id: 'gold',  label: '金色', color: '#f2b632', affixMin: 2, affixMax: 3 }
    ]
  },

  /* ================= 打造通货 ================= */
  craft: {
    // 重铸石：随机重铸装备全部词缀（数量 / 类型 / T 阶 / 数值 全部随机）
    reforge: {
      name: '重铸石', amount: 1, icon: '🎲',
      effect: '随机重铸全部词缀：数量、类型、T 阶、数值全部重新随机。',
      rule: '会清空并重洗当前词条，组合与数值都不可控，风险远高于收益。'
    },
    // 剥离石：随机移除一条词缀（仅剩 1 条时不可用）
    strip: {
      name: '剥离石', amount: 1, icon: '✂️',
      effect: '随机移除装备一条词缀。',
      rule: '装备仅剩 1 条词缀时无法使用。'
    },
    // 神圣石：重 Roll 装备【全部】词缀的数值（类型不变、T 阶不变，数值在该 T 阶范围内重新随机）
    holy: {
      name: '神圣石', amount: 1, icon: '🔮',
      effect: '重随全部词缀的数值，词缀类型与 T 阶不变。',
      rule: '适合在词缀组合已确定后追求更高数值。'
    },
    // 增缀石：给装备【新增】一条随机词缀（类型随机不重复、T 阶随机 1~5；满 3 条不可用）
    augment: {
      name: '增缀石', amount: 1, icon: '➕',
      effect: '新增一条随机且不重复的词缀。',
      rule: '装备已有 3 条词缀时无法使用。'
    }
  },

  /* ================= 分解（锁定 / 一键分解） ================= */
  salvage: {
    // 各稀有度的分解产出（一键分解时按稀有度结算）：
    //   key = 通货 id（对应 Config.craft 的键），value = 产出数量；空对象 = 无产出
    white: {},               // 白装无产出
    blue:  { augment: 1 },   // 蓝装产出增缀石
    gold:  { reforge: 1 }    // 金装产出重铸石
  },

  /* ================= 交易市场 =================
   * 材料计价交易：卖家选择收什么材料 + 数量，买家材料足够即可购买
   * 交易税：每满 taxPer 个材料收 taxAmount 个税，不满不收（买家按标价支付，卖家实收 = 标价 - 税）
   * ！！！改这里的税率【必须】同步改 supabase/migrate_material_trade.sql 里 buy_pet / buy_equip 的
   *     v_tax := floor(material_qty / taxPer) * taxAmount 两处常量，否则显示与实际扣税不一致 ！！！
   * ==================================================== */
  trade: {
    // 可作价的材料清单（上架时下拉选择；name 必须与掉落/打造/融合用的材料名一致）
    materials: [
      { id: 'reforge', name: '重铸石', icon: '🎲', category: 'stone' },
      { id: 'strip',   name: '剥离石', icon: '✂️', category: 'stone' },
      { id: 'holy',    name: '神圣石', icon: '🔮', category: 'stone' },
      { id: 'augment', name: '增缀石', icon: '➕', category: 'stone' },
      { id: 'synthesize', name: '合成之石', icon: '💠', category: 'stone' },
      { id: 'phoenix', name: '涅磐兽', icon: '🐉', category: 'beast' },
      { id: 'evolution', name: '进化素材', icon: '🧬', category: 'evo' },
      { id: 'evolution-precise', name: '精粹进化素材', icon: '💎', category: 'evo' },
      { id: 'evolution-legend', name: '传说进化素材', icon: '✨', category: 'evo' },
      { id: 'egg',     name: '宠物蛋', icon: '🥚', category: 'egg' }
    ],
    // 交易税：每满 taxPer 收 taxAmount（默认每满 8 收 1）
    taxPer: 8,
    taxAmount: 1,
    // 每人最多同时挂单数（宠物 + 装备共用上限）
    maxListings: 5
  },

  /* ================= 市场冷启动（假卖家挂单 · 流浪商人） =================
   * 系统自动生成「流浪商人」假卖家装备挂单，保证市场不空、有货可买、偶尔能捡到低价好货。
   * 规则：
   *   1. 每 intervalMs（默认 30 秒）自动上架 perTick（默认 5）件随机装备
   *   2. 装备沿用现有词缀 / T 阶 / 稀有度规则（Equipment.generateEquipment）
   *   3. 价格按材料随机；小概率出现偏低价格
   *   4. 挂单卖家显示为 sellerName（流浪商人）

   *   5. 当在售假货少于 minActive（默认 20）件时，自动补货到该数量
   * 纯前端机制：假单只存内存、不落库、不占玩家账号；购买时才把装备写入买家账号（复用 saveItem）。
   * 所有数值都在这里调，无需改逻辑代码。
   * ==================================================== */
  marketBot: {
    enabled: true,             // 总开关：false 则市场只有真实玩家挂单
    intervalMs: 30000,         // 规则1：每 30 秒自动上架
    perTick: 5,                // 规则1：每次上架 5 件
    minActive: 20,             // 规则5：在售假货少于 20 件时自动补货到该数量
    sellerName: '流浪商人',      // 规则4：假卖家显示名
    leakChance: 0.08,          // 规则3：低价漏概率（8%）
    leakDiscount: 0.5,         // 规则3：漏价 = 该档最低价 × 此折扣（明显偏低）
    // 假货稀有度分布（市场里好货占比高一点，吸引购买）
    rarityWeights: { white: 45, blue: 35, gold: 20 },
    // 材料类型随机权重（key 对应 trade.materials 的 id）
    materialWeights: { reforge: 30, strip: 20, holy: 15, augment: 15, phoenix: 15 },
    // 定价表：按稀有度 × 材料类型给数量范围 [最小, 最大]（低价漏取 range[0] 再打折）
    prices: {
      reforge: { white: [2, 6],   blue: [4, 10],  gold: [8, 20] },
      strip:   { white: [1, 2],   blue: [1, 3],   gold: [2, 5] },
      holy:    { white: [2, 4],   blue: [3, 6],   gold: [5, 10] },
      augment: { white: [2, 4],   blue: [3, 6],   gold: [5, 10] },
      phoenix: { white: [1, 1],   blue: [1, 2],   gold: [1, 3] }
    },
    /* ---------- 假买家（流浪商人购买玩家挂单） ----------
     * 规则：
     *   1. 每 intervalMin ~ intervalMax 毫秒（默认 40~90 秒）随机购买 1 件玩家挂单的装备
     *   2. 优先购买价格低于市场参考价（上面 prices 对应档位的上限）的挂单；无低价则买最便宜的
     *   3. 买家显示为 buyerName（流浪商人，交易记录 player_id 写该名）
     *   4. 购买后卖家正常收到材料（标价 - 税），走云端 bot_buy_equip RPC
     *   5. 市场上没有玩家挂单则不购买
     * 后端需执行 supabase/migrate_bot_buy.sql 创建 bot_buy_equip 函数后生效。 */
    buyer: {
      enabled: true,            // 假买家开关（false 则只保留假卖家补货）
      intervalMin: 40000,       // 规则1：最短间隔 40 秒
      intervalMax: 90000,       // 规则1：最长间隔 90 秒
      buyerName: '流浪商人',      // 规则3：买家显示名（与 sellerName 同值，NPC 统一身份）
      maxPerRound: 1            // 规则1：每轮最多买 1 件
    }
  },

  /* ================= 合成（出全新变异宠） =================
   * 两只宠物 → 概率合成出一只全新的「·异变」稀有宠（复用变异宠规则）。
   *  - 变异成功：出一只名字带「·异变」的全新宠，成长 = 主×mainW + 副×subW + 随机加成
   *  - 变异失败：出一只普通新宠（继承主宠形态，成长 = 加权和，略低于变异）
   *  - 两只素材宠都消失；新宠等级回 1（重新练级）；消耗合成之石 */
  synthesize: {
    minLevel: 40,           // 两只素材必须达到的等级
    material: { name: '合成之石', amount: 1 },  // 合成消耗（新增通货）
    mainW: 0.6,             // 新宠成长中主宠占比
    subW: 0.4,              // 新宠成长中副宠占比
    // 变异（稀有）：概率出全新「·异变」宠
    mutation: {
      chance: 0.5,          // 变异概率
      growthBonus: [1, 3]   // 变异宠成长比普通合成结果再 +1~3（稀有加成，不膨胀）
    }
  },
  /* ================= 涅槃（主宠涨成长 + 突破上限） =================
   * 主宠保留，吸副宠成长 + 重置等级 + 突破成长上限。
   *  - 成长吸收 = 副宠成长 × absorbRatio × 等级加成，副宠消失
   *  - 主宠等级重置为 1（重新练级），可反复涅槃持续涨成长（无成长上限）
   *  - 消耗涅磐兽 */
  nirvana: {
    minLevel: 40,           // 主宠与副宠必须达到的等级
    absorbRatio: 0.5,       // 主宠吸收副宠成长的比例（0.5 = 吸一半）
    // 副宠等级加成：吸收 × (1 + (副宠等级 - 门槛) × levelBonus)，练得越高当肥料越值钱
    levelBonus: 0.01,
    /* 合成限制（防成长膨胀，对齐口袋精灵2）：
     *  1. 副宠成长下限：副宠成长 < 主宠 × subGrowthRatio 则吸收打折（防垃圾副宠无限叠）
     *  2. 60 成长分水岭：主宠成长 ≥ growthCap 后吸收减半（后期提升变慢） */
    subGrowthRatio: 0.5,
    lowGrowthPenalty: 0.2,  // 副宠成长不足下限时，吸收打折到该倍
    growthCap: 60,          // 成长分水岭：达到后吸收减半
    capRatio: 0.5,          // 分水岭后的吸收乘数
    material: { name: '涅磐兽', amount: 1 },
    resetLevel: true,       // 涅槃后主宠等级重置为 1（重新练级）
    maxGrowth: 100          // 成长软上限（可配；达上限后涅槃不再涨成长，仅重置等级）
  },

  /* ================= 回血 ================= */
  regen: {
    // 停止战斗后每秒恢复最大生命的比例（0.02 = 每秒回 2%，约 50 秒回满；0.2 = 5 秒回满）
    hpPerSecRatio: 0.2
  },

  /* ================= 注册限制 ================= */
  auth: {
    // 邀请码列表（小范围拉人试玩用）。填这个才能注册；空数组 = 关闭邀请码限制（任何邮箱都能注册）
    inviteCodes: ['SOUL2026'],
    // 注册密码强度：minLen 最少位数；requireLetter 必须含字母；requireDigit 必须含数字
    pwdMinLen: 6,
    pwdRequireLetter: true,
    pwdRequireDigit: true
  },
};
