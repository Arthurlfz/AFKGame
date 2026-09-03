/* ============================================================
 * config.js v2.0.0 —— 全部游戏数值集中配置（最先加载）
 * 用法：改这里的数字即可调数值，无需动任何逻辑代码。
 * 注意：本文件必须在所有模块之前加载（游戏.html 中第一个 script）。
 * ============================================================ */
window.Config = {

  /* ================= 宠物 ================= */
  pet: {
    // 新玩家必须在 8 只基宠中选择 1 只；老存档中的莱姆仍可正常读取
    // 每只基宠带差异化基础值(baseHp/baseAtk/baseDef) + 独立速度(speeds) + 成长系数(statCoeff)，
    // 定位不同：坦克/输出/敏捷/控制/均衡。进化体/变异宠/融合宠继承来源基宠的 statCoeff（lineId 决定）。
    /* 平衡重做 v2.2（2026-08-30，用户拍板「全拉平可用」）
     * 旧版（v2.0）：只有幽影兔能挂机 —— 速度带 30~110，而速度=出手频率
     *   （battle.js: petAction += spd/speedScale），兔 110 打 8 倍于熊 30 的次数，DPS 是瘟熊的 8 倍。
     * v2.1 试过「spd×atk 恒定、拉平裸 DPS」—— 结果错了：它没算【回血停机】。
     *   挂机净推进 = 3600 / (击杀耗时 + 场间隔 + 回血时间/连打场数)，
     *   坦克血厚几乎不停机 → 净推进反超成新的独大（瘟熊 628），脆皮兔子 Lv34 被打死。
     * v2.2 正确做法：拉平的是【净推进】而不是裸 DPS，即让「有效 DPS × 有效生存 ≈ 常数」。
     *   关键约束：伤害是减法（atk-def），防御系数差距必须压住 —— 高防宠会直接免疫敌人伤害，
     *   脆皮又被秒。所以 v2.1 的 def 2.5（熊）vs 0.8（兔）必须收窄到 1.12 vs 0.90。
     * 结果（vtest_pet_balance.js 守）：8 只净推进极差 ≤1.35x，全等级段无死亡，
     *   trade-off 立住：单场掉血 兔 36%（打 2 场就得回血）↔ 熊 10%（能连打 7 场）。
     */
    starters: [
      { name: '腐噜兽', icon: '🐹', growth: 5, baseHp: 110, baseAtk: 22, baseDef: 11, statCoeff: { hp: 4.9, atk: 2.38, def: 1.02 } }, // 均衡（spd 80）
      { name: '血狐',   icon: '🦊', growth: 5, baseHp: 85,  baseAtk: 30, baseDef: 8,  statCoeff: { hp: 3.22, atk: 2.22, def: 0.92 } }, // 暴击爆发（最脆，spd 96）
      { name: '瘟熊',   icon: '🐻', growth: 5, baseHp: 160, baseAtk: 18, baseDef: 18, statCoeff: { hp: 5.7, atk: 2.42, def: 1.12 } }, // 坦克（最慢最肉，spd 70）
      { name: '疫毛兽', icon: '🐱', growth: 5, baseHp: 95,  baseAtk: 26, baseDef: 9,  statCoeff: { hp: 4, atk: 2.28, def: 0.96 } },   // 敏捷输出（spd 92）
      { name: '骨狼',   icon: '🐺', growth: 5, baseHp: 105, baseAtk: 25, baseDef: 10, statCoeff: { hp: 4.3, atk: 2.24, def: 0.99 } }, // 攻击均衡（spd 88）
      { name: '毒沼蛙', icon: '🐸', growth: 5, baseHp: 130, baseAtk: 20, baseDef: 14, statCoeff: { hp: 5.2, atk: 2.36, def: 1.08 } }, // 耐久坦克（spd 75）
      { name: '尸犬',   icon: '🐶', growth: 5, baseHp: 120, baseAtk: 21, baseDef: 13, statCoeff: { hp: 4.6, atk: 2.25, def: 1.05 } }, // 均衡偏坦（spd 84）
      { name: '幽影兔', icon: '🐰', growth: 5, baseHp: 70,  baseAtk: 24, baseDef: 7,  statCoeff: { hp: 3.35, atk: 2.34, def: 0.90 } }  // 极速闪避（最快，spd 100）
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
      // v2.2：机制属性回到「原始定位档」—— v2.1 动过这些值（如兔子闪避 20、熊暴击 12）会破坏
      // 净推进平衡（净推进已由 statCoeff+速度拉平，这里再叠加机制差异就会重新拉开差距）。
      // 描述同步 v2.2 的新速度带，让玩家看得见 trade-off。
      '腐噜兽': { role: '均衡快刷', description: '属性平均、速度中等（80），适合前期稳定挂机；没有单项极限。', critRate: 8, critDamage: 145, hit: 90, dodge: 5, lifesteal: 0 },
      '血狐': { role: '暴击爆发', description: '暴击率与暴击伤害全游最高，单次输出波动大；血薄防低，是最脆的输出位。', critRate: 18, critDamage: 190, hit: 92, dodge: 5, lifesteal: 0 },
      '瘟熊': { role: '重甲稳刷', description: '生命、防御最高、速度最慢（70），靠高血厚甲+吸血连打多场都不用回血。', critRate: 5, critDamage: 135, hit: 95, dodge: 2, lifesteal: 4 },
      '疫毛兽': { role: '敏捷输出', description: '速度较高（92）、闪避好，攻击与暴击适中；适合快速清理普通敌人。', critRate: 9, critDamage: 150, hit: 92, dodge: 8, lifesteal: 0 },
      '骨狼': { role: '攻击均衡', description: '攻击与速度中等（88），单次伤害和刷怪稳定性平衡，略有吸血续航。', critRate: 11, critDamage: 160, hit: 92, dodge: 5, lifesteal: 2 },
      '毒沼蛙': { role: '耐久输出', description: '生命、防御较高、速度偏慢（75），靠耐久+吸血+闪避换取持续作战。', critRate: 6, critDamage: 140, hit: 95, dodge: 8, lifesteal: 3 },
      '尸犬': { role: '稳定快刷', description: '速度、攻击和耐久均衡（84），略有吸血，适合长时间挂机。', critRate: 8, critDamage: 150, hit: 90, dodge: 6, lifesteal: 3 },
      '幽影兔': { role: '极速连击', description: '速度全游最快（100）、闪避最高，靠高频出手清理敌人；血薄防低，回血最频繁。', critRate: 4, critDamage: 130, hit: 88, dodge: 12, lifesteal: 0 }
    },
    defaultPetProfile: { role: '均衡型', description: '属性较为平均的单宠挂机伙伴。', critRate: 8, critDamage: 150, hit: 90, dodge: 5, lifesteal: 0 },
    // 每只宠物独立基础速度（新速度规则核心）：
    //   宠物速度 = 该表数值 + 装备加成（饰品基底速度 + 速度词缀），成长值不再参与
    // 平衡重做 v2.2：速度带从 30~110 收窄到 70~100（差距 1.43 倍，旧版 3.67 倍是「只有兔子能用」的根因）。
    //   最慢 瘟熊 70（坦克） → 最快 幽影兔 100（极速）；梯度：瘟70 < 毒75 < 腐80 < 尸84 < 骨88 < 疫92 < 血96 < 幽100
    // 注意：速度收窄不是唯一手段 —— 必须配合 statCoeff（见 starters 注释），
    //   否则只拉平裸 DPS 会让血厚的坦克靠「几乎不回血」反超（v2.1 的教训）。
    // 异变宠（X·异变）速度沿用本体：getBaseSpeed 会去掉「·异变」后缀查原速，无需在此逐条列。
    // 进化体：速度沿用对应基宠（进化只提升成长值，速度按名查表不变）。
    speeds: {
      '莱姆': 82,        // 旧存档初始宠，中庸
      '腐噜兽': 80,      // 均衡
      '疫毛兽': 92,      // 敏捷
      '尸犬': 84,        // 均衡偏坦
      '血狐': 96,        // 快速爆发
      '骨狼': 88,        // 攻击均衡
      '幽影兔': 100,     // 极速（全游最快）
      '瘟熊': 70,        // 坦克，最慢
      '毒沼蛙': 75,      // 慢速耐久
      // 进化形态：速度沿用对应基宠本体（与上面本体值一致）
      '腐沼兽': 80, '毒噜兽': 80, '血牙狐': 96, '幽火狐': 96,
      '瘟甲熊': 70, '血瘟熊': 70, '疫刺兽': 92, '冥毛兽': 92,
      '骨刃狼': 88, '冥霜狼': 88, '毒沼王': 75, '咒沼蛙': 75,
      '尸牙犬': 84, '幽灵犬': 84, '影刃兔': 100, '霜影兔': 100
    },
    // 等级上限（到顶后经验条保持满，不再升级）。
    // 2026-08-31 拍板：上限提到 100，野外图扩到 17 张（图 1-17 覆盖 1-100，节点挂现有世界地图），
    // 等级到哪、图就到哪，不出现"满级后没图可挂、越级碾压"。
    // maxLevel 与图的等级段必须同步（改这里必须确认图 17 的上限是 100）。
    // 注意：涅槃要求 ≥ nirvana.minLevel（60），上限必须 ≥ 涅槃门槛。
    maxLevel: 100,
    /* 满级经验池：满级后溢出经验不再蒸发，先攒进池子，每满 perCrystal 自动凝 1 颗「凝魂晶石」。
     * 定位：满级挂机 = 凝魂晶石农场，晶石是账号级材料（涅槃加成 / 市场交易），
     * 让"练满之后继续挂"有产出，而不是纯浪费。
     * ponytail: 池内零头只存本地不落库（刷新丢 < perCrystal 的部分，晶石本身走 Materials 云端） */
    expPool: { perCrystal: 12000, material: '凝魂晶石' },
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
      /* 进化节点 2026-08-31 重排：10 / 35 / 60（原 10/25/40）
       * Lv60 = 终形态 + 学主动技能 + 涅槃解锁（三者同点，第一幕毕业仪式），第二幕靠技能+涅槃撑。 */
      // 主动技能：终形态且达到 60 级时解锁；每次施放后按后续我方行动冷却 3 回合。
      activeSkills: {
        '腐烂之母': { id: 'corrosion-spit', name: '腐蚀喷吐', minLevel: 60, cooldownTurns: 3, triggerChance: 0.2, damageMultiplier: 1.5 },
        '剧毒魔君': { id: 'toxic-cloud', name: '剧毒云雾', minLevel: 60, cooldownTurns: 3, triggerChance: 0.22, damageMultiplier: 1.3, maxHpDamageRate: 0.03 },
        '血月魔狐': { id: 'blood-moon-slash', name: '血月斩', minLevel: 60, cooldownTurns: 3, triggerChance: 0.13, damageMultiplier: 2 },
        '幽火魔狐': { id: 'hellfire-burn', name: '幽火焚身', minLevel: 60, cooldownTurns: 3, triggerChance: 0.2, damageMultiplier: 1.5 },
        '瘟疫之主': { id: 'plague-stomp', name: '瘟疫践踏', minLevel: 60, cooldownTurns: 3, triggerChance: 0.18, damageMultiplier: 1.6 },
        '血瘟暴君': { id: 'blood-feast', name: '血瘟盛宴', minLevel: 60, cooldownTurns: 3, triggerChance: 0.2, damageMultiplier: 1.4, maxHpDamageRate: 0.02 },
        '刺骨魔兽': { id: 'bone-spike', name: '万骨穿刺', minLevel: 60, cooldownTurns: 3, triggerChance: 0.15, damageMultiplier: 1.8 },
        '幽冥疫君': { id: 'nether-plague', name: '幽冥疫爆', minLevel: 60, cooldownTurns: 3, triggerChance: 0.2, damageMultiplier: 1.4, maxHpDamageRate: 0.02 },
        '骸骨君主': { id: 'bone-cleave', name: '骸骨裂斩', minLevel: 60, cooldownTurns: 3, triggerChance: 0.14, damageMultiplier: 1.9 },
        '霜寒领主': { id: 'frost-bite', name: '极寒撕咬', minLevel: 60, cooldownTurns: 3, triggerChance: 0.18, damageMultiplier: 1.6 },
        '剧毒魔神': { id: 'venom-eruption', name: '毒沼爆发', minLevel: 60, cooldownTurns: 3, triggerChance: 0.2, damageMultiplier: 1.4, maxHpDamageRate: 0.03 },
        '深渊蛙帝': { id: 'abyss-crush', name: '深渊镇压', minLevel: 60, cooldownTurns: 3, triggerChance: 0.13, damageMultiplier: 2 },
        '尸界狱主': { id: 'corpse-rend', name: '尸界撕裂', minLevel: 60, cooldownTurns: 3, triggerChance: 0.16, damageMultiplier: 1.7 },
        '幽魂犬皇': { id: 'ghost-hunt', name: '幽魂猎杀', minLevel: 60, cooldownTurns: 3, triggerChance: 0.18, damageMultiplier: 1.5, maxHpDamageRate: 0.02 },
        '影蚀魔君': { id: 'shadow-eclipse', name: '影蚀绝杀', minLevel: 60, cooldownTurns: 3, triggerChance: 0.12, damageMultiplier: 2.1 },
        '霜魂兔皇': { id: 'frost-moon', name: '霜魂月刃', minLevel: 60, cooldownTurns: 3, triggerChance: 0.16, damageMultiplier: 1.7 }
      },
      // 变异宠（名字带 ·异变）继承本体主动技能：skillOf 剥离后缀查找
      skillOf: (name) => {
        const skills = (window.Config.pet && window.Config.pet.evolution && window.Config.pet.evolution.activeSkills) || {};
        const baseName = String(name || '').replace(/·异变$/, '');
        return skills[baseName] || null;
      },
      tree: {
        '腐噜兽': [ { to: '腐沼兽', icon: '🐸', minLevel: 10 }, { to: '毒噜兽', icon: '🐹', minLevel: 10 } ],
        '血狐': [ { to: '血牙狐', icon: '🦷', minLevel: 10 }, { to: '幽火狐', icon: '🔥', minLevel: 10 } ],
        '瘟熊': [ { to: '瘟甲熊', icon: '🛡', minLevel: 10 }, { to: '血瘟熊', icon: '🩸', minLevel: 10 } ],
        '疫毛兽': [ { to: '疫刺兽', icon: '🌵', minLevel: 10 }, { to: '冥毛兽', icon: '🌑', minLevel: 10 } ],
        '骨狼': [ { to: '骨刃狼', icon: '🗡', minLevel: 10 }, { to: '冥霜狼', icon: '❄', minLevel: 10 } ],
        '毒沼蛙': [ { to: '毒沼王', icon: '👑', minLevel: 10 }, { to: '咒沼蛙', icon: '🌀', minLevel: 10 } ],
        '尸犬': [ { to: '尸牙犬', icon: '🦷', minLevel: 10 }, { to: '幽灵犬', icon: '👻', minLevel: 10 } ],
        '幽影兔': [ { to: '影刃兔', icon: '🌙', minLevel: 10 }, { to: '霜影兔', icon: '🧊', minLevel: 10 } ],
        '腐沼兽': [ { to: '腐沼王', icon: '🐸', minLevel: 35 } ],
        '毒噜兽': [ { to: '毒沼霸主', icon: '🐹', minLevel: 35 } ],
        '腐沼王': [ { to: '腐烂之母', icon: '👑', minLevel: 60 } ],
        '毒沼霸主': [ { to: '剧毒魔君', icon: '☠', minLevel: 60 } ],
        '血牙狐': [ { to: '血灾领主', icon: '🦷', minLevel: 35 } ],
        '幽火狐': [ { to: '幽火王', icon: '🔥', minLevel: 35 } ],
        '血灾领主': [ { to: '血月魔狐', icon: '🌕', minLevel: 60 } ],
        '幽火王': [ { to: '幽火魔狐', icon: '🌑', minLevel: 60 } ],
        '瘟甲熊': [ { to: '瘟神巨熊', icon: '🛡', minLevel: 35 } ],
        '血瘟熊': [ { to: '血疫暴君', icon: '🩸', minLevel: 35 } ],
        '瘟神巨熊': [ { to: '瘟疫之主', icon: '☠', minLevel: 60 } ],
        '血疫暴君': [ { to: '血瘟暴君', icon: '🩸', minLevel: 60 } ],
        '疫刺兽': [ { to: '疫魔刺龙', icon: '🌵', minLevel: 35 } ],
        '冥毛兽': [ { to: '冥幽兽', icon: '🌑', minLevel: 35 } ],
        '疫魔刺龙': [ { to: '刺骨魔兽', icon: '🦴', minLevel: 60 } ],
        '冥幽兽': [ { to: '幽冥疫君', icon: '🌒', minLevel: 60 } ],
        '骨刃狼': [ { to: '骨刃王', icon: '⚔', minLevel: 35 } ],
        '冥霜狼': [ { to: '霜狼祭司', icon: '🧙', minLevel: 35 } ],
        '骨刃王': [ { to: '骸骨君主', icon: '💀', minLevel: 60 } ],
        '霜狼祭司': [ { to: '霜寒领主', icon: '❄', minLevel: 60 } ],
        '毒沼王': [ { to: '毒沼魔君', icon: '👑', minLevel: 35 } ],
        '咒沼蛙': [ { to: '咒毒蛙王', icon: '🌀', minLevel: 35 } ],
        '毒沼魔君': [ { to: '剧毒魔神', icon: '🧪', minLevel: 60 } ],
        '咒毒蛙王': [ { to: '深渊蛙帝', icon: '🕳', minLevel: 60 } ],
        '尸牙犬': [ { to: '尸魔犬王', icon: '🦷', minLevel: 35 } ],
        '幽灵犬': [ { to: '幽冥猎犬', icon: '👻', minLevel: 35 } ],
        '尸魔犬王': [ { to: '尸界狱主', icon: '⚰', minLevel: 60 } ],
        '幽冥猎犬': [ { to: '幽魂犬皇', icon: '👻', minLevel: 60 } ],
        '影刃兔': [ { to: '影舞者', icon: '🌙', minLevel: 35 } ],
        '霜影兔': [ { to: '霜影魔兔', icon: '🧊', minLevel: 35 } ],
        '影舞者': [ { to: '影蚀魔君', icon: '✨', minLevel: 60 } ],
        '霜影魔兔': [ { to: '霜魂兔皇', icon: '❄', minLevel: 60 } ]
      }
    }
  },


  /* ================= 血统被动 =================
   * 每只基宠天生绑定一个机制性被动，战斗中可见、不可继承、不可更换 = 职业定位。
   * 与血脉特质（trait，随机roll/属性加成/可继承）互补：血统定方向，特质做微调。
   * 类型化设计：战斗代码只认 type 不认宠物名，未来加新宠物90%情况复用已有type配参数。
   * 8个类型：allStatBonus / onCritExtraHit / onHitReflect / speedAspd / killDamageBuff / corruptionStack / lifestealTrueDamage / onDodgeCounter
   * ==================================================== */
  bloodlinePassive: {
    '腐噜兽': { type: 'allStatBonus', name: '适应力', icon: '🐹', desc: '暴击率/闪避/命中各+8%，全场景稳定发挥。', params: { critRate: 0.08, dodge: 0.08, hit: 0.08 } },
    '血狐':   { type: 'onCritExtraHit', name: '猎杀本能', icon: '🦊', desc: '暴击时25%概率追加一次普攻（100%伤害）。', params: { chance: 0.25, damageMult: 1.0 } },
    '瘟熊':   { type: 'onHitReflect', name: '重甲反冲', icon: '🐻', desc: '受击时反弹防御力30%的伤害给敌人。', params: { defRatio: 0.3 } },
    '疫毛兽': { type: 'speedAspd', name: '疾风步', icon: '🐱', desc: '速度超100后，每10点速度+5%攻速，上限+30%。', params: { threshold: 100, perPoint: 10, bonusPer: 0.05, cap: 0.30 } },
    '骨狼':   { type: 'killDamageBuff', name: '嗜血追击', icon: '🐺', desc: '击杀敌人后，下次攻击伤害+50%。', params: { damageMult: 1.5 } },
    '毒沼蛙': { type: 'corruptionStack', name: '腐蚀毒液', icon: '🐸', desc: '攻击叠加腐蚀层数，每层使敌人受伤+5%，最多5层。', params: { perStack: 0.05, maxStacks: 5 } },
    '尸犬':   { type: 'lifestealTrueDamage', name: '噬魂咬', icon: '🐶', desc: '吸血时附加吸血量100%的真实伤害。', params: { ratio: 1.0 } },
    '幽影兔': { type: 'onDodgeCounter', name: '影袭', icon: '🐰', desc: '闪避后立即反击，造成80%伤害。', params: { damageMult: 0.8 } }
  },

  /* ================= 经验 =================
   * 第一性原则：经验「产出」与「需求」必须同量纲设计，否则后期经验条肉眼不动。
   *   每级所需  need(lv) = needBase × lv^needExponent
   *   每场产出  win(lv)  = perWinCoef × 怪物等级^perWinExponent × 区域难度 × rate
   * 两者指数差 0.3 → 每升一级所需场数 = (needBase / perWinCoef) × lv^0.3，即：
   *   Lv1 ≈ 5 场、Lv10 ≈ 11 场、Lv30 ≈ 15 场、Lv60 ≈ 19 场。
   * 前期有连续升级的爽感，后期也不会"打半天条不动"（旧版固定 20~35 经验，
   * 而 Lv30 需要 1828 → 68 场才升一级，进度条每场只涨 1.5%，等于零反馈）。
   * 怪物等级 = 宠物等级【钳进】地图等级段（2026-08-30 改：图决定范围，宠物等级决定范围内取值，
   *   到边界就停）。所以每张图的经验产出有上限（图1 封顶 6 级的量），
   *   想拿高级经验必须去高级图 —— 图的推进感来源。
   * 调快慢只动 perWinCoef（越大越快）；两个指数别单独改，改了曲线就失衡。
   */
  exp: {
    rate: 1.0,                 // 全局倍率（1.0 为基准，压力测试可临时调大）
    needBase: 22, needExponent: 1.3,
    perWinCoef: 4, perWinExponent: 1.0, // 每场经验 = coef × 怪物等级^指数 × 难度 × rate
    perWinJitter: 0.25,        // ±25% 随机波动，避免每场给得一模一样
    perWinMin: 1               // 保底经验
  },

  /* ================= 战斗 ================= */
  // 单宠刷怪定位：强项越突出，其他输出乘区越收敛；所有定位和属性都在宠物页公开展示。
  petProfiles: {
    // 与 Config.pet.petProfiles 保持一致（战斗读的是 pet.petProfiles，这里同步避免两处漂移）
    '腐噜兽': { role: '均衡快刷', description: '属性平均、速度中等（80），适合前期稳定挂机；没有单项极限。', critRate: 8, critDamage: 145 },
    '血狐': { role: '暴击爆发', description: '暴击率与暴击伤害全游最高，单次输出波动大；血薄防低，是最脆的输出位。', critRate: 18, critDamage: 190 },
    '瘟熊': { role: '重甲稳刷', description: '生命、防御最高、速度最慢（70），靠高血厚甲+吸血连打多场都不用回血。', critRate: 5, critDamage: 135 },
    '疫毛兽': { role: '敏捷输出', description: '速度较高（92）、闪避好，攻击与暴击适中；适合快速清理普通敌人。', critRate: 9, critDamage: 150 },
    '骨狼': { role: '攻击均衡', description: '攻击与速度中等（88），单次伤害和刷怪稳定性平衡，略有吸血续航。', critRate: 11, critDamage: 160 },
    '毒沼蛙': { role: '耐久输出', description: '生命、防御较高、速度偏慢（75），靠耐久+吸血+闪避换取持续作战。', critRate: 6, critDamage: 140 },
    '尸犬': { role: '稳定快刷', description: '速度、攻击和耐久均衡（84），略有吸血，适合长时间挂机。', critRate: 8, critDamage: 150 },
    '幽影兔': { role: '极速连击', description: '速度全游最快（100）、闪避最高，靠高频出手清理敌人；血薄防低，回血最频繁。', critRate: 4, critDamage: 130 }
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
    /* 怪物数值（2026-08-30 用户拍板：直接定死，不随玩家成长/属性算）
     * 每图一套固定数值，怪是死靶子：
     *   - 裸装正常玩家（选宠成长 5 + 几次进化）≈ 5 刀：能推，慢但不死
     *   - 穿图内普通装备 ≈ 3.5 刀：装备是提速，不是门票
     *   - 融合/涅槃叠成长 → 一刀秒：成长是超车，刷低图更快
     * 玩家等级越高打同图越碾压（低图碾压是放置游戏常态，玩家自然往高级图走）。
     * 定死基准：正常玩家 = Lv图中点 + 成长5.5 + 基础装备(atk×1.3)；怪血≈玩家攻×2.6、怪攻≈玩家防+玩家血×12%、怪防≈玩家攻×25%。
     */
    /* 等级缩放：实际怪数值 = 图中点基准 × clamp(怪等级 / 图中点, 下限, 上限)（battle.js scaleEnemyStats）。
     * 上限 2026-08-31 由 1.6 收到 1.25（新手期血案，vtest_early_game.js 守）：
     *   图1 等级段 [1,6]、中点 3.5 → 段内跨度 5.6 倍（Lv1=0.29 ↔ Lv6=1.6），
     *   而玩家 1→6 级属性只涨约 2 倍（属性 = base + 等级×成长×系数，低级时 base 占比大，涨得比等级慢），
     *   结果图1 后半段怪反超玩家：Lv4 残血、Lv5/Lv6 胜率 0% —— 玩家观感就是「连第一张图都打不过」。
     *   收到 1.25 只动低级图：图2 末端 1.26→1.25（几乎无感），图3 起段内跨度本就 <1.2，完全不受影响。 */
    levelScaleClamp: [0.25, 1.1],
    /* 每图 6 级一档（图1[1,6]…图10[55,60]），表中数值 = 玩家等级处在【图中点】时的怪数值，
     * v2.2 重推（宠物平衡改了，敌人基准必须跟着重推，否则「3.5 刀」设计意图失效）：
     *   参考玩家 = 8 只宠【平均值】在图中点等级、成长 5.5（裸宠 5 + 几次进化）、穿基础装备 atk×1.3
     *     —— 用平均值而不是某一只，是因为 v2.2 的目标就是「8 只都能推」，不能拿某一只当基准。
     *   怪防 = 参考裸攻 × 30%（低防让宠的 atk 差不被放大，净推进平衡才生效）
     *   怪血 = 3.5 × (参考穿装攻 − 怪防)   → 穿基础装备 ≈ 3.5 刀一只
     *   怪攻 = 参考裸防 + 参考裸血 × 12%   → 保证怪攻高于所有宠的防御（减法伤害下高防宠会免疫）
     * 这套数值经 vtest_pet_balance.js 验证：8 只宠全等级段无死亡、净推进极差 ≤1.35x。
     */
    areaEnemyStats: {
      /* 图1（2026-08-31 下调 hp 238→225 / atk 54→38 / def 20→16，vtest_early_game.js 守）：
       * 基准是按「中点 Lv4 + 成长5.5 + 穿基础装备」推的，但新手实际是【裸装成长 5】，
       * 比参考玩家弱一档（atk 少 30%），再加上图1 段内跨度大，后半段就变成场场残血。
       * 下调后：裸装新手 Lv1~6 全程必胜，最低剩余血 ~40%（Lv4 幽影兔最脆的一档），
       * 而「穿装备更快」的设计意图不变（裸装 4.2 刀 → 穿装 3.0 刀）。 */
      'corrupted-forest': { hp: 225, atk: 38, def: 16 },
      /* 图2（2026-08-31 下调 hp 505→460 / atk 105→80 / def 43→38）：与图1 同一毛病 ——
       * 新手到 Lv7 才刚进图2，手上最多一两件白蓝装，远不到「参考玩家穿基础装备」的档，
       * 原数值下 Lv9~11 裸装新手只剩个位数血、胜率跌到 41%。下调后全程剩余血 ≥25%。 */
      'plague-swamp':     { hp: 460, atk: 80, def: 38 },
      'shadow-mountains': { hp: 771, atk: 155, def: 66 },
      'bone-wastes':      { hp: 1038, atk: 206, def: 89 },
      'blood-rift':       { hp: 1304, atk: 256, def: 112 },
      'echo-cliffs':      { hp: 1571, atk: 307, def: 135 },
      'rotfen-bog':       { hp: 1837, atk: 358, def: 158 },
      'ember-hollow':     { hp: 2107, atk: 408, def: 180 },
      'soul-abyss':       { hp: 2374, atk: 459, def: 203 },
      'blight-heart':     { hp: 2641, atk: 510, def: 226 },
      /* ---- 2026-08-31 第二幕 7 图（61-100 级）：按既有等差外推（每图 hp+267/atk+51/def+23）----
       * 与图 6-10 同一套规则：怪数值=图中点基准 × 等级缩放（clamp 0.25~1.6）× typeMult。
       * 覆盖 61-100 级（maxLevel 100），怪物池复用变异怪，不新增美术。 */
      'rift-fissure':     { hp: 2908, atk: 561, def: 249 },
      'black-blood-moor': { hp: 3175, atk: 612, def: 272 },
      'bone-abyss':       { hp: 3442, atk: 663, def: 295 },
      'plague-heart':     { hp: 3709, atk: 714, def: 318 },
      'soul-nest':        { hp: 3976, atk: 765, def: 341 },
      'annihilation-hall':{ hp: 4243, atk: 816, def: 364 },
      'blight-origin':    { hp: 4510, atk: 867, def: 387 }
    },
    // 怪类型强度：普通 1.0 / 进化 1.1 / 变异 1.2（变异怪血攻防都更高，压箱底才有挑战）
    typeMult: { normal: 1.0, evolved: 1.1, mutant: 1.2 },
    // 区域配置：由玩家手动选择；只影响怪物池、掉落来源与背景名。
    // 2026-08-31 拍板：野外图扩到 17 张（图 1-17 覆盖 1-100 级），节点全部挂现有世界地图，不做新大地图；
    // 只有深渊（以后做）才单独画新地图。腐变之源定位改为「第一幕终章」（Lv60 毕业：终形态+学技能+涅槃解锁），
    // 最终图让给图 17 腐变本源。改这里必须同步改 areaEnemyStats / worldmap 点位 / 主线任务等级对齐 / 掉落三件套。
    areas: [
      { id: 'corrupted-forest', name: '枯荣之地', levelRange: [1, 6], recommended: '成长 3', recGrowth: 3, background: '枯荣之地', difficulty: 1.0, enemyIds: ['wild-rotten', 'wild-bloodfox'] },
      { id: 'plague-swamp', name: '泣腐泥沼', levelRange: [7, 12], recommended: '成长 5', recGrowth: 5, background: '泣腐泥沼', difficulty: 1.0, enemyIds: ['wild-rotten', 'wild-bloodfox', 'wild-plaguebear', 'wild-bogfrog'] },
      { id: 'shadow-mountains', name: '白骨旷野', levelRange: [13, 18], recommended: '成长 7', recGrowth: 7, background: '白骨旷野', difficulty: 1.0, enemyIds: ['wild-bonewolf', 'wild-shadowrabbit', 'wild-plaguebear', 'wild-bogfrog', 'wild-corpsehound', 'wild-plaguecat'] },
      { id: 'bone-wastes', name: '幽影迷境', levelRange: [19, 24], recommended: '成长 9', recGrowth: 9, background: '幽影迷境', difficulty: 1.0, enemyIds: ['wild-bloodfang-fox', 'wild-netherfrost-wolf', 'wild-withermaw', 'wild-blightspine', 'wild-umbra-rabbit', 'wild-bog-king'] },
      { id: 'blood-rift', name: '血潮裂谷', levelRange: [25, 30], recommended: '成长 11', recGrowth: 11, background: '血潮裂谷', difficulty: 1.0, enemyIds: ['wild-bloodfang-fox', 'wild-netherfrost-wolf', 'wild-withermaw', 'wild-blightspine', 'wild-umbra-rabbit', 'wild-bog-king'] },
      { id: 'echo-cliffs', name: '回响崖', levelRange: [31, 36], recommended: '成长 13', recGrowth: 13, background: '回响崖', difficulty: 1.0, enemyIds: ['wild-bog-king', 'wild-umbra-rabbit', 'wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-bloodfox-mutant', 'wild-plaguebear-mutant'] },
      { id: 'rotfen-bog', name: '腐沼泽', levelRange: [37, 42], recommended: '成长 15', recGrowth: 15, background: '腐沼泽', difficulty: 1.0, enemyIds: ['wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-plaguebear-mutant', 'wild-bloodfox-mutant', 'wild-bog-king', 'wild-umbra-rabbit'] },
      { id: 'ember-hollow', name: '余烬渊', levelRange: [43, 48], recommended: '成长 17', recGrowth: 17, background: '余烬渊', difficulty: 1.0, enemyIds: ['wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-plaguebear-mutant', 'wild-bloodfox-mutant', 'wild-bog-king', 'wild-umbra-rabbit'] },
      { id: 'soul-abyss', name: '魂渊', levelRange: [49, 54], recommended: '成长 19', recGrowth: 19, background: '魂渊', difficulty: 1.0, enemyIds: ['wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-plaguebear-mutant', 'wild-bloodfox-mutant', 'wild-bog-king', 'wild-umbra-rabbit'] },
      { id: 'blight-heart', name: '腐变之源', levelRange: [55, 60], recommended: '成长 21', recGrowth: 21, background: '腐变之源', difficulty: 1.0, enemyIds: ['wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-plaguebear-mutant', 'wild-bloodfox-mutant', 'wild-bog-king', 'wild-umbra-rabbit'] },
      /* ---- 2026-08-31 第二幕 7 图（腐变之源打穿后，污染往更深处扩散）----
       * enemyIds 只放 4 只变异怪：bog-king/umbra-rabbit 的等级段 [21,35] 在 61+ 图池过滤后永远选不中，不配死条目。 */
      { id: 'rift-fissure', name: '腐变裂隙', levelRange: [61, 66], recommended: '成长 23', recGrowth: 23, background: '腐变裂隙', difficulty: 1.0, enemyIds: ['wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-plaguebear-mutant', 'wild-bloodfox-mutant'] },
      { id: 'black-blood-moor', name: '黑血沼原', levelRange: [67, 72], recommended: '成长 25', recGrowth: 25, background: '黑血沼原', difficulty: 1.0, enemyIds: ['wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-plaguebear-mutant', 'wild-bloodfox-mutant'] },
      { id: 'bone-abyss', name: '万骨深渊', levelRange: [73, 78], recommended: '成长 27', recGrowth: 27, background: '万骨深渊', difficulty: 1.0, enemyIds: ['wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-plaguebear-mutant', 'wild-bloodfox-mutant'] },
      { id: 'plague-heart', name: '疫潮之心', levelRange: [79, 84], recommended: '成长 29', recGrowth: 29, background: '疫潮之心', difficulty: 1.0, enemyIds: ['wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-plaguebear-mutant', 'wild-bloodfox-mutant'] },
      { id: 'soul-nest', name: '噬魂巢穴', levelRange: [85, 90], recommended: '成长 31', recGrowth: 31, background: '噬魂巢穴', difficulty: 1.0, enemyIds: ['wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-plaguebear-mutant', 'wild-bloodfox-mutant'] },
      { id: 'annihilation-hall', name: '湮灭回廊', levelRange: [91, 96], recommended: '成长 33', recGrowth: 33, background: '湮灭回廊', difficulty: 1.0, enemyIds: ['wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-plaguebear-mutant', 'wild-bloodfox-mutant'] },
      { id: 'blight-origin', name: '腐变本源', levelRange: [97, 100], recommended: '成长 35', recGrowth: 35, background: '腐变本源', difficulty: 1.0, enemyIds: ['wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-plaguebear-mutant', 'wild-bloodfox-mutant'] }
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
    /* ===== 改法一：单池·一场一抽（2026-08-31）=====
     * 旧结构：主掉落(装备/蛋) 一个 if/else + 涅磐兽/合成之石/4 种打造石/3 档进化素材/区域材料 共 8+ 个【独立】骰子，
     *   每场可同时中好几件材料 → 背包刷屏、好东西被埋（"又平又乱"）。
     * 新结构：每场只摇 1 次，从一张合并权重总池里抽 1 件结果，四选一：
     *   none(无掉落) / material(普通材料·单件) / equipment(装备) / egg(宠物蛋)。
     *   一场最多给 1 件；材料与装备/蛋互斥。装备/蛋仍为低概率"惊喜档"，不抬高通胀。
     * 权重为【相对权重】，代码归一化；下表目标概率：material≈21% / equipment≈1.5% / egg≈1.5% / none≈76%。
     *   material 子权重按改造前各材料独立概率等比例设定 → 各材料吞吐≈改造前（不饿死打造/进化/涅槃）。
     *   evo/区域材料的实际名字由 areaEvolutionTiers / areaMaterials 决定；其权重并入下方固定项，不再读 chance。
     */
    pool: { none: 760, material: 210, equipment: 15, egg: 15 },
    /* 材料子权重·按图档（low→high，2026-08-31 重做）：
     * 旧版是【全图一个全局权重】——图 1 与图 17 掉同一套比例，深处毫无"农场感"。
     * 现在改成【每图档一张表】，权重随图档从低到高爬升，且每种材料有"出现时机"门槛：
     *   · 区域材料：全图都有（每图掉自己的），权重随图略升 100→140
     *   · 进化素材(占位键)：档内权重随图升 40→132；具体掉 普通/精粹/传说 由 areaEvolutionTiers
     *     + evoMaterialWeights 决定（高档在本图可用时权重更高，见下）
     *   · 重铸石/增缀石：早期打造主用，图 1 最高、深处淡出（60/50 → 14）
     *   · 剥离石：中期打造，中段达峰后略降
     *   · 合成之石/神圣石：Lv40（≈图7）才出现（合成/高阶重Roll解锁），之后随图升到 70
     *   · 涅磐兽：Lv60（≈图10）才出现（涅槃解锁），从 0 爬到 75——解决旧版"深处最需要的材料掉落最稀"的瓶颈
     * 表中【没有的键 = 该图还不出】（出现时机靠缺省控制，不在表里就不进子池）。
     * 改这里只动材料比例，不碰掉落率总盘（drop.pool）。 */
    materialWeightsByTier: {
      1:  { '区域材料': 100, '进化素材': 40, '重铸石': 60, '增缀石': 50, '剥离石': 15, '鉴定石': 55 },
      2:  { '区域材料': 100, '进化素材': 46, '重铸石': 56, '增缀石': 52, '剥离石': 18, '鉴定石': 50 },
      3:  { '区域材料': 105, '进化素材': 52, '重铸石': 52, '增缀石': 54, '剥离石': 22, '鉴定石': 46 },
      4:  { '区域材料': 105, '进化素材': 58, '重铸石': 48, '增缀石': 54, '剥离石': 26, '鉴定石': 42 },
      5:  { '区域材料': 110, '进化素材': 64, '重铸石': 44, '增缀石': 52, '剥离石': 30, '鉴定石': 38 },
      6:  { '区域材料': 110, '进化素材': 70, '重铸石': 40, '增缀石': 50, '剥离石': 33, '鉴定石': 34 },
      7:  { '区域材料': 115, '进化素材': 76, '重铸石': 34, '增缀石': 48, '剥离石': 36, '合成之石': 30, '神圣石': 25, '鉴定石': 18 },
      8:  { '区域材料': 115, '进化素材': 82, '重铸石': 30, '增缀石': 46, '剥离石': 38, '合成之石': 38, '神圣石': 32, '鉴定石': 16 },
      9:  { '区域材料': 120, '进化素材': 88, '重铸石': 26, '增缀石': 42, '剥离石': 40, '合成之石': 44, '神圣石': 38, '鉴定石': 14 },
      10: { '区域材料': 125, '进化素材': 94, '增缀石': 38, '剥离石': 40, '合成之石': 50, '神圣石': 44, '涅磐兽': 25, '鉴定石': 12 },
      11: { '区域材料': 128, '进化素材': 100, '增缀石': 34, '剥离石': 38, '合成之石': 54, '神圣石': 50, '涅磐兽': 35, '鉴定石': 10 },
      12: { '区域材料': 130, '进化素材': 106, '增缀石': 30, '剥离石': 36, '合成之石': 58, '神圣石': 54, '涅磐兽': 45, '鉴定石': 9 },
      13: { '区域材料': 132, '进化素材': 112, '增缀石': 26, '剥离石': 34, '合成之石': 60, '神圣石': 58, '涅磐兽': 55, '鉴定石': 8 },
      14: { '区域材料': 135, '进化素材': 118, '增缀石': 22, '剥离石': 32, '合成之石': 62, '神圣石': 62, '涅磐兽': 62, '鉴定石': 7 },
      15: { '区域材料': 138, '进化素材': 124, '增缀石': 18, '剥离石': 30, '合成之石': 65, '神圣石': 66, '涅磐兽': 68, '鉴定石': 6 },
      16: { '区域材料': 140, '进化素材': 128, '增缀石': 16, '剥离石': 28, '合成之石': 67, '神圣石': 68, '涅磐兽': 70, '鉴定石': 5 },
      17: { '区域材料': 140, '进化素材': 132, '增缀石': 14, '剥离石': 26, '合成之石': 70, '神圣石': 70, '涅磐兽': 75, '鉴定石': 4 }
    },
    // 进化素材档位权重（仅在本图 areaEvolutionTiers 允许的档位里生效）：
    // 高档相对权重更高 → 深处"只掉传说"的图传说频率拉满，中段多档图传说也偏多（出现时机的梯度）。
    evoMaterialWeights: { '进化素材': 50, '精粹进化素材': 70, '传说进化素材': 100 },
    phoenixName: '涅磐兽',
    synthesizeName: '合成之石',
    // 每图允许掉的进化素材档位：key=区域 id，value=该图可掉的素材名数组（掉落时随机选一个）
    // 档位按「图等级段」递进（2026-08-30 地图重排后同步）：图1-2 普通 / 图3-4 普通+精粹 /
    // 图5 三档 / 图6-8 精粹+传说 / 图9-10 传说。图9 魂渊与图10 腐变之源同档（都是最终段）。
    areaEvolutionTiers: {
      'corrupted-forest': ['进化素材'],
      'plague-swamp':    ['进化素材'],
      'shadow-mountains':['进化素材', '精粹进化素材'],
      'bone-wastes':     ['进化素材', '精粹进化素材'],
      'blood-rift':      ['进化素材', '精粹进化素材', '传说进化素材'],
      'echo-cliffs':     ['精粹进化素材', '传说进化素材'],
      'rotfen-bog':      ['精粹进化素材', '传说进化素材'],
      'ember-hollow':    ['精粹进化素材', '传说进化素材'],
      'soul-abyss':      ['传说进化素材'],
      'blight-heart':    ['传说进化素材'],
      /* ---- 2026-08-31 第二幕（图 11-17）：全传说档（不新增档位，克制）---- */
      'rift-fissure':      ['传说进化素材'],
      'black-blood-moor':  ['传说进化素材'],
      'bone-abyss':        ['传说进化素材'],
      'plague-heart':      ['传说进化素材'],
      'soul-nest':         ['传说进化素材'],
      'annihilation-hall': ['传说进化素材'],
      'blight-origin':     ['传说进化素材']
    },
    // 每图专属材料：key=区域 id，value={ name 材料名 }
    // 掉落率由 materialWeightsByTier 里的'区域材料'键统一承载（改法一后不再读独立 chance，
    // 旧 chance:0.05 字段已删——它是单池改造前的死配置，留着会误导调数值的人）。
    // 玩家为收集某材料会去对应图挂机（驱动"任务收集"）。
    areaMaterials: {
      'corrupted-forest': { name: '枯荣种荚' },
      'plague-swamp':    { name: '泣腐之泪' },
      'shadow-mountains':{ name: '白骨残片' },
      'bone-wastes':     { name: '幽影魂丝' },
      'blood-rift':      { name: '血潮凝晶' },
      'blight-heart':    { name: '腐变之心' },
      'echo-cliffs':     { name: '回响之羽' },
      'rotfen-bog':      { name: '腐沼黏液' },
      'ember-hollow':    { name: '余烬残灰' },
      'soul-abyss':      { name: '魂渊之尘' },
      /* ---- 图 11-17 专属材料 ---- */
      'rift-fissure':      { name: '裂隙碎片' },
      'black-blood-moor':  { name: '黑血凝块' },
      'bone-abyss':        { name: '深渊骸片' },
      'plague-heart':      { name: '疫潮胞核' },
      'soul-nest':         { name: '噬魂丝茧' },
      'annihilation-hall': { name: '湮灭残响' },
      'blight-origin':     { name: '本源腐核' }
    },
    // 任务系统：每图一个收集任务（收集该图专属材料），数量大胆、奖励含少量进化素材（辅助，非主力）。
    // 进化素材奖励控制在低量（1次任务给2个，够几小步进化），避免玩家靠刷任务白嫖进化、失去"刷图掉素材"的意义。
    // 任务跟图绑定：打过图N才解锁图N任务。
    // 任务表 v1（详见 docs/任务表 v1.md）：新手成长 12 + 主线 24 + 日常 12 + 成就 6 = 54 条
    // 字段：category(tutorial/main/daily/achieve) / type(见 quest.js) / need 需求数量
    //       unlockLevel 等级解锁（主线日常成就） / requires 前置任务（新手链线性引导）
    //       repeat 每日刷新 / name 任务名 / guide 引导条跳转目标 / reward 奖励材料
    //       rewardGear 奖励装备件数（新手链专用：送实体装备，不是材料）
    quests: [
      /* ---- 新手成长 12 条：线性引导，做完一条出下一条，全部一次性 ---- */
      { id: 't1', category: 'tutorial', type: 'kill', need: 1, name: '初醒', guide: { page: 'battle', btn: '去挂机' }, isGuide: true, hint: '点击 <b>开始自动战斗</b> 击败 1 只怪物', target: '#btn-battle', reward: { 重铸石: 1 } },
      /* t2 送 1 件蓝装（2026-08-31 用户拍板）：下一条 t3「披上残甲」要求穿 1 件装备，
       * 而装备靠单池 equipment 档掉落（改法一后概率仍低），新手期 10 场大概率捡不到 ——
       * 引导会卡死在「去穿装备」但背包空的死循环。所以前置任务直接发一件，
       * 玩家拿到就能穿，同时也第一次看见「装备」这个东西长什么样。 */
      { id: 't2', category: 'tutorial', type: 'kill', need: 10, requires: 't1', name: '熟悉腐土', guide: { page: 'battle', btn: '去挂机' }, isGuide: true, hint: '点击 <b>开始自动战斗</b> 累计击败 10 只怪物', target: '#btn-battle', reward: { 进化素材: 1 }, rewardGear: { count: 1, areaTier: 1, rarity: 'blue', materialTier: 3 } },
      { id: 't3', category: 'tutorial', type: 'equip', need: 1, requires: 't2', name: '披上残甲', guide: { page: 'pet', tab: 'equip', btn: '去穿装备' }, isGuide: true, hint: '在宠物资料页打开 <b>装备</b> 栏，穿上一件装备', target: '.pet-tab[data-pet-tab="equip"]', reward: { 重铸石: 1 } },
      // t11/t12 是「升级缓冲」：进化门槛 Lv10（按 exp 公式约需累计 78 场），t3 后直接接进化的话，
      // 玩家要干等 20 分钟且引导条一直卡在 0/1。这两条让进度条持续动，玩家边刷边到 Lv10。
      // 注意：kill 类进度在 reportType 里按 type 全量累加（不分任务），所以 need 是「累计击败数」而非增量。
      { id: 't11', category: 'tutorial', type: 'kill', need: 30, requires: 't3', name: '腐土巡守', guide: { page: 'battle', btn: '去挂机' }, isGuide: true, hint: '继续 <b>自动战斗</b>，累计击败 30 只怪物', target: '#btn-battle', reward: { 重铸石: 2 } },
      { id: 't12', category: 'tutorial', type: 'kill', need: 80, requires: 't11', name: '腐土猎手', guide: { page: 'battle', btn: '去挂机' }, isGuide: true, hint: '继续 <b>自动战斗</b>，累计击败 80 只怪物', target: '#btn-battle', reward: { 进化素材: 1 } },
      { id: 't13', category: 'tutorial', type: 'soulcast', need: 1, requires: 't10', name: '魂铸传承', guide: { page: 'equip', tab: 'soulcast', btn: '去魂铸' } },
      { id: 't4', category: 'tutorial', type: 'evolve', need: 1, requires: 't12', name: '第一次进化', guide: { page: 'pet', tab: 'evolve', btn: '去进化' }, isGuide: true, hint: '在宠物资料页打开 <b>进化</b> 栏，完成第一次进化', target: '.pet-tab[data-pet-tab="evolve"]', reward: { 进化素材: 2 } },
      { id: 't5', category: 'tutorial', type: 'craft', need: 1, requires: 't4', name: '初次淬炼', guide: { page: 'equip', btn: '去打造' }, isGuide: true, hint: '去 <b>打造</b> 页打造 1 件装备', target: '.sb-btn[data-page="equip"]', reward: { 神圣石: 1 } },
      { id: 't6', category: 'tutorial', type: 'salvage', need: 1, requires: 't5', name: '拆解废品', guide: { page: 'equip', btn: '去分解' }, isGuide: true, hint: '在打造页点击 <b>一键分解</b> 分解废品', target: '#btn-salvage', reward: { 增缀石: 1 } },
      { id: 't7', category: 'tutorial', type: 'hatch', need: 1, requires: 't6', name: '新的生命', guide: { page: 'pet', tab: 'profile', btn: '去孵化' }, isGuide: true, hint: '在宠物资料页 <b>资料</b> 栏打开孵化面板，孵化 1 颗蛋', target: '#egg-panel', reward: { 宠物蛋: 1 } },
      { id: 't8', category: 'tutorial', type: 'list', need: 1, requires: 't7', name: '第一次交易', guide: { page: 'market-sell', btn: '去上架' }, isGuide: true, hint: '去 <b>市集</b> 页上架 1 件装备', target: '.sb-btn[data-page="market"]', reward: { 合成之石: 1 } },
      { id: 't9', category: 'tutorial', type: 'synth', need: 1, requires: 't8', name: '初次融合', guide: { page: 'pet', tab: 'synth', btn: '去合成' }, isGuide: true, hint: '在宠物资料页打开 <b>合成</b> 栏，完成一次合成', target: '.pet-tab[data-pet-tab="synth"]', reward: { 精粹进化素材: 1 } },
      { id: 't10', category: 'tutorial', type: 'nirvana', need: 1, requires: 't9', name: '脱胎换骨', guide: { page: 'pet', tab: 'merge', btn: '去涅槃' }, isGuide: true, hint: '在宠物资料页打开 <b>涅槃</b> 栏，完成一次涅槃', target: '.pet-tab[data-pet-tab="merge"]', reward: { 涅磐兽: 1, 合成之石: 1 } },

      /* ---- 主线 40 条：10 图 × 4 条（击败 / 收集 / 养成 / 装备），按等级解锁。
       * ⚠️ 2026-08-30 地图重排：腐变之源做最终图（55-60），回响崖/腐沼泽/余烬渊/魂渊依次提前。
       *    任务组跟随图顺序（area 即图 id），unlockLevel 必须与对应图 levelRange 对齐。 ---- */
      { id: 'm1', category: 'main', type: 'kill', area: 'corrupted-forest', need: 30, unlockLevel: 1, name: '初入腐土', reward: { 进化素材: 2 } },
      { id: 'm2', category: 'main', type: 'collect', matName: '枯荣种荚', need: 50, unlockLevel: 1, name: '采摘种荚', reward: { 进化素材: 2, 重铸石: 1 } },
      { id: 'm3', category: 'main', type: 'evolve', need: 1, unlockLevel: 1, name: '第一次进化', reward: { 进化素材: 3 } },
      { id: 'm4', category: 'main', type: 'equipDrop', need: 3, unlockLevel: 2, name: '披上残甲', reward: { 重铸石: 2 } },
      { id: 'm5', category: 'main', type: 'kill', area: 'plague-swamp', need: 60, unlockLevel: 7, name: '踏入泥沼', reward: { 进化素材: 2, 剥离石: 1 } },
      { id: 'm6', category: 'main', type: 'collect', matName: '泣腐之泪', need: 80, unlockLevel: 7, name: '收集泣泪', reward: { 进化素材: 3 } },
      { id: 'm7', category: 'main', type: 'evolve', need: 2, unlockLevel: 7, name: '二次进化', reward: { 精粹进化素材: 1 } },
      { id: 'm8', category: 'main', type: 'craft', need: 2, unlockLevel: 8, name: '初次淬炼', reward: { 重铸石: 2 } },
      { id: 'm9', category: 'main', type: 'kill', area: 'shadow-mountains', need: 100, unlockLevel: 13, name: '白骨之路', reward: { 精粹进化素材: 1, 剥离石: 2 } },
      { id: 'm10', category: 'main', type: 'collect', matName: '白骨残片', need: 120, unlockLevel: 13, name: '拾捡残骨', reward: { 精粹进化素材: 2 } },
      { id: 'm11', category: 'main', type: 'evolve', need: 3, unlockLevel: 13, name: '三次进化', reward: { 精粹进化素材: 2, 涅磐兽: 1 } },
      { id: 'm12', category: 'main', type: 'salvage', need: 3, unlockLevel: 14, name: '拆解废品', reward: { 增缀石: 2 } },
      { id: 'm13', category: 'main', type: 'kill', area: 'bone-wastes', need: 150, unlockLevel: 19, name: '追逐幽影', reward: { 精粹进化素材: 2, 神圣石: 1 } },
      { id: 'm14', category: 'main', type: 'collect', matName: '幽影魂丝', need: 160, unlockLevel: 19, name: '收集魂丝', reward: { 传说进化素材: 1 } },
      { id: 'm15', category: 'main', type: 'hatch', need: 3, unlockLevel: 19, name: '孵化新宠', reward: { 宠物蛋: 2 } },
      { id: 'm16', category: 'main', type: 'equipDrop', need: 5, unlockLevel: 20, name: '再拾残甲', reward: { 重铸石: 3 } },
      { id: 'm17', category: 'main', type: 'kill', area: 'blood-rift', need: 200, unlockLevel: 25, name: '血潮之中', reward: { 传说进化素材: 1, 神圣石: 2 } },
      { id: 'm18', category: 'main', type: 'collect', matName: '血潮凝晶', need: 200, unlockLevel: 25, name: '凝取血晶', reward: { 传说进化素材: 2 } },
      { id: 'm19', category: 'main', type: 'nirvana', need: 1, unlockLevel: 25, name: '初次涅槃', reward: { 涅磐兽: 2, 传说进化素材: 1 } },
      { id: 'm20', category: 'main', type: 'craft', need: 5, unlockLevel: 26, name: '精炼装备', reward: { 神圣石: 2 } },
      { id: 'm21', category: 'main', type: 'kill', area: 'echo-cliffs', need: 300, unlockLevel: 31, name: '攀上回响崖', reward: { 传说进化素材: 2, 神圣石: 2 } },
      { id: 'm22', category: 'main', type: 'collect', matName: '回响之羽', need: 300, unlockLevel: 31, name: '拾取回响羽', reward: { 传说进化素材: 3 } },
      { id: 'm23', category: 'main', type: 'evolve', need: 5, unlockLevel: 31, name: '五度进化', reward: { 精粹进化素材: 3, 涅磐兽: 2 } },
      { id: 'm24', category: 'main', type: 'salvage', need: 6, unlockLevel: 32, name: '拆解崖间废品', reward: { 增缀石: 3 } },
      { id: 'm25', category: 'main', type: 'kill', area: 'rotfen-bog', need: 360, unlockLevel: 37, name: '踏入腐沼泽', reward: { 传说进化素材: 3, 神圣石: 3 } },
      { id: 'm26', category: 'main', type: 'collect', matName: '腐沼黏液', need: 360, unlockLevel: 37, name: '收集腐沼液', reward: { 传说进化素材: 4 } },
      { id: 'm27', category: 'main', type: 'hatch', need: 5, unlockLevel: 37, name: '孵化沼中生灵', reward: { 宠物蛋: 3 } },
      { id: 'm28', category: 'main', type: 'equipDrop', need: 14, unlockLevel: 38, name: '沼边拾甲', reward: { 重铸石: 4, 增缀石: 4 } },
      { id: 'm29', category: 'main', type: 'kill', area: 'ember-hollow', need: 420, unlockLevel: 43, name: '深入余烬渊', reward: { 传说进化素材: 4, 涅磐兽: 2 } },
      { id: 'm30', category: 'main', type: 'collect', matName: '余烬残灰', need: 420, unlockLevel: 43, name: '掬取余烬灰', reward: { 传说进化素材: 5 } },
      { id: 'm31', category: 'main', type: 'nirvana', need: 2, unlockLevel: 43, name: '二次涅槃', reward: { 涅磐兽: 3, 传说进化素材: 3 } },
      { id: 'm32', category: 'main', type: 'craft', need: 8, unlockLevel: 44, name: '精炼渊火装备', reward: { 神圣石: 4 } },
      { id: 'm33', category: 'main', type: 'kill', area: 'soul-abyss', need: 480, unlockLevel: 49, name: '直面魂渊', reward: { 传说进化素材: 5, 涅磐兽: 3 } },
      { id: 'm34', category: 'main', type: 'collect', matName: '魂渊之尘', need: 480, unlockLevel: 49, name: '凝取魂渊尘', reward: { 传说进化素材: 6 } },
      { id: 'm35', category: 'main', type: 'synth', need: 2, unlockLevel: 49, name: '高阶合成', reward: { 合成之石: 3, 传说进化素材: 4 } },
      { id: 'm36', category: 'main', type: 'equipDrop', need: 18, unlockLevel: 50, name: '魂渊的尽头', reward: { 神圣石: 5, 增缀石: 5 } },
      { id: 'm37', category: 'main', type: 'kill', area: 'blight-heart', need: 550, unlockLevel: 55, name: '直面腐变', reward: { 传说进化素材: 6, 涅磐兽: 4 } },
      { id: 'm38', category: 'main', type: 'collect', matName: '腐变之心', need: 550, unlockLevel: 55, name: '腐变之心', reward: { 传说进化素材: 6 } },
      { id: 'm39', category: 'main', type: 'synth', need: 3, unlockLevel: 55, name: '初次合成', reward: { 合成之石: 4, 传说进化素材: 5 } },
      { id: 'm40', category: 'main', type: 'equipDrop', need: 20, unlockLevel: 56, name: '腐土的尽头', reward: { 神圣石: 6, 增缀石: 6 } },

      /* ---- 2026-08-31 第二幕主线 m41~m68（7 图 × 4 条，unlockLevel 对齐图下限，need/奖励延续递增曲线）---- */
      { id: 'm41', category: 'main', type: 'kill', area: 'rift-fissure', need: 600, unlockLevel: 61, name: '裂隙巡守', reward: { 传说进化素材: 7, 涅磐兽: 5 } },
      { id: 'm42', category: 'main', type: 'collect', matName: '裂隙碎片', need: 600, unlockLevel: 61, name: '拾取裂隙碎片', reward: { 传说进化素材: 7 } },
      { id: 'm43', category: 'main', type: 'synth', need: 3, unlockLevel: 61, name: '裂隙合成', reward: { 合成之石: 4, 传说进化素材: 6 } },
      { id: 'm44', category: 'main', type: 'equipDrop', need: 22, unlockLevel: 62, name: '裂隙的尽头', reward: { 神圣石: 6, 增缀石: 6 } },
      { id: 'm45', category: 'main', type: 'kill', area: 'black-blood-moor', need: 650, unlockLevel: 67, name: '黑血猎行', reward: { 传说进化素材: 7, 涅磐兽: 5 } },
      { id: 'm46', category: 'main', type: 'collect', matName: '黑血凝块', need: 650, unlockLevel: 67, name: '凝取黑血凝块', reward: { 传说进化素材: 8 } },
      { id: 'm47', category: 'main', type: 'synth', need: 3, unlockLevel: 67, name: '沼原合成', reward: { 合成之石: 4, 传说进化素材: 7 } },
      { id: 'm48', category: 'main', type: 'equipDrop', need: 24, unlockLevel: 68, name: '沼原的尽头', reward: { 神圣石: 7, 增缀石: 7 } },
      { id: 'm49', category: 'main', type: 'kill', area: 'bone-abyss', need: 700, unlockLevel: 73, name: '深渊猎骨', reward: { 传说进化素材: 8, 涅磐兽: 6 } },
      { id: 'm50', category: 'main', type: 'collect', matName: '深渊骸片', need: 700, unlockLevel: 73, name: '拾取深渊骸片', reward: { 传说进化素材: 8 } },
      { id: 'm51', category: 'main', type: 'synth', need: 4, unlockLevel: 73, name: '深渊合成', reward: { 合成之石: 5, 传说进化素材: 7 } },
      { id: 'm52', category: 'main', type: 'equipDrop', need: 26, unlockLevel: 74, name: '深渊的尽头', reward: { 神圣石: 7, 增缀石: 7 } },
      { id: 'm53', category: 'main', type: 'kill', area: 'plague-heart', need: 750, unlockLevel: 79, name: '疫潮讨伐', reward: { 传说进化素材: 8, 涅磐兽: 6 } },
      { id: 'm54', category: 'main', type: 'collect', matName: '疫潮胞核', need: 750, unlockLevel: 79, name: '摘取疫潮胞核', reward: { 传说进化素材: 9 } },
      { id: 'm55', category: 'main', type: 'synth', need: 4, unlockLevel: 79, name: '疫潮合成', reward: { 合成之石: 5, 传说进化素材: 8 } },
      { id: 'm56', category: 'main', type: 'equipDrop', need: 28, unlockLevel: 80, name: '疫潮的尽头', reward: { 神圣石: 8, 增缀石: 8 } },
      { id: 'm57', category: 'main', type: 'kill', area: 'soul-nest', need: 800, unlockLevel: 85, name: '巢穴清扫', reward: { 传说进化素材: 9, 涅磐兽: 7 } },
      { id: 'm58', category: 'main', type: 'collect', matName: '噬魂丝茧', need: 800, unlockLevel: 85, name: '收集噬魂丝茧', reward: { 传说进化素材: 9 } },
      { id: 'm59', category: 'main', type: 'synth', need: 4, unlockLevel: 85, name: '巢穴合成', reward: { 合成之石: 5, 传说进化素材: 8 } },
      { id: 'm60', category: 'main', type: 'equipDrop', need: 30, unlockLevel: 86, name: '巢穴的尽头', reward: { 神圣石: 8, 增缀石: 8 } },
      { id: 'm61', category: 'main', type: 'kill', area: 'annihilation-hall', need: 850, unlockLevel: 91, name: '回廊攻坚', reward: { 传说进化素材: 9, 涅磐兽: 7 } },
      { id: 'm62', category: 'main', type: 'collect', matName: '湮灭残响', need: 850, unlockLevel: 91, name: '收录湮灭残响', reward: { 传说进化素材: 10 } },
      { id: 'm63', category: 'main', type: 'synth', need: 5, unlockLevel: 91, name: '回廊合成', reward: { 合成之石: 6, 传说进化素材: 9 } },
      { id: 'm64', category: 'main', type: 'equipDrop', need: 32, unlockLevel: 92, name: '回廊的尽头', reward: { 神圣石: 9, 增缀石: 9 } },
      { id: 'm65', category: 'main', type: 'kill', area: 'blight-origin', need: 900, unlockLevel: 97, name: '直面本源', reward: { 传说进化素材: 10, 涅磐兽: 8 } },
      { id: 'm66', category: 'main', type: 'collect', matName: '本源腐核', need: 900, unlockLevel: 97, name: '挖取本源腐核', reward: { 传说进化素材: 10 } },
      { id: 'm67', category: 'main', type: 'synth', need: 5, unlockLevel: 97, name: '本源合成', reward: { 合成之石: 6, 传说进化素材: 10 } },
      { id: 'm68', category: 'main', type: 'equipDrop', need: 34, unlockLevel: 98, name: '腐变的源头', reward: { 神圣石: 10, 增缀石: 10 } },

      /* ---- 宠物专属 24 条（8 宠 × 3 养成链：孵化 → 带它击杀 → 它进化），独立「🐾 宠物」分类。
       * ⚠️ 机制约定（2026-08-31 用户拍板）：
       *   · petName 字段 = 进度只算「该宠出战」时（reportType 带 ctx.petName，quest.js 里过滤）
       *   · 孵化任务「已拥有该宠（含开局选择）」视为 1/1 完成（否则开局宠卡死）
       *   · 解锁按等级（腐噜兽 Lv1 → 幽影兔 Lv43），没该宠也能看到
       *   · 孵化奖励不直接给蛋：蛋是 Drop 的品种资源，任务奖励走 Materials，给了也用不了
       *     → 给进化素材（练宠燃料）；击杀给进化素材、进化给打造石头；每条固定经验 600（QUEST_EXP_FIXED.pet） ---- */
      { id: 'pe1', category: 'pet', type: 'hatch', petName: '腐噜兽', need: 1, unlockLevel: 1, name: '孵化·腐噜兽', reward: { 进化素材: 1 } },
      { id: 'pe2', category: 'pet', type: 'kill', petName: '腐噜兽', need: 50, unlockLevel: 1, name: '腐噜兽试炼', reward: { 进化素材: 3 } },
      { id: 'pe3', category: 'pet', type: 'evolve', petName: '腐噜兽', need: 1, unlockLevel: 1, name: '腐噜兽的进化', reward: { 重铸石: 2 } },
      { id: 'pe4', category: 'pet', type: 'hatch', petName: '血狐', need: 1, unlockLevel: 7, name: '孵化·血狐', reward: { 进化素材: 2 } },
      { id: 'pe5', category: 'pet', type: 'kill', petName: '血狐', need: 80, unlockLevel: 7, name: '血狐试炼', reward: { 精粹进化素材: 2 } },
      { id: 'pe6', category: 'pet', type: 'evolve', petName: '血狐', need: 1, unlockLevel: 7, name: '血狐的进化', reward: { 神圣石: 2 } },
      { id: 'pe7', category: 'pet', type: 'hatch', petName: '瘟熊', need: 1, unlockLevel: 13, name: '孵化·瘟熊', reward: { 进化素材: 2 } },
      { id: 'pe8', category: 'pet', type: 'kill', petName: '瘟熊', need: 80, unlockLevel: 13, name: '瘟熊试炼', reward: { 精粹进化素材: 2 } },
      { id: 'pe9', category: 'pet', type: 'evolve', petName: '瘟熊', need: 1, unlockLevel: 13, name: '瘟熊的进化', reward: { 神圣石: 2 } },
      { id: 'pe10', category: 'pet', type: 'hatch', petName: '疫毛兽', need: 1, unlockLevel: 19, name: '孵化·疫毛兽', reward: { 精粹进化素材: 1 } },
      { id: 'pe11', category: 'pet', type: 'kill', petName: '疫毛兽', need: 100, unlockLevel: 19, name: '疫毛兽试炼', reward: { 精粹进化素材: 3 } },
      { id: 'pe12', category: 'pet', type: 'evolve', petName: '疫毛兽', need: 1, unlockLevel: 19, name: '疫毛兽的进化', reward: { 剥离石: 2 } },
      { id: 'pe13', category: 'pet', type: 'hatch', petName: '骨狼', need: 1, unlockLevel: 25, name: '孵化·骨狼', reward: { 精粹进化素材: 2 } },
      { id: 'pe14', category: 'pet', type: 'kill', petName: '骨狼', need: 120, unlockLevel: 25, name: '骨狼试炼', reward: { 传说进化素材: 1 } },
      { id: 'pe15', category: 'pet', type: 'evolve', petName: '骨狼', need: 1, unlockLevel: 25, name: '骨狼的进化', reward: { 神圣石: 3 } },
      { id: 'pe16', category: 'pet', type: 'hatch', petName: '毒沼蛙', need: 1, unlockLevel: 31, name: '孵化·毒沼蛙', reward: { 精粹进化素材: 2 } },
      { id: 'pe17', category: 'pet', type: 'kill', petName: '毒沼蛙', need: 120, unlockLevel: 31, name: '毒沼蛙试炼', reward: { 传说进化素材: 1 } },
      { id: 'pe18', category: 'pet', type: 'evolve', petName: '毒沼蛙', need: 1, unlockLevel: 31, name: '毒沼蛙的进化', reward: { 重铸石: 4 } },
      { id: 'pe19', category: 'pet', type: 'hatch', petName: '尸犬', need: 1, unlockLevel: 37, name: '孵化·尸犬', reward: { 传说进化素材: 1 } },
      { id: 'pe20', category: 'pet', type: 'kill', petName: '尸犬', need: 150, unlockLevel: 37, name: '尸犬试炼', reward: { 传说进化素材: 2 } },
      { id: 'pe21', category: 'pet', type: 'evolve', petName: '尸犬', need: 1, unlockLevel: 37, name: '尸犬的进化', reward: { 神圣石: 3, 增缀石: 3 } },
      { id: 'pe22', category: 'pet', type: 'hatch', petName: '幽影兔', need: 1, unlockLevel: 43, name: '孵化·幽影兔', reward: { 传说进化素材: 2 } },
      { id: 'pe23', category: 'pet', type: 'kill', petName: '幽影兔', need: 150, unlockLevel: 43, name: '幽影兔试炼', reward: { 传说进化素材: 3 } },
      { id: 'pe24', category: 'pet', type: 'evolve', petName: '幽影兔', need: 1, unlockLevel: 43, name: '幽影兔的进化', reward: { 涅磐兽: 2 } },

      /* ---- 日常 12 条：每日 00:00 刷新，可重复 ---- */
      { id: 'd1', category: 'daily', type: 'kill', need: 100, repeat: true, name: '每日巡守·一', reward: { 重铸石: 2 } },
      { id: 'd2', category: 'daily', type: 'kill', need: 200, repeat: true, name: '每日巡守·二', reward: { 重铸石: 3 } },
      { id: 'd3', category: 'daily', type: 'collect', matName: '枯荣种荚', need: 20, repeat: true, name: '晨间采集·种荚', reward: { 剥离石: 1 } },
      { id: 'd4', category: 'daily', type: 'collect', matName: '泣腐之泪', need: 20, repeat: true, name: '晨间采集·泣泪', reward: { 剥离石: 1 } },
      { id: 'd5', category: 'daily', type: 'collect', matName: '白骨残片', need: 20, repeat: true, name: '午间拾骨', reward: { 神圣石: 1 } },
      { id: 'd6', category: 'daily', type: 'collect', matName: '幽影魂丝', need: 20, repeat: true, name: '午间抽丝', reward: { 神圣石: 1 } },
      { id: 'd7', category: 'daily', type: 'collect', matName: '血潮凝晶', need: 20, repeat: true, name: '暮间凝晶', reward: { 增缀石: 1 } },
      { id: 'd8', category: 'daily', type: 'collect', matName: '腐变之心', need: 20, repeat: true, name: '暮间取心', reward: { 增缀石: 1 } },
      { id: 'd9', category: 'daily', type: 'craft', need: 3, repeat: true, name: '每日淬炼', reward: { 重铸石: 1 } },
      { id: 'd10', category: 'daily', type: 'salvage', need: 5, repeat: true, name: '每日拆解', reward: { 增缀石: 1 } },
      { id: 'd11', category: 'daily', type: 'hatch', need: 1, repeat: true, name: '每日孵化', reward: { 进化素材: 1 } },
      { id: 'd12', category: 'daily', type: 'trade', need: 2, repeat: true, name: '每日交易', reward: { 合成之石: 1 } },

      /* ---- 成就 6 条：长期累计，永不清零，一次性 ---- */
      { id: 'a1', category: 'achieve', type: 'kill', need: 10000, name: '万兽斩', reward: { 传说进化素材: 5 } },
      { id: 'a2', category: 'achieve', type: 'evolve', need: 50, name: '进化大师', reward: { 传说进化素材: 3 } },
      { id: 'a3', category: 'achieve', type: 'nirvana', need: 20, name: '涅槃行者', reward: { 涅磐兽: 5 } },
      { id: 'a4', category: 'achieve', type: 'synth', need: 20, name: '合成匠人', reward: { 合成之石: 5 } },
      { id: 'a5', category: 'achieve', type: 'hatch', need: 50, name: '孵化之手', reward: { 宠物蛋: 5 } },
      { id: 'a6', category: 'achieve', type: 'craft', need: 100, name: '锻造名师', reward: { 神圣石: 5 } }
    ]
  },

  /* ================= 装备 ================= */
  equipment: {
    // 每个部位的 1 档基底固定值；生成时再乘 baseTierMultipliers（图 1~6）与 materialTierMultipliers（底材 T1~T5）。
    baseValues: {
      武器: { atk: 30 }, 戒指: { atk: 15, crit: 2 }, 项链: { atk: 15, critDamage: 8 },
      头盔: { def: 15 }, 护甲: { hp: 80, def: 8 }, 盾牌: { def: 15, dodge: 5 },
      靴子: { spd: 8 }, 腰带: { hp: 60, spd: 5 }, 斗篷: { dodge: 10, hp: 50 },
      饰品: { atk: 12, hit: 5 }, 护符: { lifesteal: 4 }, 徽章: { crit: 3, critDamage: 10 }
    },
    // 每图档位基底倍数：1~17 图平滑递增（步进 0.25，图17=5.0），与 17 图扩展对齐
    baseTierMultipliers: [1, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5, 3.75, 4.0, 4.25, 4.5, 4.75, 5.0],
    materialTierMultipliers: { 1: 1.5, 2: 1.3, 3: 1, 4: 0.8, 5: 0.6 },
    speedAffixTiers: [
      { tier: 1, min: 12, max: 16 }, { tier: 2, min: 9, max: 11 }, { tier: 3, min: 6, max: 8 },
      { tier: 4, min: 3, max: 5 }, { tier: 5, min: 1, max: 2 }
    ],
    affixTiers: [
      { tier: 1, min: 6, max: 8 }, { tier: 2, min: 4, max: 5 }, { tier: 3, min: 3, max: 4 },
      { tier: 4, min: 2, max: 2 }, { tier: 5, min: 1, max: 1 }
    ],
    // 词缀 T 阶：按稀有度「加权」抽取（T1 最好 → T5 最差）。
    // 以前是 [min,max] 均匀随机：金装 [1,3] → 每条词缀 33% 是 T1，顶级词缀泛滥、没有求而不得感。
    // 第一次改加权后金装 T1 仍 8%（玩家实测"太容易出现 T1"）→ 2026-08-30 再砍到底：
    //   金装 T1 只剩 2%、T2 也少见（13%），顶级词缀是「求而不得」。
    // 白/蓝根本抽不到 T1（想摸 T1 先得有金装，且金装平均 4~6 条词缀 → 每件金装只有 ~10% 概率带 T1）。
    // 掉落 / 重铸 / 增缀 三条获取路径【全部走这一张表】，杜绝绕过稀有度的口子
    // （老 bug：重铸是 randInt(1,5) 均匀且不看成色 → 白装能洗出全 T1，18 次/小时随便刷）。
    affixTierWeights: {
      white: { 4: 60, 5: 40 },
      blue:  { 3: 35, 4: 65 },
      gold:  { 1: 2,  2: 13, 3: 85 }
    },
    // 底材 T 阶分布：每张图一套权重（数字 = 权重，T1 最优 → T5 最差）。
    // 以前是 drop.js 里的线性插值（图6 → T1 占 33%，顶级底材太常见）；改显式表，策划一眼能调。
    // 曲线：图1 几乎摸不到 T1（1%），图6 也才 20% —— T1 底材是"运气好才有的"。
    // 底材 T 阶分布：每张图一套权重（数字 = 权重，T1 最优 → T5 最差）。
    // 曲线：图1 几乎摸不到 T1（1%），图10 升到 42% —— T1 底材高图更常见（沿用原趋势外推）。
    materialTierWeights: {
      1:  { 1: 1,  2: 4,  3: 15, 4: 30, 5: 50 },
      2:  { 1: 2,  2: 6,  3: 18, 4: 32, 5: 42 },
      3:  { 1: 4,  2: 9,  3: 22, 4: 33, 5: 32 },
      4:  { 1: 7,  2: 13, 3: 26, 4: 32, 5: 22 },
      5:  { 1: 12, 2: 18, 3: 28, 4: 27, 5: 15 },
      6:  { 1: 20, 2: 24, 3: 28, 4: 20, 5: 8  },
      7:  { 1: 25, 2: 26, 3: 27, 4: 16, 5: 6  },
      8:  { 1: 30, 2: 27, 3: 25, 4: 13, 5: 5  },
      9:  { 1: 35, 2: 28, 3: 23, 4: 10, 5: 4  },
      10: { 1: 42, 2: 28, 3: 20, 4: 8,  5: 4  },
      /* ---- 2026-08-31 第二幕（图 11-17）：T1 权重延续趋势并收敛（65% 封顶，T5 几乎绝迹）---- */
      11: { 1: 47, 2: 27, 3: 18, 4: 6,  5: 2  },
      12: { 1: 51, 2: 26, 3: 16, 4: 5,  5: 2  },
      13: { 1: 55, 2: 25, 3: 14, 4: 4,  5: 2  },
      14: { 1: 58, 2: 24, 3: 13, 4: 3,  5: 2  },
      15: { 1: 61, 2: 23, 3: 11, 4: 3,  5: 2  },
      16: { 1: 63, 2: 22, 3: 10, 4: 3,  5: 2  },
      17: { 1: 65, 2: 22, 3: 9,  4: 2,  5: 2  }
    },
    // 稀有度（颜色）随图档平滑爬升：17 张图各一组 白/蓝/金 概率（合计 100）。
    // 取代旧版按怪 lootTier 的 3 档枚举（旧版图3~17 全锁 'high'→必出金，15 张图颜色无差异）。
    // 设计：白随深度递减、蓝中段达峰后回落、金随深度单调爬升（图1≈2% → 图17≈79%）。
    // 掉率总盘（drop.pool.equipment≈1.5%）不变，这里只管"出装时是什么颜色"。改这里只动颜色分布。
    rarityWeightsByTier: {
      1:  { white: 80, blue: 18, gold: 2 },
      2:  { white: 70, blue: 27, gold: 3 },
      3:  { white: 58, blue: 37, gold: 5 },
      4:  { white: 47, blue: 45, gold: 8 },
      5:  { white: 38, blue: 50, gold: 12 },
      6:  { white: 30, blue: 52, gold: 18 },
      7:  { white: 24, blue: 52, gold: 24 },
      8:  { white: 19, blue: 50, gold: 31 },
      9:  { white: 15, blue: 47, gold: 38 },
      10: { white: 11, blue: 44, gold: 45 },
      11: { white: 8,  blue: 40, gold: 52 },
      12: { white: 6,  blue: 36, gold: 58 },
      13: { white: 4,  blue: 32, gold: 64 },
      14: { white: 3,  blue: 28, gold: 69 },
      15: { white: 2,  blue: 25, gold: 73 },
      16: { white: 2,  blue: 22, gold: 76 },
      17: { white: 1,  blue: 20, gold: 79 }
    },
    /* 装备评分：把「部位 / 图档 / 底材T / 稀有度 / 词缀类型 × T阶 × 数值」这 7 个维度
     * 压成一个整数，让玩家能一眼比较、排序、按阈值批量清理 —— 装备"又多又乱"的根治手段。
     * 分【只用于比较与排序】，不参与任何战斗计算。
     *   stat     = 固定值属性/基底：1 点算多少分（hp 数值大，权重低）
     *   pct      = 百分比词缀（atk%/hp%/def%，作用于宠物裸属性）：1% 算多少分
     *   resource = 资源类词缀（掉落数量/稀有度/材料率，不加战力）：1% 算多少分。
     *     权重要压住：它不涨战力、只是刷图收益。初版给 30/1% 时一条 +6% 掉量 = 180 分，
     *     把攻击/暴击这些真战力词缀全碾压，评分就失去意义了。
     */
    score: {
      stat: { atk: 1, hp: 0.2, def: 1, spd: 1.5, hit: 1, dodge: 1, crit: 2, critDamage: 0.5, lifesteal: 3 },
      pct:  { atk: 5, hp: 5, def: 5 },
      resource: { dropQty: 8, dropRare: 6, matDrop: 6 }
    },
    // 稀有度（颜色）由词缀总条数唯一决定：1 条=白 / 2 条=蓝 / 3 条及以上=金。
    // 掉落时先由图档定稀有度→再定词缀条数区间（白1/蓝2/金3~6），与条数天然一致；
    // 打造（增缀/剥离/重铸）加减词缀后调 equipment.syncRarity 把颜色同步成当前条数，保证"颜色随词缀走"。
    rarities: [
      { id: 'white', label: '白色', color: '#b2aa9c', affixMin: 1, affixMax: 1 },
      { id: 'blue', label: '蓝色', color: '#4a6fa8', affixMin: 2, affixMax: 2 },
      { id: 'gold', label: '金色', color: '#f2b632', affixMin: 3, affixMax: 6 }
    ]
  },

  /* ================= 打造通货 ================= */
  craft: {
    // 重铸石：随机重铸装备全部词缀（数量 / 类型 / T 阶 / 数值 全部随机）
    reforge: {
      name: '重铸石', amount: 1, icon: '<img class="mat-img" src="assets/icons/final/item_whetstone.png" alt="">',
      effect: '随机重铸全部词缀：数量、类型、T 阶、数值全部重新随机。',
      rule: '会清空并重洗当前词条，组合与数值都不可控，风险远高于收益。'
    },
    // 剥离石：随机移除一条词缀（仅剩 1 条时不可用）
    strip: {
      name: '剥离石', amount: 1, icon: '<img class="mat-img" src="assets/icons/final/item_flay_shard.png" alt="">',
      effect: '随机移除装备一条词缀。',
      rule: '装备仅剩 1 条词缀时无法使用。'
    },
    // 神圣石：重 Roll 装备【全部】词缀的数值（类型不变、T 阶不变，数值在该 T 阶范围内重新随机）
    holy: {
      name: '神圣石', amount: 1, icon: '<img class="mat-img" src="assets/icons/final/item_sacred_stone.png" alt="">',
      effect: '重随全部词缀的数值，词缀类型与 T 阶不变。',
      rule: '适合在词缀组合已确定后追求更高数值。'
    },
    // 增缀石：给装备【新增】一条随机词缀（类型随机不重复、T 阶随机 1~5；满 3 条不可用）
    augment: {
      name: '增缀石', amount: 1, icon: '<img class="mat-img" src="assets/icons/final/item_rune_stone.png" alt="">',
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
      { id: 'egg',     name: '宠物蛋', icon: '🥚', category: 'egg' },
      // 凝魂晶石：满级宠物把溢出经验凝出来的产物（见 Config.pet.expPool），只在第二幕产出
      { id: 'soulcrystal', name: '凝魂晶石', icon: '🔷', category: 'soul' },
      // 鉴定石：消耗品，鉴定未鉴定装备用（拖到装备上 / 点「鉴定」）。前期好掉、后期稀缺
      { id: 'identify', name: '鉴定石', icon: '🔍', category: 'stone' }
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
  /* ================= 宠物血脉特质 + 魂铸系统（设计 v1） =================
   * T 阶口径：T1 最强最稀有（与装备词缀惯例一致）；特质一律不含攻击%。
   * 结算桶：critRate/critDamage/lifesteal/hit/dodge/spd → flat 点数（getStats 再 ÷100 或点数）；
   *         hp/def → pct 百分比（÷100）。 */
  petTraits: {
    '嗜血': { type: 'lifesteal', label: '吸血', values: { 1: 8, 2: 5, 3: 3 } },    // %（flat 点数）
    '狂暴': { type: 'critDamage', label: '暴击伤害', values: { 1: 25, 2: 15, 3: 8 } },
    '战意': { type: 'critRate', label: '暴击率', values: { 1: 6, 2: 4, 3: 2 } },
    '精准': { type: 'hit', label: '命中', values: { 1: 12, 2: 8, 3: 5 } },
    '疾风': { type: 'spd', label: '速度', values: { 1: 8, 2: 5, 3: 3 } },
    '铁壁': { type: 'def', label: '防御', values: { 1: 12, 2: 8, 3: 5 } },        // %（pct）
    '坚韧': { type: 'hp', label: '生命', values: { 1: 12, 2: 8, 3: 5 } },         // %（pct）
    '灵巧': { type: 'dodge', label: '闪避', values: { 1: 8, 2: 5, 3: 3 } },
  },
  traitHatch: {
    counts: [40, 45, 13, 2],     // 0/1/2/3 条概率 %（索引 = 条数）
    tierRoll: [0, 10, 30, 60],   // T1/T2/T3 概率 %（索引 = 阶）
    mutant: { minCount: 1, count3: 8, t1Boost: 20, minTier: 2 },  // 变异：保底1条、3条 2→8%、T1 10→20%、保底≥T2
  },
  awakenBonus: {   // 血统线定位加成（觉醒特质 = 对应主动技能伤害+20% + 此加成）
    '腐噜兽': { hp: 5 },        // 生命+5%
    '血狐': { critDamage: 10 }, // 暴伤+10%
    '瘟熊': { def: 8 },         // 防御+8%
    '疫毛兽': { spd: 4 },       // 速度+4
    '骨狼': { lifesteal: 3 },   // 吸血+3%
    '毒沼蛙': { hp: 5 },        // 生命+5%
    '尸犬': { lifesteal: 3 },   // 吸血+3%
    '幽影兔': { spd: 4 },       // 速度+4
  },
  awakenSkillDamage: 0.2,  // 终形态 Lv60 觉醒：对应主动技能伤害 +20%
  traitInherit: {
    mainKeep: 0.7,     // 合成：主宠每条特质保留概率（9/1 契约字段名）
    subKeep: 0.4,      // 合成：副宠每条继承概率
    synthKeep: 0.7,    // 兼容别名
    synthGive: 0.4,    // 合成：副宠每条特质继承概率
    up: 0.2,           // 继承时 T 阶 +1 概率（封顶 T1）
    down: 0.1,         // 继承时 T 阶 -1 概率（最低 T3）
    growthBonus: 0.1,  // 主宠成长≥60：整体 +10%（一档封顶）
    growthMin: 60,
    cap: 3,            // 特质总条数上限
    mutantExtra: 1,    // 合成变异成功额外追 1 条随机新特质
  },
  traitNirvana: {
    implantChance: 0.3,  // 涅槃：副宠每条特质植入主宠概率
    takeHigherT: true,   // 同类型取高 T，不叠加
  },
  soulCast: {
    material: '凝魂晶石', materialCount: 10,
    tiers: {
      normal: { label: '普通', minLevel: 40, minGrowth: 10, source: 'blood', tierShift: 0 },
      elite: { label: '精锐', minLevel: 40, minGrowth: 40, source: 'blood', tierShift: 1 },
      legend: { label: '传承', minLevel: 60, minGrowth: 60, source: 'awaken', tierShift: 0, needFinal: true },
    },
    maxSoulAffixes: 1,  // 每件装备最多 1 条魂铸词缀
  },
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
    minLevel: 60,           // 主宠与副宠必须达到的等级（2026-08-31：40→60，第二幕开涅槃，与终形态/学技能同点毕业）
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
    // 可选加成：额外投入凝魂晶石，本次吸收 ×(1 + absorbBonus)。不投则走原数值，玩家自选。
    crystalBonus: { material: '凝魂晶石', amount: 10, absorbBonus: 0.3 },
    resetLevel: true,       // 涅槃后主宠等级重置为 1（重新练级）
    maxGrowth: 100          // 成长软上限（可配；达上限后涅槃不再涨成长，仅重置等级）
  },

  /* ================= 魔石 + 商店（自测阶段，不对外收费） =================
   * 货币：魔石（1 元 = 10 魔石，仅作定价基准，目前不开放任何收款渠道）。
   * ⚠️ 2026-08-31 用户拍板：**不做个人收款码 / 私下转账**（易被举报、且违反微信/支付宝个人码的服务协议）。
   *    正式收款只走官方支付 SDK（微信支付/支付宝商户号），前置条件是企业或个体户主体 + 版号 + ICP 等资质；
   *    没有合规收款渠道之前，魔石一律由管理员用 grant_gems 发放，界面不得出现任何引导转账的内容。
   * ⚠️ 价格与商品以数据库 products 表为准（服务端定价，前端改不动）；
   *    改价格去 supabase/migrate_shop.sql 的 products 初始数据（price_cents ÷ 10 = gems）。
   * 依赖：先跑 migrate_shop.sql，否则钱包/商品接口会报「表不存在」，界面给出提示而不是崩。
   * ⚠️ enabled：魔石系统总开关。false = 顶栏余额、侧边栏「魔石商店」入口、商店页全部隐藏，
   *    且不再请求钱包/商品/订单接口。正式上线（支付 SDK + 资质齐了）改回 true 即可，其余代码不用动。 */
  shop: {
    enabled: false,
    currency: '魔石',
    rmbPerGem: 0.1,            // 1 元 = 10 魔石（仅用于界面换算展示）
    selfTestNote: '自测阶段：魔石由管理员直接发放（grant_gems），不开放任何收款渠道。正式收款需接入官方支付 SDK，并具备企业主体与版号等资质。',
    // 卡密兑换结果文案（服务端返回码 → 玩家能看懂的话）
    redeemMessages: {
      nologin: '请先登录再兑换',
      notfound: '卡密无效，检查有没有输错',
      used: '这张卡密已经用过了',
      expired: '这张卡密已过期',
      forbidden: '没有权限'
    }
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

  /* ================= 开发者模式（仅管理员账号可见入口） =================
   * adminEmails：登录邮箱在这个名单里，左侧边栏才显示「开发者」按钮。
   * 开发者面板只改内存中的 Config（刷新复原），不写库、不改文件。 */
  dev: {
    adminEmails: ['776492620@qq.com']
  }
};
