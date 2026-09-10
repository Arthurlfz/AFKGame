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
      // ⚠️ 不配 emoji icon（2026-09-10 移除占位头像）：头像/立绘一律由 PetSprites 按名字解析真实素材
      { name: '腐噜兽', growth: 5, baseHp: 110, baseAtk: 22, baseDef: 11, statCoeff: { hp: 4.9, atk: 2.38, def: 1.02 } }, // 均衡（spd 80）
      { name: '血狐',   growth: 5, baseHp: 85,  baseAtk: 30, baseDef: 8,  statCoeff: { hp: 3.22, atk: 2.22, def: 0.92 } }, // 暴击爆发（最脆，spd 96）
      { name: '瘟熊',   growth: 5, baseHp: 160, baseAtk: 18, baseDef: 18, statCoeff: { hp: 5.7, atk: 2.42, def: 1.12 } }, // 坦克（最慢最肉，spd 70）
      { name: '疫毛兽', growth: 5, baseHp: 95,  baseAtk: 26, baseDef: 9,  statCoeff: { hp: 4, atk: 2.28, def: 0.96 } },   // 敏捷输出（spd 92）
      { name: '骨狼',   growth: 5, baseHp: 105, baseAtk: 25, baseDef: 10, statCoeff: { hp: 4.3, atk: 2.24, def: 0.99 } }, // 攻击均衡（spd 88）
      { name: '毒沼蛙', growth: 5, baseHp: 130, baseAtk: 20, baseDef: 14, statCoeff: { hp: 5.2, atk: 2.36, def: 1.08 } }, // 耐久坦克（spd 75）
      { name: '尸犬',   growth: 5, baseHp: 120, baseAtk: 21, baseDef: 13, statCoeff: { hp: 4.6, atk: 2.25, def: 1.05 } }, // 均衡偏坦（spd 84）
      { name: '幽影兔', growth: 5, baseHp: 70,  baseAtk: 24, baseDef: 7,  statCoeff: { hp: 3.35, atk: 2.34, def: 0.90 } }  // 极速闪避（最快，spd 100）
    ],
    // 旧莱姆只作为历史存档/孵化兼容基准，不再作为新玩家默认初始宠物
    legacyBase: { name: '莱姆', growth: 5, hp: 100, atk: 20, def: 10, spd: 40 },
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
    // 2026-09-03 拍板：上限定为 60（60 级毕业）。图 1-10 覆盖 1-60 级 = 完整成长主流程
    //   （2026-09-06 地图精简 17→10：图 10 腐变之源 = 毕业，终形态 + 学技能 + 神级宠之门）。
    // maxLevel 与图的等级段必须同步（改这里必须确认图 10 的上限是 60）。
    // 注意：涅槃要求 ≥ nirvana.minLevel（60），上限 = 门槛，60 级即可涅槃。
    maxLevel: 60,
    /* 满级经验池：满级后溢出经验不再蒸发，先攒进池子，每满 perCrystal 自动凝 1 颗「凝魂晶石」。
     * 定位：满级挂机 = 凝魂晶石农场，晶石是账号级材料（涅槃加成 / 市场交易），
     * 让"练满之后继续挂"有产出，而不是纯浪费。
     * ponytail: 池内零头只存本地不落库（刷新丢 < perCrystal 的部分，晶石本身走 Materials 云端） */
    expPool: { perCrystal: 12000, material: '凝魂晶石' },
    // 孵化的新宠物成长值范围
    babyGrowth: { min: 3, max: 8 },
    // 进化系统：通用素材 + 可配置多层分叉树；每段独立配置等级门槛
    evolution: {
      /* 5 阶进化（2026-09-06 按《系统重设计·落地执行手册_v1》2.5 重排）
       * 旧：maxEvolveTimes 10（3 次换形态 10/35/60 + 7 次「继续进化（成长+）」占位）
       * 新：4 次进化 = 5 个阶段（初始 / 一阶 / 二阶 / 三阶 / 终阶），门槛 Lv10 / 25 / 40 / 60。
       *   · 一阶 Lv10、二阶 Lv25、终阶 Lv60 = 换形态（形态树里本来就有这三段，零美术成本）
       *   · 三阶 Lv40 = 淬体阶（keepForm：形态不变，只涨成长 +0.3~0.4，是普通阶的两倍）
       *     —— 手册要求「每阶外观变化」，但形态树只有 3 层，加一层要 16 个新形态名 + 16 张立绘（美术缺口，见落地方案 R4）
       *   · 终阶额外消耗 finalExtra = 手册 2.5 的「传说进化素材 + 特殊道具」，特殊道具手册没定义
       *     → 暂用「传说进化素材 ×3」承载，不新增道具/图标（见落地方案 R3）
       * evolveStage = 已进化次数 + 1（1=初始 … 5=终阶）；素材档位由「当前阶」决定，不再猜次数。 */
      maxEvolveTimes: 4,
      stages: [
        { stage: 1, label: '初始', minLevel: 1,  material: null,           amount: 0, growthBoost: [0, 0],     form: false, desc: '孵化出来的形态' },
        { stage: 2, label: '一阶', minLevel: 10, material: '进化素材',     amount: 1, growthBoost: [0.1, 0.2], form: true,  desc: '初次蜕变（引导任务 G2）' },
        { stage: 3, label: '二阶', minLevel: 25, material: '精粹进化素材', amount: 1, growthBoost: [0.1, 0.2], form: true,  desc: '中期进化' },
        { stage: 4, label: '三阶', minLevel: 40, material: '传说进化素材', amount: 1, growthBoost: [0.3, 0.4], form: false, desc: '淬体：形态不变，成长大幅提升（合成解锁）' },
        { stage: 5, label: '终阶', minLevel: 60, material: '传说进化素材', amount: 1, growthBoost: [0.1, 0.2], form: true,  desc: '最终形态：主动技能（觉醒改由宠物页·觉醒页用觉醒石激活）', extra: { name: '传说进化素材', amount: 3 } }
      ],
      materialName: '进化素材',
      // 进化道具（2026-09-06 第二版手册 2.0）：可选增强。进化页下拉框选一颗消耗，
      // 成长提升 = 基础提升（stage.growthBoost 区间随机）× (1 + 道具boost)。不选/没有则按基础提升，行为与旧版一致。
      boostItems: ['evo_dan_a', 'evo_dan_b', 'evo_jade'],
      // 兼容性旧字段（UI/测试引用）：进化成长提升每次 +0.1~0.2（三阶淬体 +0.3~0.4 走 stages）
      growthBoost: [0.1, 0.2],
      // 当前阶（1~5）：由已进化次数推导，UI/逻辑统一走这个，别各处自己算
      stageOf: (pet) => {
        const max = (window.Config.pet.evolution && window.Config.pet.evolution.maxEvolveTimes) || 4;
        return Math.min(max + 1, Math.max(1, (pet && (pet.evolveStage != null ? pet.evolveStage : (pet.evolveTimes || 0) + 1)) || 1));
      },
      // 下一阶配置（已满阶返回 null）
      nextStage: (pet) => {
        const E = window.Config.pet.evolution;
        const cur = E.stageOf(pet);
        return (E.stages || []).find(s => s.stage === cur + 1) || null;
      },
      /* 2026-09-06 重排：10 / 25 / 40 / 60（原 10/35/60）
       * Lv60 = 终形态 + 学主动技能（毕业）；神级宠合成的「终阶」门槛就是这一阶。 */
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
      // 路线只配「进化到哪 / 几级解锁」；目标形态头像由 PetSprites.avatarOf(to) 按名字取真实素材（2026-09-10 移除 emoji 占位）
      tree: {
        '腐噜兽': [ { to: '腐沼兽', minLevel: 10 }, { to: '毒噜兽', minLevel: 10 } ],
        '血狐': [ { to: '血牙狐', minLevel: 10 }, { to: '幽火狐', minLevel: 10 } ],
        '瘟熊': [ { to: '瘟甲熊', minLevel: 10 }, { to: '血瘟熊', minLevel: 10 } ],
        '疫毛兽': [ { to: '疫刺兽', minLevel: 10 }, { to: '冥毛兽', minLevel: 10 } ],
        '骨狼': [ { to: '骨刃狼', minLevel: 10 }, { to: '冥霜狼', minLevel: 10 } ],
        '毒沼蛙': [ { to: '毒沼王', minLevel: 10 }, { to: '咒沼蛙', minLevel: 10 } ],
        '尸犬': [ { to: '尸牙犬', minLevel: 10 }, { to: '幽灵犬', minLevel: 10 } ],
        '幽影兔': [ { to: '影刃兔', minLevel: 10 }, { to: '霜影兔', minLevel: 10 } ],
        '腐沼兽': [ { to: '腐沼王', minLevel: 25 } ],
        '毒噜兽': [ { to: '毒沼霸主', minLevel: 25 } ],
        '腐沼王': [ { to: '腐烂之母', minLevel: 60 } ],
        '毒沼霸主': [ { to: '剧毒魔君', minLevel: 60 } ],
        '血牙狐': [ { to: '血灾领主', minLevel: 25 } ],
        '幽火狐': [ { to: '幽火王', minLevel: 25 } ],
        '血灾领主': [ { to: '血月魔狐', minLevel: 60 } ],
        '幽火王': [ { to: '幽火魔狐', minLevel: 60 } ],
        '瘟甲熊': [ { to: '瘟神巨熊', minLevel: 25 } ],
        '血瘟熊': [ { to: '血疫暴君', minLevel: 25 } ],
        '瘟神巨熊': [ { to: '瘟疫之主', minLevel: 60 } ],
        '血疫暴君': [ { to: '血瘟暴君', minLevel: 60 } ],
        '疫刺兽': [ { to: '疫魔刺龙', minLevel: 25 } ],
        '冥毛兽': [ { to: '冥幽兽', minLevel: 25 } ],
        '疫魔刺龙': [ { to: '刺骨魔兽', minLevel: 60 } ],
        '冥幽兽': [ { to: '幽冥疫君', minLevel: 60 } ],
        '骨刃狼': [ { to: '骨刃王', minLevel: 25 } ],
        '冥霜狼': [ { to: '霜狼祭司', minLevel: 25 } ],
        '骨刃王': [ { to: '骸骨君主', minLevel: 60 } ],
        '霜狼祭司': [ { to: '霜寒领主', minLevel: 60 } ],
        '毒沼王': [ { to: '毒沼魔君', minLevel: 25 } ],
        '咒沼蛙': [ { to: '咒毒蛙王', minLevel: 25 } ],
        '毒沼魔君': [ { to: '剧毒魔神', minLevel: 60 } ],
        '咒毒蛙王': [ { to: '深渊蛙帝', minLevel: 60 } ],
        '尸牙犬': [ { to: '尸魔犬王', minLevel: 25 } ],
        '幽灵犬': [ { to: '幽冥猎犬', minLevel: 25 } ],
        '尸魔犬王': [ { to: '尸界狱主', minLevel: 60 } ],
        '幽冥猎犬': [ { to: '幽魂犬皇', minLevel: 60 } ],
        '影刃兔': [ { to: '影舞者', minLevel: 25 } ],
        '霜影兔': [ { to: '霜影魔兔', minLevel: 25 } ],
        '影舞者': [ { to: '影蚀魔君', minLevel: 60 } ],
        '霜影魔兔': [ { to: '霜魂兔皇', minLevel: 60 } ]
      }
    },
    /* ================= 神级宠（2026-09-06 新增，《系统重设计·落地执行手册_v1》2.6） =================
     * 神级宠是【单独的宠物】，不是普通宠的进阶形态：有自己的名字、外观、基础属性与成长系数。
     *  · 获得：合成时主宠与副宠都必须是【终阶】（evolveStage 5）且成长值 ≥ minGrowth →
     *    30% 概率出神级宠；背包有「涅槃丹」时 100% 出。
     *  · 强度：statCoeff = 对应普通宠的 1.5 倍（手册 2.6「成长系数 +50%」）。
     *  · 只有神级宠才能涅槃（见 Config.nirvana.requireGodPet）。
     *  · 外观：没有专属立绘前，sprite 复用该线终形态的立绘（不回退 emoji）。
     *  ⚠️ minGrowth=60 是手册原值；它与「只有神级宠能涅槃」合起来会让成长通道变长（落地方案 R1）。
     *     想调快只改这一个数（建议 30）。 */
    godPets: {
      minGrowth: 60,
      /* 成神规则（2026-09-06 第二版手册 2.2，对齐原版"满神 60cc"）：
       *  · 出生成长上限 birthGrowthCap：计算成长超过 60 的部分不直接给，折算成 statCoeff 永久加成
       *    （每超过 1 点 +excessStatCoeffRatio，封顶 excessStatCoeffMax）→ 鼓励用高成长副宠合成，超额不浪费
       *  · 神级宠涅槃无成长上限（长线叠成长）
       *  · 合成终阶等级要求 baseLevelRequire：至尊神石可按 supremeStoneLevelReduce 降低 */
      birthGrowthCap: 60,
      excessStatCoeffRatio: 0.01,
      excessStatCoeffMax: 0.2,
      baseLevelRequire: 60,
      supremeStoneLevelReduce: 10,
      // 8 只神级宠（每条基宠线 1 只）；line 用于从普通宠反查它对应的神级形态
      list: [
        { name: '腐界母神', line: '腐噜兽', sprite: '腐烂之母', speed: 80,  baseHp: 165, baseAtk: 33, baseDef: 17, statCoeff: { hp: 7.35, atk: 3.57, def: 1.53 } },
        { name: '血月神狐', line: '血狐',   sprite: '血月魔狐', speed: 96,  baseHp: 128, baseAtk: 45, baseDef: 12, statCoeff: { hp: 4.83, atk: 3.33, def: 1.38 } },
        { name: '疫神巨像', line: '瘟熊',   sprite: '瘟疫之主', speed: 70,  baseHp: 240, baseAtk: 27, baseDef: 27, statCoeff: { hp: 8.55, atk: 3.63, def: 1.68 } },
        { name: '万刺冥神', line: '疫毛兽', sprite: '刺骨魔兽', speed: 92,  baseHp: 143, baseAtk: 39, baseDef: 14, statCoeff: { hp: 6.00, atk: 3.42, def: 1.44 } },
        { name: '骸骨神狼', line: '骨狼',   sprite: '骸骨君主', speed: 88,  baseHp: 158, baseAtk: 38, baseDef: 15, statCoeff: { hp: 6.45, atk: 3.36, def: 1.49 } },
        { name: '毒渊神蟾', line: '毒沼蛙', sprite: '剧毒魔神', speed: 75,  baseHp: 195, baseAtk: 30, baseDef: 21, statCoeff: { hp: 7.80, atk: 3.54, def: 1.62 } },
        { name: '狱门神犬', line: '尸犬',   sprite: '尸界狱主', speed: 84,  baseHp: 180, baseAtk: 32, baseDef: 20, statCoeff: { hp: 6.90, atk: 3.38, def: 1.58 } },
        { name: '霜月神兔', line: '幽影兔', sprite: '影蚀魔君', speed: 100, baseHp: 105, baseAtk: 36, baseDef: 11, statCoeff: { hp: 5.03, atk: 3.51, def: 1.35 } }
      ],
      // 按名字取神级宠定义
      byName: (name) => ((window.Config.pet && window.Config.pet.godPets && window.Config.pet.godPets.list) || [])
        .find(g => g.name === name) || null,
      // 按【根源基宠名】（pet.lineId）取该线的神级宠；已是神级宠则返回自身
      ofLine: (lineId) => {
        const G = window.Config.pet && window.Config.pet.godPets;
        if (!G) return null;
        const self = (G.list || []).find(g => g.name === lineId);
        if (self) return self;
        return (G.list || []).find(g => g.line === lineId) || null;
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
    // ⚠️ 不配 emoji icon（2026-09-10 移除）：展示处用 PetSprites.avatarOf(基宠名) 取真实头像
    '腐噜兽': { type: 'allStatBonus', name: '适应力', desc: '暴击率/闪避/命中各+8%，全场景稳定发挥。', params: { critRate: 0.08, dodge: 0.08, hit: 0.08 } },
    '血狐':   { type: 'onCritExtraHit', name: '猎杀本能', desc: '暴击时25%概率追加一次普攻（100%伤害）。', params: { chance: 0.25, damageMult: 1.0 } },
    '瘟熊':   { type: 'onHitReflect', name: '重甲反冲', desc: '受击时反弹防御力30%的伤害给敌人。', params: { defRatio: 0.3 } },
    '疫毛兽': { type: 'speedAspd', name: '疾风步', desc: '速度超100后，每10点速度+5%攻速，上限+30%。', params: { threshold: 100, perPoint: 10, bonusPer: 0.05, cap: 0.30 } },
    '骨狼':   { type: 'killDamageBuff', name: '嗜血追击', desc: '击杀敌人后，下次攻击伤害+50%。', params: { damageMult: 1.5 } },
    '毒沼蛙': { type: 'corruptionStack', name: '腐蚀毒液', desc: '攻击叠加腐蚀层数，每层使敌人受伤+5%，最多5层。', params: { perStack: 0.05, maxStacks: 5 } },
    '尸犬':   { type: 'lifestealTrueDamage', name: '噬魂咬', desc: '吸血时附加吸血量100%的真实伤害。', params: { ratio: 1.0 } },
    '幽影兔': { type: 'onDodgeCounter', name: '影袭', desc: '闪避后立即反击，造成80%伤害。', params: { damageMult: 0.8 } }
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
      /* 图1/图2 攻击 2026-09-09 下调（38→34 / 80→72）：换递减对抗后新手期战败率冲到
       * 16.7%（vtest_early_game 实测胜率 83.3%、剩余血 22%）—— 那是「连第一张图都打不过」的
       * 观感，历史上为这个翻车过两次。新手图只要求有掉血感，不要求有战败风险；
       * 挨打仍 >0（正常档约 3~5%/刀），不会出现免伤。图 3~10 一律不动。 */
      'corrupted-forest': { hp: 225, atk: 32, def: 16 },
      /* 图2（2026-08-31 下调 hp 505→460 / atk 105→80 / def 43→38）：与图1 同一毛病 ——
       * 新手到 Lv7 才刚进图2，手上最多一两件白蓝装，远不到「参考玩家穿基础装备」的档，
       * 原数值下 Lv9~11 裸装新手只剩个位数血、胜率跌到 41%。下调后全程剩余血 ≥25%。 */
      'plague-swamp':     { hp: 460, atk: 58, def: 38 },
      'shadow-mountains': { hp: 771, atk: 155, def: 66 },
      'bone-wastes':      { hp: 924, atk: 184, def: 79 },
      'blood-rift':       { hp: 1172, atk: 230, def: 101 },
      'echo-cliffs':      { hp: 1380, atk: 270, def: 119 },
      /* 图7/图8 血量 2026-09-09 微调（1611→1640 / 1853→1890）：
       * 攻防改递减对抗后玩家伤害略增，这两张图的正常档刀数跌到 2.48/2.47，低于
       * 「正常 2.5~4 刀」的设计下限。只补这两张，其余九张仍在区间内。 */
      'rotfen-bog':       { hp: 1640, atk: 314, def: 139 },
      'ember-hollow':     { hp: 1890, atk: 359, def: 158 },
      /* 图9/10（2026-09-06 手册 2.2 校准）：原值穿装仅 2.45 刀 < 2.5（手册 1.1 指出的崩点「图9/10穿装2.42刀」），
       * 上调 hp 让穿装回到 ~2.9 刀（校准计算见 docs/tests/equipment_simulator.js）：
       *   图9 魂渊   穿装 944-164=780 伤害/刀 → hp 2185 → 2.8 刀；裸装 2185/(819-164)=3.3 刀 ✓
       *   图10 腐变  穿装 1051-182=869 伤害/刀 → hp 2520 → 2.9 刀；裸装 2520/(809-182)=4.0 刀 ✓ */
      'soul-abyss':       { hp: 2185, atk: 369, def: 164 },
      'blight-heart':     { hp: 2520, atk: 411, def: 182 }
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
      { id: 'echo-cliffs', name: '回响崖', levelRange: [31, 36], recommended: '成长 13', recGrowth: 13, background: '回响崖', difficulty: 1.0, enemyMult: 1.1, enemyIds: ['wild-bog-king', 'wild-umbra-rabbit', 'wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-bloodfox-mutant', 'wild-plaguebear-mutant'] },
      { id: 'rotfen-bog', name: '腐沼泽', levelRange: [37, 42], recommended: '成长 15', recGrowth: 15, background: '腐沼泽', difficulty: 1.0, enemyMult: 1.1, enemyIds: ['wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-plaguebear-mutant', 'wild-bloodfox-mutant', 'wild-bog-king', 'wild-umbra-rabbit'] },
      { id: 'ember-hollow', name: '余烬渊', levelRange: [43, 48], recommended: '成长 17', recGrowth: 17, background: '余烬渊', difficulty: 1.0, enemyMult: 1.1, enemyIds: ['wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-plaguebear-mutant', 'wild-bloodfox-mutant', 'wild-bog-king', 'wild-umbra-rabbit'] },
      { id: 'soul-abyss', name: '魂渊', levelRange: [49, 54], recommended: '成长 19', recGrowth: 19, background: '魂渊', difficulty: 1.0, enemyIds: ['wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-plaguebear-mutant', 'wild-bloodfox-mutant', 'wild-bog-king', 'wild-umbra-rabbit'] },
      { id: 'blight-heart', name: '腐变之源', levelRange: [55, 60], recommended: '成长 21', recGrowth: 21, background: '腐变之源', difficulty: 1.0, enemyIds: ['wild-bonewolf-mutant', 'wild-shadowrabbit-mutant', 'wild-plaguebear-mutant', 'wild-bloodfox-mutant', 'wild-bog-king', 'wild-umbra-rabbit'] },
      /* ---- 2026-09-06 地图精简 17→10（手册 2.1）----
       * 原 2026-08-31 的第二幕 7 图（rift-fissure ~ blight-origin，Lv61-100）整体删除：
       * 它们因 maxLevel=60 早已进不去（预留毕业图），删掉玩家无感；「地狱/通天塔」以后作为
       * 独立系统另行设计，不占用野图编号。删图连带：主线 m41~m68 / 7 种区域材料 /
       * areaEvolutionTiers / materialWeightsByTier / rarityWeightsByTier / materialTierWeights /
       * baseTierMultipliers / areaLevels / worldmap 点位（vtest_worldmap.js 守一致性）。 */
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
     * 权重为【相对权重】，代码归一化；当前目标概率（2026-09-09 产出削减）：material≈8.5% / equipment≈1.3% / egg≈0.6% / none≈90%。
     *   挂机一小时（约 700 场）：材料约 59 件、装备 7.7~10.4 件、蛋约 4.2 个（改前 135/22.6/15.1 —— 东西多到不值钱，砸掉落惊喜）。
     *   material 子权重按改造前各材料独立概率等比例设定 → 各材料吞吐≈改造前（不饿死打造/进化/涅槃）。
     *   evo/区域材料的实际名字由 areaEvolutionTiers / areaMaterials 决定；其权重并入下方固定项，不再读 chance。
     */
     pool: { none: 900, material: 85, equipment: 13, egg: 6 },
    /* 掉落率总盘·按阶段（2026-09-09 产出削减）：装备掉落率 新手期1.1% / 成长期1.3% / 毕业期1.5%，
     * 普通战斗有效掉落约 10%（材料约 8.5%、装备约 1.3%、蛋约 0.6%）。drop.js 按「图序号」选阶段池（图1-3→1、图4-7→2、图8-10→3），
     * 取不到时回退上面的全局 pool。权重为相对值，代码归一化：
     *   阶段1：装备 30/1021≈2.9%（新手期调高） / 阶段2：13/1004≈1.3% / 阶段3：15/1006≈1.5% */
     poolByStage: {
       1: { none: 900, material: 85, equipment: 30, egg: 6 },
       2: { none: 900, material: 85, equipment: 13, egg: 6 },
       3: { none: 900, material: 85, equipment: 15, egg: 6 }
    },
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
    /* 材料子权重·按图档（2026-09-09 产出削减重排：10 档）
     * 原则（与用户讨论定稿）：地图只出「燃料」——区域材料、基础打造石、鉴定石、进化素材；
     *   高级物品全部移出普通地图，改归通天塔（见 Config.towerDrops 占位清单）：
     *   · 神圣石：地图 7~10 全删（备份来源 = 资源试炼·淬炼 Lv43+ 档，不会断供）
     *   · 越龙之石 / 天仙玉露 / 强化丹B：地图全删，【通天塔落地前绝版】（淬炼试炼不掉它们、商店已关闭）
     * 合成之石砍半（45→20 档内）；重铸/增缀/剥离适度降；区域材料保留最大权重（collect_loop
     *   委托换门票的燃料，砍狠了副本循环会断）。
     * 鉴定石按「产出 ≥ 装备产出」反推：掉落装备全部未鉴定，鉴定石不够会卡死玩家
     *   （阶段3 装备约 10.4 件/小时 → 鉴定石子占比约 17.5~19%）。
     * 锁定石本来就不进地图掉落表：唯一来源 = 资源试炼·淬炼高阶（vtest_resource_matrix.js 守）。
     * 表中没有的键 = 该图还不出；改这里只动材料比例，不碰掉落率总盘（drop.pool）。 */
    materialWeightsByTier: {
      /* 进化增强道具：强化丹A 保留小权重；强化丹B / 天仙玉露 / 越龙之石已移出地图（归塔）。 */
      1:  { '区域材料': 100, '进化素材': 40, '重铸石': 30, '增缀石': 25, '剥离石': 8, '鉴定石': 32, '强化丹A': 6 },
      2:  { '区域材料': 100, '进化素材': 44, '重铸石': 30, '增缀石': 26, '剥离石': 10, '鉴定石': 33, '强化丹A': 6 },
      3:  { '区域材料': 105, '进化素材': 50, '重铸石': 28, '增缀石': 28, '剥离石': 14, '鉴定石': 35, '强化丹A': 6 },
      4:  { '区域材料': 105, '进化素材': 56, '重铸石': 22, '增缀石': 30, '剥离石': 18, '合成之石': 10, '鉴定石': 45, '强化丹A': 6 },
      5:  { '区域材料': 110, '进化素材': 62, '重铸石': 20, '增缀石': 28, '剥离石': 20, '合成之石': 12, '鉴定石': 47, '强化丹A': 6 },
      6:  { '区域材料': 110, '进化素材': 68, '重铸石': 18, '增缀石': 26, '剥离石': 22, '合成之石': 14, '鉴定石': 48, '强化丹A': 6 },
      7:  { '区域材料': 115, '进化素材': 100, '重铸石': 16, '增缀石': 24, '剥离石': 22, '合成之石': 16, '鉴定石': 49, '强化丹A': 6 },
      /* 图 8~10（Lv43+）起进入【腐印】——进塔用的词缀道具（消耗品、可交易）。
       * 权重与辣度反向：轻辣常见、重辣稀有（重辣在高阶副本档位里另发，见 trial-config 淬炼路线）。
       * 只在高图出现是刻意的：腐印服务于塔（后期内容），别让中期玩家背包里堆一堆用不上的东西。 */
       8:  { '区域材料': 115, '进化素材': 130, '重铸石': 14, '增缀石': 22, '剥离石': 22, '合成之石': 18, '鉴定石': 59, '强化丹A': 5,
             '腐印·暴怒': 3, '腐印·疾影': 3, '腐印·狂乱': 3 },
       9:  { '区域材料': 120, '重铸石': 12, '增缀石': 20, '剥离石': 22, '合成之石': 19, '鉴定石': 42, '强化丹A': 5,
             '腐印·暴怒': 4, '腐印·疾影': 4, '腐印·狂乱': 3, '腐印·蚀甲': 3, '腐印·荆棘': 2, '腐印·破阵': 2 },
       10: { '区域材料': 125, '重铸石': 10, '增缀石': 18, '剥离石': 22, '合成之石': 20, '鉴定石': 43, '强化丹A': 5,
             '腐印·暴怒': 5, '腐印·疾影': 4, '腐印·狂乱': 4, '腐印·蚀甲': 4, '腐印·荆棘': 3, '腐印·破阵': 3,
             '腐印·增殖': 2, '腐印·屠戮': 2, '腐印·渴血': 2, '腐印·枯竭': 2, '腐印·禁疗': 1, '腐印·天罚': 1 }
    },
    // 进化素材档位权重（仅在本图 areaEvolutionTiers 允许的档位里生效）：
    // 高档相对权重更高 → 深处"只掉传说"的图传说频率拉满，中段多档图传说也偏多（出现时机的梯度）。
    evoMaterialWeights: { '进化素材': 50, '精粹进化素材': 70, '传说进化素材': 150 },
    phoenixName: '涅磐兽',
    synthesizeName: '合成之石',
    // 每图允许掉的进化素材档位：key=区域 id，value=该图可掉的素材名数组（掉落时随机选一个）
     // 档位按「图等级段」递进：图1-2 普通 / 图3-4 普通+精粹 /
     // 图5 三档 / 图6-8 精粹+传说。图9-10 不稳定生产进化素材，终局资源转由资源试炼承担。
    areaEvolutionTiers: {
      'corrupted-forest': ['进化素材'],
      'plague-swamp':    ['进化素材'],
      'shadow-mountains':['进化素材', '精粹进化素材'],
      'bone-wastes':     ['进化素材', '精粹进化素材'],
      'blood-rift':      ['进化素材', '精粹进化素材', '传说进化素材'],
      'echo-cliffs':     ['精粹进化素材', '传说进化素材'],
      'rotfen-bog':      ['精粹进化素材', '传说进化素材'],
      'ember-hollow':    ['精粹进化素材', '传说进化素材'],
       'soul-abyss':      [],
       'blight-heart':    []
      /* 2026-09-06：图 11-17 的 7 条目随地图精简删除 */
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
      'soul-abyss':      { name: '魂渊之尘' }
      /* 2026-09-06：图 11-17 的 7 种专属材料（裂隙碎片/黑血凝块/深渊骸片/疫潮胞核/噬魂丝茧/湮灭残响/本源腐核）随地图精简删除 */
    },
    // 任务系统：每图一个收集任务（收集该图专属材料），数量大胆、奖励含少量进化素材（辅助，非主力）。
    // 进化素材奖励控制在低量（1次任务给2个，够几小步进化），避免玩家靠刷任务白嫖进化、失去"刷图掉素材"的意义。
    // 任务跟图绑定：打过图N才解锁图N任务。
    // 任务表 v1（详见 docs/任务表 v1.md）：新手成长 12 + 主线 24 + 日常 12 + 成就 6 = 54 条
    // 字段：category(tutorial/main/daily/achieve) / type(见 quest.js) / need 需求数量
    //       unlockLevel 等级解锁（主线日常成就） / requires 前置任务（新手链线性引导）
    //       repeat 每日刷新 / name 任务名 / guide 引导条跳转目标 / reward 奖励材料
    //       rewardGear 奖励装备件数（新手链专用：送实体装备，不是材料）
    /* ⚠️ 任务奖励的资源归属规则（2026-09-09 按《边界基线 v1》第 3 节落地，vtest_resource_matrix.js 守）：
     *   1. 循环任务（repeat / repeatable）只发打造通货与经验 —— 严禁进化和涅槃材料，
     *      否则每日任务会取代地图和试炼成为资源最优解。
     *   2. 传说进化素材只能出现在 unlockLevel 31~48（= 图 6~8 阶段，和 areaEvolutionTiers 对齐）；
     *      图 9~10（unlockLevel ≥49）一条都不给，改发该阶段的打造通货。
     *   3. 单条任务给传说不超过 2 个（一只宠走到终阶总共只要 5 个）——任务只补当前缺口，
     *      不提前发两个阶段的量。
     * 改这张表前先跑 `node docs/tests/vtest_resource_matrix.js`。 */
    quests: [
      /* ---- 新手引导 G1~G10（2026-09-03 目标驱动主线重写，替代原 t1~t13）----
       * 内核仍是任务链：G1~G9 = 引导段（isGuide:true，带 NPC 台词 / hint 怎么做 / target 指引锚点 / boostLevel 等级资粮）；
       * G10 魂铸 = 毕业后普通任务（isGuide:false：不进引导条、不进加速）。
       * 顺序即「变强主线」：领资粮升 Lv10 → 进化 → 武装 → 打造 → 分解 → 孵化副宠 → 融合 → 市集 → 终阶毕业 → 魂铸。
       * ⚠️ 奖励即钥匙（2026-09-08 v2）：引导关的 reward 一律**清空**，
       *   每一步要用的东西由 `tutorialMode.supplyBox`（钥匙表）在该关激活时发放 —— 两套并行会让玩家
       *   看到两份来源不明的资源，也讲不清"这东西是上一关给的"。唯一例外是 G10（非 isGuide，
       *   拿不到 grantKeysFor），它的钥匙 凝魂晶石×10 仍放在钥匙表里，由引导段收尾时补发。
       *   闭环链：G1 经验包→G2 素材→G3 蓝装→G4 重铸石+白装→G5 白装→G6 蛋→G7 合成石+经验包→
       *           G8 白装→G9 精粹1+传说5+经验包→G10 凝魂晶石×10。
       * 经验包：三档真实道具（见 tutorialMode.expPacks），走钥匙表 type:'exppack'，玩家背包里手动用。
       * boostLevel 字段保留，仅作"这一关的等级门槛"说明，不再驱动发放。
       * npc 字段 = 引路人台词草稿，文案可直接在这里改。target = 单步指引 hotspot 的锚点选择器。 */
      { id: 'g1', category: 'tutorial', type: 'level', need: 10, name: '引路人的馈赠', guide: { page: 'pet', btn: '去领取' }, isGuide: true, hint: '初阶经验包已发：去<b>背包 · 消耗品</b>点它使用，出战魂兽直升 Lv10', target: '.qt-go', npc: '腐土虽是你的战场，但蜕变不该靠苦熬。这份资粮，助你直抵进化之境。', boostLevel: 10 },
      { id: 'g2', category: 'tutorial', type: 'evolve', need: 1, requires: 'g1', name: '初次蜕变', guide: { page: 'pet', tab: 'evolve', btn: '去进化' }, isGuide: true, hint: '在宠物页 <b>进化</b> 栏完成第一次进化（Lv10＋进化素材都已备好）', target: '.pet-tab[data-pet-tab="evolve"]', npc: '形态蜕变、属性跃升——这是养成的第一个跳变。越过此境，你的魂兽才真正属于你。', boostLevel: 10 },
      { id: 'g3', category: 'tutorial', type: 'equip', need: 1, requires: 'g2', name: '披甲上阵', guide: { page: 'pet', tab: 'equip', btn: '去穿装备' }, isGuide: true, hint: '在宠物页打开 <b>装备</b> 栏，把刚领到的蓝装穿到出战魂兽身上', target: '.pet-tab[data-pet-tab="equip"]', npc: '蜕变之后仍需甲胄护身，战力才扎实。披上残甲，别让它静静躺在背包蒙尘。' },
      /* G4 2026-09-08：经查证「宠物页 · 装备栏点已穿戴装备 → 右栏就是打造面板」（ui-pet 装备槽
       * onclick → UI.renderBagEqDetail → .eq-detail-craft → renderCraftInto），所以直接淬炼身上
       * 那件蓝装即可，不必再发一件白装当打造对象 —— 少发一件、少一步找装备的操作。 */
      { id: 'g4', category: 'tutorial', type: 'craft', need: 1, requires: 'g3', name: '亲手淬炼', guide: { page: 'pet', tab: 'equip', btn: '去淬炼' }, isGuide: true, hint: '在 <b>宠物页 · 装备</b> 栏点身上刚穿的那件装备，右侧用刚领的重铸石重铸 1 次', target: '.pet-tab[data-pet-tab="equip"]', npc: '掉落终有尽时。学会亲手锻造，你的战力便不再仰仗天命。' },
      { id: 'g5', category: 'tutorial', type: 'salvage', need: 1, requires: 'g4', name: '化废为宝', guide: { page: 'equip', btn: '去分解' }, isGuide: true, hint: '在打造页点 <b>一键分解</b>，把刚领到的那件白装拆掉（白装本无产出，完成这一步会给你一颗宠物蛋）', target: '#btn-salvage', npc: '废品并非无用。拆了回炉成打造石，养成的循环才真正闭合。' },
      { id: 'g6', category: 'tutorial', type: 'hatch', need: 1, requires: 'g5', name: '孵化新生命', guide: { page: 'pet', tab: 'egg', btn: '去孵化' }, isGuide: true, hint: '在宠物页 <b>宠物蛋</b> 栏孵化刚领到的那颗蛋，得到第二只魂兽', target: '.pet-tab[data-pet-tab="egg"]', npc: '战场不该只容一只孤魂。孵化这颗蛋，让副宠为你并肩而战。' },
      { id: 'g7', category: 'tutorial', type: 'synth', need: 1, requires: 'g6', name: '融合之力', guide: { page: 'pet', tab: 'synth', btn: '去合成' }, isGuide: true, hint: '在宠物页 <b>合成</b> 栏：主宠融合副宠（中阶经验包已发，背包使用后升到 Lv40）', target: '.pet-tab[data-pet-tab="synth"]', npc: '魂兽之间亦有高下。主宠融副宠、继承其特质，向更上一层蜕变。', boostLevel: 40 },
      { id: 'g8', category: 'tutorial', type: 'list', need: 1, requires: 'g7', name: '初入市集', guide: { page: 'market-sell', btn: '去上架' }, isGuide: true, hint: '去 <b>市集</b> 页，把刚领到的那件白装挂上去（1 件即可）', target: '.sb-btn[data-page="market"]', npc: '你亲手锻造之物，可换他人之资。市集之上，强者互通有无。' },
      /* G9 2026-09-06 改：手册 2.7「只有神级宠才能涅槃」→ 引导期玩家只有普通宠，涅槃任务必然卡死（落地方案 R2）。
       * 引导最后一环改为【登临终阶】（累计进化 4 次 = 走到 5 阶终形态），涅槃降级为长线主线目标（m19/m31）。 */
      { id: 'g9', category: 'tutorial', type: 'evolve', need: 4, requires: 'g8', name: '登临终阶', guide: { page: 'pet', tab: 'evolve', btn: '去进化' }, isGuide: true, hint: '在宠物页 <b>进化</b> 栏把魂兽推到 <b>终阶</b>（累计进化 4 次；终阶经验包已发，背包使用后升到 Lv60，进化素材已备）', target: '.pet-tab[data-pet-tab="evolve"]', npc: 'Lv60 —— 形态的尽头。越过此境，你的魂兽才算真正长成；再往上，唯有神级之路。', boostLevel: 60 },
      { id: 'g10', category: 'tutorial', type: 'soulcast', need: 1, requires: 'g9', name: '魂铸传承', guide: { page: 'equip', tab: 'soulcast', btn: '去魂铸' }, hint: '毕业后普通任务：去 <b>打造</b> 页把魂兽特质铸入装备', target: '.sb-btn[data-page="equip"]', npc: '特质可铸入装备，世代相传。毕业之后，仍有可走的更深之路。', reward: { 神圣石: 2 } },

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
      { id: 'm14', category: 'main', type: 'collect', matName: '幽影魂丝', need: 160, unlockLevel: 19, name: '收集魂丝', reward: { 精粹进化素材: 2 } },
      { id: 'm15', category: 'main', type: 'hatch', need: 3, unlockLevel: 19, name: '孵化新宠', reward: { 宠物蛋: 2 } },
      { id: 'm16', category: 'main', type: 'equipDrop', need: 5, unlockLevel: 20, name: '再拾残甲', reward: { 重铸石: 3 } },
      { id: 'm17', category: 'main', type: 'kill', area: 'blood-rift', need: 200, unlockLevel: 25, name: '血潮之中', reward: { 精粹进化素材: 2, 神圣石: 2 } },
      { id: 'm18', category: 'main', type: 'collect', matName: '血潮凝晶', need: 200, unlockLevel: 25, name: '凝取血晶', reward: { 精粹进化素材: 3 } },
      { id: 'm19', category: 'main', type: 'nirvana', need: 1, unlockLevel: 25, name: '初次涅槃', reward: { 涅磐兽: 2, 精粹进化素材: 2 } },
      { id: 'm20', category: 'main', type: 'craft', need: 5, unlockLevel: 26, name: '精炼装备', reward: { 神圣石: 2 } },
      { id: 'm21', category: 'main', type: 'kill', area: 'echo-cliffs', need: 300, unlockLevel: 31, name: '攀上回响崖', reward: { 传说进化素材: 2, 神圣石: 2 } },
      { id: 'm22', category: 'main', type: 'collect', matName: '回响之羽', need: 300, unlockLevel: 31, name: '拾取回响羽', reward: { 传说进化素材: 2 } },
      { id: 'm23', category: 'main', type: 'evolve', need: 5, unlockLevel: 31, name: '五度进化', reward: { 精粹进化素材: 3, 涅磐兽: 2 } },
      { id: 'm24', category: 'main', type: 'salvage', need: 6, unlockLevel: 32, name: '拆解崖间废品', reward: { 增缀石: 3 } },
      { id: 'm25', category: 'main', type: 'kill', area: 'rotfen-bog', need: 360, unlockLevel: 37, name: '踏入腐沼泽', reward: { 传说进化素材: 2, 神圣石: 3 } },
      { id: 'm26', category: 'main', type: 'collect', matName: '腐沼黏液', need: 360, unlockLevel: 37, name: '收集腐沼液', reward: { 传说进化素材: 2 } },
      { id: 'm27', category: 'main', type: 'hatch', need: 5, unlockLevel: 37, name: '孵化沼中生灵', reward: { 宠物蛋: 3 } },
      { id: 'm28', category: 'main', type: 'equipDrop', need: 14, unlockLevel: 38, name: '沼边拾甲', reward: { 重铸石: 4, 增缀石: 4 } },
      { id: 'm29', category: 'main', type: 'kill', area: 'ember-hollow', need: 420, unlockLevel: 43, name: '深入余烬渊', reward: { 传说进化素材: 2, 涅磐兽: 2 } },
      { id: 'm30', category: 'main', type: 'collect', matName: '余烬残灰', need: 420, unlockLevel: 43, name: '掬取余烬灰', reward: { 传说进化素材: 2 } },
      { id: 'm31', category: 'main', type: 'nirvana', need: 2, unlockLevel: 43, name: '二次涅槃', reward: { 涅磐兽: 3, 传说进化素材: 2 } },
      { id: 'm32', category: 'main', type: 'craft', need: 8, unlockLevel: 44, name: '精炼渊火装备', reward: { 神圣石: 4 } },
      { id: 'm33', category: 'main', type: 'kill', area: 'soul-abyss', need: 480, unlockLevel: 49, name: '直面魂渊', reward: { 合成之石: 3, 涅磐兽: 3 } },
      { id: 'm34', category: 'main', type: 'collect', matName: '魂渊之尘', need: 480, unlockLevel: 49, name: '凝取魂渊尘', reward: { 合成之石: 3 } },
      { id: 'm35', category: 'main', type: 'synth', need: 2, unlockLevel: 49, name: '高阶合成', reward: { 合成之石: 5 } },
      { id: 'm36', category: 'main', type: 'equipDrop', need: 18, unlockLevel: 50, name: '魂渊的尽头', reward: { 神圣石: 5, 增缀石: 5 } },
      { id: 'm37', category: 'main', type: 'kill', area: 'blight-heart', need: 550, unlockLevel: 55, name: '直面腐变', reward: { 合成之石: 4, 涅磐兽: 4 } },
      { id: 'm38', category: 'main', type: 'collect', matName: '腐变之心', need: 550, unlockLevel: 55, name: '腐变之心', reward: { 合成之石: 4 } },
      { id: 'm39', category: 'main', type: 'synth', need: 3, unlockLevel: 55, name: '初次合成', reward: { 合成之石: 6 } },
      { id: 'm40', category: 'main', type: 'equipDrop', need: 20, unlockLevel: 56, name: '腐土的尽头', reward: { 神圣石: 6, 增缀石: 6 } },

      /* ---- 2026-09-06：主线 m41~m68（第二幕 28 条）随地图精简 17→10 删除 ---- */


      /* ---- 2026-09-05 守关 Boss 首通（地图系统 A 项，图1-10）：击败该图 Boss 即首通，一次性奖励 ----
       * 奖励 = 区域材料×20 + 重铸石×3 + 该图档进化素材×3（图1-2 普通 / 图3-4 精粹 / 图5+ 传说）。
       * 挂机每累计 100 场（第 100/200/300…场）出现守关 Boss「霸主·XX」，首次击杀即首通。 */
      { id: 'boss1', category: 'main', type: 'boss', area: 'corrupted-forest', need: 1, unlockLevel: 1, name: '首通·枯荣之地', hint: '挂机累计 100 场出现守关 Boss，击败它即首通此图', reward: { 枯荣种荚: 20, 重铸石: 3, 进化素材: 3 } },
      { id: 'boss2', category: 'main', type: 'boss', area: 'plague-swamp', need: 1, unlockLevel: 7, name: '首通·泣腐泥沼', hint: '击败守关 Boss，首通此图', reward: { 泣腐之泪: 20, 重铸石: 3, 进化素材: 3 } },
      { id: 'boss3', category: 'main', type: 'boss', area: 'shadow-mountains', need: 1, unlockLevel: 13, name: '首通·白骨旷野', hint: '击败守关 Boss，首通此图', reward: { 白骨残片: 20, 重铸石: 3, 精粹进化素材: 3 } },
      { id: 'boss4', category: 'main', type: 'boss', area: 'bone-wastes', need: 1, unlockLevel: 19, name: '首通·幽影迷境', hint: '击败守关 Boss，首通此图', reward: { 幽影魂丝: 20, 重铸石: 3, 精粹进化素材: 3 } },
      { id: 'boss5', category: 'main', type: 'boss', area: 'blood-rift', need: 1, unlockLevel: 25, name: '首通·血潮裂谷', hint: '击败守关 Boss，首通此图', reward: { 血潮凝晶: 20, 重铸石: 3, 精粹进化素材: 3 } },
      { id: 'boss6', category: 'main', type: 'boss', area: 'echo-cliffs', need: 1, unlockLevel: 31, name: '首通·回响崖', hint: '击败守关 Boss，首通此图', reward: { 回响之羽: 20, 重铸石: 3, 传说进化素材: 2 } },
      { id: 'boss7', category: 'main', type: 'boss', area: 'rotfen-bog', need: 1, unlockLevel: 37, name: '首通·腐沼泽', hint: '击败守关 Boss，首通此图', reward: { 腐沼黏液: 20, 重铸石: 3, 传说进化素材: 2 } },
      /* 图 8-10 的守关 Boss 首通额外掉涅槃丹（手册 2.6：涅槃丹来源之一 = BOSS 掉落） */
      { id: 'boss8', category: 'main', type: 'boss', area: 'ember-hollow', need: 1, unlockLevel: 43, name: '首通·余烬渊', hint: '击败守关 Boss，首通此图', reward: { 余烬残灰: 20, 重铸石: 3, 传说进化素材: 2, 至尊神石: 1 } },
      { id: 'boss9', category: 'main', type: 'boss', area: 'soul-abyss', need: 1, unlockLevel: 49, name: '首通·魂渊', hint: '击败守关 Boss，首通此图', reward: { 魂渊之尘: 20, 重铸石: 3, 合成之石: 3, 至尊神石: 1 } },
      { id: 'boss10', category: 'main', type: 'boss', area: 'blight-heart', need: 1, unlockLevel: 55, name: '首通·腐变之源', hint: '击败守关 Boss，首通此图', reward: { 腐变之心: 20, 重铸石: 3, 合成之石: 3, 至尊神石: 1 } },

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
      { id: 'pe14', category: 'pet', type: 'kill', petName: '骨狼', need: 120, unlockLevel: 25, name: '骨狼试炼', reward: { 精粹进化素材: 2 } },
      { id: 'pe15', category: 'pet', type: 'evolve', petName: '骨狼', need: 1, unlockLevel: 25, name: '骨狼的进化', reward: { 神圣石: 3 } },
      { id: 'pe16', category: 'pet', type: 'hatch', petName: '毒沼蛙', need: 1, unlockLevel: 31, name: '孵化·毒沼蛙', reward: { 精粹进化素材: 2 } },
      { id: 'pe17', category: 'pet', type: 'kill', petName: '毒沼蛙', need: 120, unlockLevel: 31, name: '毒沼蛙试炼', reward: { 传说进化素材: 1 } },
      { id: 'pe18', category: 'pet', type: 'evolve', petName: '毒沼蛙', need: 1, unlockLevel: 31, name: '毒沼蛙的进化', reward: { 重铸石: 4 } },
      { id: 'pe19', category: 'pet', type: 'hatch', petName: '尸犬', need: 1, unlockLevel: 37, name: '孵化·尸犬', reward: { 传说进化素材: 1 } },
      { id: 'pe20', category: 'pet', type: 'kill', petName: '尸犬', need: 150, unlockLevel: 37, name: '尸犬试炼', reward: { 传说进化素材: 2 } },
      { id: 'pe21', category: 'pet', type: 'evolve', petName: '尸犬', need: 1, unlockLevel: 37, name: '尸犬的进化', reward: { 神圣石: 3, 增缀石: 3 } },
      { id: 'pe22', category: 'pet', type: 'hatch', petName: '幽影兔', need: 1, unlockLevel: 43, name: '孵化·幽影兔', reward: { 传说进化素材: 2 } },
      { id: 'pe23', category: 'pet', type: 'kill', petName: '幽影兔', need: 150, unlockLevel: 43, name: '幽影兔试炼', reward: { 传说进化素材: 2 } },
      { id: 'pe24', category: 'pet', type: 'evolve', petName: '幽影兔', need: 1, unlockLevel: 43, name: '幽影兔的进化', reward: { 涅磐兽: 2 } },

      /* ---- 日常 12 条：每日 00:00 刷新，可重复 ---- */
      /* ---- 地图委托：收集本图材料，交完立即进入下一轮 ---- */
      /* 循环任务奖励跟图阶挂钩（2026-09-06 手册 2.4）：图1-3 重铸石3-5 / 图4-7 增缀·剥离5-8 / 图8-10 神圣·合成5-8 */
      { id: 'loop_corrupted_forest', category: 'main', type: 'collect_loop', area: 'corrupted-forest', matName: '枯荣种荚', need: 50, repeatable: true, name: '枯荣采集委托', reward: { 重铸石: 3 }, expReward: 210 },
      { id: 'loop_plague_swamp', category: 'main', type: 'collect_loop', area: 'plague-swamp', matName: '泣腐之泪', need: 50, repeatable: true, name: '泣腐采集委托', reward: { 重铸石: 4 }, expReward: 570 },
      { id: 'loop_shadow_mountains', category: 'main', type: 'collect_loop', area: 'shadow-mountains', matName: '白骨残片', need: 50, repeatable: true, name: '白骨采集委托', reward: { 重铸石: 5 }, expReward: 930 },
      { id: 'loop_bone_wastes', category: 'main', type: 'collect_loop', area: 'bone-wastes', matName: '幽影魂丝', need: 50, repeatable: true, name: '幽影采集委托', reward: { 增缀石: 5 }, expReward: 1290 },
      { id: 'loop_blood_rift', category: 'main', type: 'collect_loop', area: 'blood-rift', matName: '血潮凝晶', need: 50, repeatable: true, name: '血潮采集委托', reward: { 增缀石: 6 }, expReward: 1650 },
      { id: 'loop_echo_cliffs', category: 'main', type: 'collect_loop', area: 'echo-cliffs', matName: '回响之羽', need: 50, repeatable: true, name: '回响采集委托', reward: { 剥离石: 6 }, expReward: 2010 },
      { id: 'loop_rotfen_bog', category: 'main', type: 'collect_loop', area: 'rotfen-bog', matName: '腐沼黏液', need: 50, repeatable: true, name: '腐沼采集委托', reward: { 剥离石: 7 }, expReward: 2370 },
       /* 循环任务只发打造通货与经验；涅槃材料由资源试炼·涅槃承担。 */
       { id: 'loop_ember_hollow', category: 'main', type: 'collect_loop', area: 'ember-hollow', matName: '余烬残灰', need: 50, repeatable: true, name: '余烬采集委托', reward: { 神圣石: 5 }, expReward: 2730 },
       { id: 'loop_soul_abyss', category: 'main', type: 'collect_loop', area: 'soul-abyss', matName: '魂渊之尘', need: 50, repeatable: true, name: '魂渊采集委托', reward: { 神圣石: 6 }, expReward: 3090 },
      /* ---- 觉醒之路（2026-09-10 v2 觉醒改版）----
       * 觉醒不再 Lv60 自动生效：图 1~10 十种区域材料**每种 888** → 奖励觉醒石 → 宠物页·觉醒页用石头觉醒。
       * repeatable：每只宠觉醒都要一颗石头，任务可反复交。觉醒石不进 Config.trade.materials（天然不可上架）。 */
      { id: 'awaken_road', category: 'pet', type: 'collect', need: 888, repeatable: true, name: '觉醒之路',
        matList: ['枯荣种荚', '泣腐之泪', '白骨残片', '幽影魂丝', '血潮凝晶', '腐变之心', '回响之羽', '腐沼黏液', '余烬残灰', '魂渊之尘'],
        reward: { 觉醒石: 1 }, expReward: 600, unlockLevel: 40 },
       { id: 'loop_blight_heart', category: 'main', type: 'collect_loop', area: 'blight-heart', matName: '腐变之心', need: 50, repeatable: true, name: '腐变采集委托', reward: { 合成之石: 8, 神圣石: 8 }, expReward: 3450 },
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
      { id: 'd11', category: 'daily', type: 'hatch', need: 1, repeat: true, name: '每日孵化', reward: { 鉴定石: 1 } },
      { id: 'd12', category: 'daily', type: 'trade', need: 2, repeat: true, name: '每日交易', reward: { 合成之石: 1 } },

      /* ---- 成就 6 条：长期累计，永不清零，一次性 ---- */
      { id: 'a1', category: 'achieve', type: 'kill', need: 10000, name: '万兽斩', reward: { 传说进化素材: 2 } },
      { id: 'a2', category: 'achieve', type: 'evolve', need: 50, name: '进化大师', reward: { 传说进化素材: 2 } },
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
    // 每图档位基底倍数：10 张图平滑递增（步进 0.25，图10=3.25）
    // 2026-09-06 地图精简 17→10：原 11-17 档（3.5~5.0）随图删除
    baseTierMultipliers: [1, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.25],
    materialTierMultipliers: { 1: 1.5, 2: 1.3, 3: 1, 4: 0.8, 5: 0.6 },
    speedAffixTiers: [
      { tier: 1, min: 12, max: 16 }, { tier: 2, min: 9, max: 11 }, { tier: 3, min: 6, max: 8 },
      { tier: 4, min: 3, max: 5 }, { tier: 5, min: 1, max: 2 }
    ],
    affixTiers: [
      { tier: 1, min: 6, max: 8 }, { tier: 2, min: 4, max: 5 }, { tier: 3, min: 3, max: 4 },
      { tier: 4, min: 2, max: 2 }, { tier: 5, min: 1, max: 1 }
    ],
    /* ---------- 词缀独立数值表（2026-09-04 拍板） ----------
     * 痛点：以前暴伤和吸血共用 affixTiers（6~8），但暴伤从 150% 起跳、吸血从 0 起跳，
     * 同一张表导致"暴伤+8"是废条、"吸血+8"是神条 —— 数字小不代表收益小，量纲必须各自定标。
     * 原则：总量守恒（各属性 T1 期望战力打平），%只乘底座不乘成长值。
     * 每张表 tier 1~5，T1 最强；未列出的属性继续走 affixTiers。
     */
    lifestealAffixTiers: [   // 吸血%（移入前缀池后定标）：T1 4% 一击回 4% 伤害，可感知
      { tier: 1, min: 3, max: 4 }, { tier: 2, min: 2, max: 3 }, { tier: 3, min: 2, max: 2 },
      { tier: 4, min: 1, max: 1 }, { tier: 5, min: 1, max: 1 }
    ],
    critDamageAffixTiers: [  // 暴伤%：基础暴伤 150%，T1 +25 到 175% 才有感
      { tier: 1, min: 18, max: 25 }, { tier: 2, min: 12, max: 16 }, { tier: 3, min: 8, max: 10 },
      { tier: 4, min: 4, max: 6 }, { tier: 5, min: 2, max: 3 }
    ],
    critAffixTiers: [        // 暴击率%：基础 5%，T1 +8 到 13%，暴击流核心
      { tier: 1, min: 6, max: 8 }, { tier: 2, min: 4, max: 5 }, { tier: 3, min: 3, max: 3 },
      { tier: 4, min: 2, max: 2 }, { tier: 5, min: 1, max: 1 }
    ],
    penAffixTiers: [         // 穿透（固定值，无视X点防御）：对照怪物防御区间校准（高图怪 def 数百，T1 破防有感）
      { tier: 1, min: 30, max: 40 }, { tier: 2, min: 20, max: 28 }, { tier: 3, min: 12, max: 18 },
      { tier: 4, min: 6, max: 10 }, { tier: 5, min: 2, max: 5 }
    ],
    dmgBonusAffixTiers: [    // 最终伤害+X%：万金油进攻词缀
      { tier: 1, min: 6, max: 8 }, { tier: 2, min: 4, max: 5 }, { tier: 3, min: 3, max: 3 },
      { tier: 4, min: 2, max: 2 }, { tier: 5, min: 1, max: 1 }
    ],
    drAffixTiers: [          // 受伤减免X%（受击侧乘 (1-dr)，clamp 最低承伤 10%）：坦克流核心
      { tier: 1, min: 4, max: 5 }, { tier: 2, min: 3, max: 3 }, { tier: 3, min: 2, max: 2 },
      { tier: 4, min: 1, max: 1 }, { tier: 5, min: 1, max: 1 }
    ],
    // 底材命中随 ilvl 成长：命中+5 死数改为分段区间表（底材管"下限的身份"，词缀管"上限的博弈"）。
    // ilvl 低于段起点取最低段；高于最高段取最高段；ilvl 为空的存量装备走 100（不追溯）。
    baseHitByIlvl: [
      { minIlvl: 1,  min: 3, max: 5 },    // 图1~3（ilvl 1~19）
      { minIlvl: 25, min: 5, max: 8 },    // 图5~7（ilvl 25~37）
      { minIlvl: 43, min: 8, max: 12 },   // 图8~9（ilvl 43~49）
      { minIlvl: 55, min: 12, max: 16 },  // 图10~12（ilvl 55~67）：后期怪闪避高，底材命中是真收益
      { minIlvl: 73, min: 16, max: 22 }   // 图13+（ilvl 73+）
    ],
    // 部位词缀偏好：同部位某些词缀权重 ×N（1 = 不变；0 = 该部位绝不出现）。
    // 意图：武器偏进攻、靴子偏速度、护甲偏坦克 —— 让"刷哪个部位"有方向感。
    slotAffixWeights: {
      武器: { atk: 2, dmgBonus: 2, pen: 2, hp: 0.5, def: 0.5 },
      戒指: { crit: 2, critDamage: 2 },
      项链: { crit: 1.5, critDamage: 1.5, dmgBonus: 1.5 },
      头盔: { def: 1.5, hit: 1.5 },
      护甲: { hp: 2, def: 2, dr: 2, atk: 0.5 },
      盾牌: { def: 2, dr: 1.5, dodge: 1.5 },
      靴子: { spd: 3, dodge: 1.5 },
      腰带: { hp: 1.5, lifesteal: 1.5 },
      斗篷: { dodge: 2, dr: 1.5, spd: 1.5 },
      饰品: { hit: 2, crit: 1.5 },
      护符: { lifesteal: 3, hp: 1.5 },
      徽章: { crit: 1.5, critDamage: 1.5, dmgBonus: 1.5 }
    },
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
      // 2026-09-06 手册 2.3：金装 T1 2%→5%（降低求而不得门槛），T2 13→15，T3 85→80
      gold:  { 1: 5,  2: 15, 3: 80 }
    },
    // 词缀 T 阶装备等级门槛（POE 式 ilvl gate）：T 阶要装备等级(ilvl)达到门槛才可能 roll 出。
    // 装备 ilvl = 掉落它的图档怪等级下限（图10 怪 55 级 → ilvl 55 → T1 开放）。
    // 低于门槛抽到高档 T 会降级到当前 ilvl 允许的最高 T（图4 金装抽到 T1 也只会出 T4）。
    // 打造(重铸/增缀)沿用装备出生时的 ilvl，不会因换图刷高而解锁 —— T1 只在图10+ 的装备上出现。
    affixIlvlGates: { 1: 55, 2: 40, 3: 25, 4: 1, 5: 1 },
    // 图档 → 怪等级下限（兜底换算：老装备没有 ilvl 时按图档近似；与 battle.areas levelRange 对齐）
    areaLevels: [1, 7, 13, 19, 25, 31, 37, 43, 49, 55],
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
      10: { 1: 42, 2: 28, 3: 20, 4: 8,  5: 4  }
      /* 2026-09-06：图 11-17 档位随地图精简删除 */
    },
    // 稀有度（颜色）按手册 2.3 的 3 阶段（2026-09-06，取代旧 17 档渐变）：
    //   新手期 图1-3：白78 / 蓝19 / 金3（体验打造快乐，白蓝装为主）
    //   成长期 图4-7：白25 / 蓝50 / 金25（金装开始出现，适度打造过图）
    //   毕业期 图8-10：白8 / 蓝27 / 金65（T1 词缀可洗，为神级宠做准备）
    // 同阶段内各图相同（手册只给了 3 档值）。掉率总盘（drop.poolByStage）不变，这里只管"出装时是什么颜色"。
    rarityWeightsByTier: {
      1:  { white: 78, blue: 19, gold: 3 },
      2:  { white: 78, blue: 19, gold: 3 },
      3:  { white: 78, blue: 19, gold: 3 },
      4:  { white: 25, blue: 50, gold: 25 },
      5:  { white: 25, blue: 50, gold: 25 },
      6:  { white: 25, blue: 50, gold: 25 },
      7:  { white: 25, blue: 50, gold: 25 },
      8:  { white: 8,  blue: 27, gold: 65 },
      9:  { white: 8,  blue: 27, gold: 65 },
      10: { white: 8,  blue: 27, gold: 65 }
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
      stat: { atk: 1, hp: 0.2, def: 1, spd: 1.5, hit: 1, dodge: 1, crit: 2, critDamage: 0.5, lifesteal: 3, pen: 1 },
      pct:  { atk: 5, hp: 5, def: 5, dmgBonus: 6, dr: 8 },
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
    },
    // 锁定石（2026-09-03 新增）：锁定一条词缀，重铸/神圣时该词缀保持不变、剥离不会移除它。
    // 仅可锁定前缀或后缀其中一侧；重铸生效后锁定自动解除，再次锁定需重新消耗 1 颗锁定石。
    // 来源 = 副本·淬炼试炼（20 层），不进入普通地图掉落表（config.towerDrops 登记其归属）。
    lock: {
      name: '锁定石', amount: 1, maxLocked: 1, icon: '<img class="mat-img" src="assets/icons/final/item_fused_stone.png" alt="">',
      effect: '锁定一条词缀：重铸/神圣时该词缀保持不变，剥离也不会移除它。',
      rule: '仅可锁定前缀或后缀其中一侧；被锁侧在重铸/神圣中整组保留，剥离/增缀不触及。重铸生效后锁定自动解除，再次锁定需重新消耗 1 颗锁定石。由副本·淬炼试炼（20 层）产出，不通过普通地图掉落。'
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
      /* 凝魂晶石【刻意不在这里】（2026-09-09，边界基线 5.3「账号级凝魂晶石不可交易」）：
       * 本表同时用作「上架物」和「收款物」白名单 —— 不进这张表 = 天然不可交易，
       * 与经验包绑定的做法一致（见 tutorialMode.expPacks 注释）。商店直购不受影响。 */
      // 鉴定石：消耗品，鉴定未鉴定装备用（拖到装备上 / 点「鉴定」）。前期好掉、后期稀缺
      { id: 'identify', name: '鉴定石', icon: '🔍', category: 'stone' },
      // 涅槃丹（2026-09-06 新增，手册 2.6）：合成神级宠的保底道具（持有 1 颗 = 100% 出神级宠）。
      // 来源：图 8-10 的守关 Boss 首通 / 图 8-10 的地图委托 / 成就「涅槃行者」
      { id: 'nirvanapill', name: '涅槃丹', icon: '💊', category: 'stone' },
      /* ---------- 高价值功能道具（2026-09-10 补登记，万物皆可交易） ----------
       * 问题：这 6 件只存在于 Config.items（玩家背包里真的有），却从来没登记进这张白名单 →
       *   既当不了收款物、更上不了架。玩家辛苦从通天塔 / 守关 Boss / 委托打出来的高价值物，
       *   在交易行里**根本不存在**（买不到也卖不掉）。
       * 现在登记为可作价材料：至尊神石（100% 出神级宠）这类顶价物终于能拿来标价交易。
       * ⚠️ name 必须与 Config.items[].name 完全一致（收发材料都按名字走 materials 表）。 */
      { id: 'synth_stone',   name: '越龙之石', icon: '💎', category: 'synth' },
      { id: 'synth_shift',   name: '百变魔石', icon: '🔮', category: 'synth' },
      { id: 'synth_supreme', name: '至尊神石', icon: '👑', category: 'synth' },
      { id: 'evo_dan_a',     name: '强化丹A', icon: '💊', category: 'evolve' },
      { id: 'evo_dan_b',     name: '强化丹B', icon: '💊', category: 'evolve' },
      { id: 'evo_jade',      name: '天仙玉露', icon: '🍶', category: 'evolve' },
      /* ---------- 通天塔（2026-09-10） ---------- */
      /* 腐印（进塔词缀，消耗品）：用户拍板「塔外产出 + 可交易」→ 必须进这张白名单，
       * 否则市集既不能上架也不能当收款物。产出见 Config.drop.materialWeightsByTier（图 8~10）
       * 与 trial-config.js 淬炼路线高档。名称必须与 Config.tower.affix.items[].name 完全一致
       * （tower-affix.js 按名字扣道具）。图标暂用文字标记，不用 emoji（待美术补图）。 */
      { id: 'affix-fury',   name: '腐印·暴怒', icon: '印', category: 'affix' },
      { id: 'affix-thorn',  name: '腐印·荆棘', icon: '印', category: 'affix' },
      { id: 'affix-swift',  name: '腐印·疾影', icon: '印', category: 'affix' },
      { id: 'affix-rend',   name: '腐印·蚀甲', icon: '印', category: 'affix' },
      { id: 'affix-frenzy', name: '腐印·狂乱', icon: '印', category: 'affix' },
      { id: 'affix-brood',  name: '腐印·增殖', icon: '印', category: 'affix' },
      { id: 'affix-slaugh', name: '腐印·屠戮', icon: '印', category: 'affix' },
      { id: 'affix-thirst', name: '腐印·渴血', icon: '印', category: 'affix' },
      { id: 'affix-doom',   name: '腐印·破阵', icon: '印', category: 'affix' },
      { id: 'affix-wither', name: '腐印·枯竭', icon: '印', category: 'affix' },
      { id: 'affix-silence',name: '腐印·禁疗', icon: '印', category: 'affix' },
      { id: 'affix-judge',  name: '腐印·天罚', icon: '印', category: 'affix' }
      /* 通天塔重置卡【刻意不在这里】：它是付费购买物（魔石商店），可交易=给 RMT 开门，
       * 与凝魂晶石同一处置逻辑（天然不可交易，商店直购不受影响）。 */
    ],
    // 交易税：每满 taxPer 收 taxAmount（默认每满 8 收 1）
    taxPer: 8,
    taxAmount: 1,
    // 每人最多同时挂单数（宠物 + 装备 + 蛋 共用上限；上架前校验，见 ui-market-sell.js）
    maxListings: 5,
    /* ---------- 交易行体验补强（2026-09-10，参考 POE 交易站 / 火炬之光交易行） ----------
     * pageSize：每个分区一次渲染多少条，超出给「显示更多」按钮（POE 分页 / 火炬翻页的等价物）
     * refPriceMinSamples：参考价 = 同类在售挂单的标价中位数；样本不足这个数就不显示比价（防单件误导）
     * dealDiscount：低于中位价该比例 → 打「低于市价 X%」（抄底可读）
     * overpriceMarkup：高于中位价该比例 → 打「高于市价 X%」（防自己定价离谱还看不出来） */
    pageSize: 12,
    refPriceMinSamples: 3,
    dealDiscount: 0.2,
    overpriceMarkup: 0.25
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
    /* 新增 2026-09-03：AI 上架覆盖全面化（修复"市场全是图1档白板"）
     * areaWeight：AI 挂机图档分布（key=图1~17 档位序号）。让市场从低级到高级货全覆盖，
     *   替代旧逻辑 generateEquipment 默认 areaTier=1 → 所有装备都是图1档。
     * priceGradient：定价梯度 = 图档基数(每高1档×1.5) × 稀有度乘数 × 材料系数，
     *   让"图17金装"明显贵于"图1白装"，市场有价差、能识货。 */
    // 2026-09-06 地图精简 10 张：图档权重 1~10（新手/中坚/毕业 AI 分布相应前移）
    areaWeight: { 1: 3, 3: 4, 5: 5, 7: 6, 9: 5, 10: 3 },
    priceGradient: {
      basePerTier: 1.5,
      rarityMult: { white: 1, blue: 2, gold: 4 },
      materialMult: { reforge: 1, strip: 0.6, holy: 0.8, augment: 0.8, synthesize: 0.7, phoenix: 0.5, evolution: 0.5, 'evolution-precise': 0.4, 'evolution-legend': 0.3, egg: 0.6, soulcrystal: 0.9, identify: 0.5 }
    },
    /* 2026-09-03 二阶段：AI 上架材料 + 宠物蛋（修复 AI 只上装备和宠物）
     * botGoods.materials：AI 卖材料商品（以物易物）。key=sold 材料 id → { pay: 收款物 id, qty:[min,max] 收款数量 }，买入 1 单位
     * botGoods.materialSellWeights：AI 常卖哪些材料（权重）
     * botGoods.eggPrice：AI 卖宠物蛋（收款物 + 价格范围），蛋品种从 Config.pet.starters 随机
     * minMaterial / minEgg：各类 AI 商品的最低在售量 */
    botGoods: {
      materials: {
        reforge: { pay: 'strip', qty: [1, 3] },
        strip: { pay: 'reforge', qty: [1, 2] },
        holy: { pay: 'reforge', qty: [2, 4] },
        augment: { pay: 'reforge', qty: [2, 4] },
        synthesize: { pay: 'reforge', qty: [1, 3] },
        phoenix: { pay: 'holy', qty: [1, 2] },
        evolution: { pay: 'reforge', qty: [2, 4] },
        'evolution-precise': { pay: 'reforge', qty: [3, 6] },
        'evolution-legend': { pay: 'holy', qty: [2, 4] },
        identify: { pay: 'reforge', qty: [1, 2] },
        soulcrystal: { pay: 'reforge', qty: [1, 3] }
      },
      materialSellWeights: { reforge: 5, strip: 5, holy: 5, augment: 5, synthesize: 5, phoenix: 6, evolution: 8, 'evolution-precise': 5, 'evolution-legend': 3, identify: 5 },
      eggPrice: { pay: 'reforge', qty: [1, 4] }
    },
    minMaterial: 8,
    /* 2026-09-03 三阶段：20 个 AI 玩家 persona（替代单一"流浪商人"）
     * personas.count：AI 玩家总数（原型 20，正式 20~80）。
     * levelTiers：等级档分布 = 进度结构（40% 新手图1-4 / 45% 中坚图5-10 / 15% 毕业图11-17）。
     *   决定每个 AI 产出/挂单的图档范围 → 市场自然形成"图1白板 → 图17金装"全谱系。
     * playstyles：流派偏好分布 = 需求结构发动机（55% 输出 / 25% 坦克 / 20% 速度）。
     *   想捧某玩法 → 调大对应 pct → 该流派 AI 变多 → 对应词缀/血统需求上来 → 价格上来。
     *   statPriorities 决定它定价时给什么词缀溢价、买玩家挂单时优先挑什么。
     * wallet：AI 钱包（材料=钱，走现有 Materials 体系）；init 起始、incomePerTick 每 tick 收入。
     * behavior：像真人的关键——自用率/消耗率(sink)/挂漏/买贵/定价波动/耐心/挂单上限/购买间隔。 */
    personas: {
      count: 20,
      levelTiers: [
        { tier: '新手', pct: 40, areaMin: 1, areaMax: 3 },
        { tier: '中坚', pct: 45, areaMin: 4, areaMax: 7 },
        { tier: '毕业', pct: 15, areaMin: 8, areaMax: 10 }
      ],
      playstyles: [
        { id: 'dps', label: '输出', pct: 55, bloodlineBias: ['血狐', '疫毛兽', '骨狼', '幽影兔'], statPriorities: ['atk', 'crit', 'critDamage'] },
        { id: 'tank', label: '坦克', pct: 25, bloodlineBias: ['瘟熊', '毒沼蛙', '尸犬'], statPriorities: ['hp', 'def', 'lifesteal'] },
        { id: 'speed', label: '速度', pct: 20, bloodlineBias: ['幽影兔', '疫毛兽'], statPriorities: ['spd', 'dodge', 'atk'] }
      ],
      wallet: { init: { 重铸石: 5, 增缀石: 3, 神圣石: 1 }, incomePerTick: { 重铸石: 0.15, 增缀石: 0.1 } },
      behavior: {
        selfUseRate: 0.8,            // 产出 80% 自用（穿/进化），20% 挂市场
        consumeRate: 0.8,            // 买入 80% 直接消耗离场（sink），20% 降价再挂
        relistDiscount: [0.1, 0.2],  // 再挂降价 10~20%
        leakChance: 0.05,            // 挂漏概率
        overpayChance: 0.03,         // 买贵概率
        priceJitter: 0.15,           // 个人定价波动 ±15%
        patienceRate: 0.2,           // 20% 的 AI 选择"等不追高"
        listSlots: 3,                // 每人挂单上限（< 玩家的 5，显得更"普通"）
        buyInterval: [60, 180]       // 每人买玩家单的间隔（秒）
      }
    },
    minEgg: 5,
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
      maxPerRound: 1,           // 规则1：每轮最多买 1 件
      // 材料收购概率（2026-09-10）：一轮里先按这个概率考虑收玩家的材料挂单，没中再走装备/宠物
      materialBuyChance: 0.35
    }
  },

  /* ================= 云端安全护栏（2026-09-03 收口） =================
   * 仅作前端提示/节流的参照值；真正的强制逻辑在服务端 RPC 内
   * （supabase/migrate_security_hardening.sql，改 SQL 必须同步改这里）：
   *  - add_material：60 秒窗口内总量上限，超限锁 5 分钟（防脚本无限刷材料）
   *  - bot_buy：身份/封禁/新号(<10分钟)/每日上限 四道守卫（防小号刷材料）
   *  - 业务 RPC 一律只授权 authenticated（anon 全收回）
   *  - 假买家 MarketBot 只买「别人」的挂单（不买自己，杜绝自挂自买刷材料） */
  security: {
    addMaterial: {
      windowSec: 60,            // 统计窗口（秒）
      maxPerWindow: 1000,       // 窗口内允许上报的材料总量
      maxPerCall: 5000,         // 单次上报上限（防止单发灌爆）
      lockSec: 300              // 超限后锁定秒数
    },
    botBuy: {
      minAccountAgeSec: 600,    // 新号保护：创建不足该时长禁止召唤流浪商人
      dailyCap: 30,             // 每账号每天 bot_buy 次数上限
      pauseSec: {               // 前端收到对应错误码后暂停自动收购的秒数
        ERR_BOT_BUY_ANON: 300,
        ERR_BOT_BUY_BANNED: 6 * 3600,
        ERR_BOT_BUY_TOO_NEW: 600,
        ERR_BOT_BUY_DAILY_CAP: 6 * 3600
      }
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
  /* ================= 道具（合成 / 进化 / 涅槃三系，2026-09-06 对齐原版手册 2.0） =================
   * 唯一定义处：UI 下拉框、预览、扣料全部从这里读，禁止在界面里硬编码。
   * 字段：id/name/icon/rarity/category(synth|evolve|nirvana)/effect/description
   *       合成道具：boost（提升乘区）、godChance（神级宠概率）、levelRequireReduce（降低终阶等级要求）
   *       进化道具：boost（进化成长提升乘区）
   *       涅槃道具：absorbRatio + type(add 加成 / replace 替换)、requireSubHigher（C3 限定） */
  items: [
    /* ---- 合成（3）---- */
    { id: 'synth_stone',   name: '越龙之石', icon: '💎', rarity: '普通', category: 'synth',   boost: 0.1, godChance: 0.3, levelRequireReduce: 0,
      effect: '提升 +10%，神级宠概率 30%', description: '最常用的合路石。稳，但仅此而已。' },
    { id: 'synth_shift',   name: '百变魔石', icon: '🔮', rarity: '稀有', category: 'synth',   boost: 0.2, godChance: 0.6, levelRequireReduce: 0,
      effect: '提升 +20%，神级宠概率 60%', description: '石心难测，六成天意。' },
    { id: 'synth_supreme', name: '至尊神石', icon: '👑', rarity: '稀有', category: 'synth',   boost: 0.3, godChance: 1.0, levelRequireReduce: 10,
      effect: '必定出神级宠；终阶等级要求降到 Lv50', description: '一石定乾坤，神位唾手可得。' },
    /* ---- 进化（3）---- */
    { id: 'evo_dan_a',     name: '强化丹A', icon: '💊', rarity: '普通', category: 'evolve',  boost: 0.1,
      effect: '进化成长提升 +10%', description: '温和的火候，慢慢来。' },
    { id: 'evo_dan_b',     name: '强化丹B', icon: '💊', rarity: '稀有', category: 'evolve',  boost: 0.2,
      effect: '进化成长提升 +20%', description: '比 A 猛，也更稀罕。' },
    { id: 'evo_jade',      name: '天仙玉露', icon: '🍶', rarity: '稀有', category: 'evolve',  boost: 0.3,
      effect: '进化成长提升 +30%，终阶亦可使用', description: '一滴玉露，脱胎换骨。' },
    /* ---- 涅槃（1）---- */
    { id: 'nir_pill',      name: '涅槃丹',   icon: '🔥', rarity: '普通', category: 'nirvana', boostMult: 1.2,
      effect: '涅槃吸收 ×1.2（20%额外加乘）', description: '常规涅槃加成丹。火候更猛，吸收更足。' }
  ],
  // 按 id / 类别取道具（UI 与逻辑统一走这两个，别自己 find）
  itemOf: (id) => (window.Config.items || []).find(i => i.id === id) || null,
  itemsOf: (category) => (window.Config.items || []).filter(i => i.category === category),

  synthesize: {
    minLevel: 40,           // 两只素材必须达到的等级
    material: { name: '合成之石', amount: 1 },  // 基础合成材料（与道具分开计算）
    /* ===== 加法公式（2026-09-06 第二版手册 2.1，废弃加权平均）=====
     * 新宠成长 = 主宠成长 + 总提升，【永远不掉】（保底：总提升至少 +1）。
     * 总提升 = 基础提升 × (1 + 等级加成 + 道具加成) + 随机加成
     *   基础提升 = 副宠成长 × baseBoostRatio
     *   等级加成 = (主宠等级+副宠等级)/200，封顶 levelBoostMax
     *   道具加成 = 选中合成道具的 boost（合成之石0.1 / 百变魔石0.2 / 至尊神石0.3，见 Config.items）
     *   随机加成 = randomBoost 区间
     * 神级宠概率 / 等级要求降低 → 由选中道具的 godChance / levelRequireReduce 决定（见 god 段注释） */
    growthFormula: 'additive',
    baseBoostRatio: 0.25,   // 基础提升 = 副宠成长 × 0.25
    levelBoostMax: 0.5,     // 等级加成上限 +0.5
    randomBoost: [1, 3],    // 随机加成区间
    normalGrowthCap: 100,   // 普通宠（非神级）成长软上限：超过部分减半
    defaultItem: 'synth_stone',  // 默认合成道具（下拉框兜底）
    // 变异（稀有）：概率出全新「·异变」宠（保持现有）
    mutation: {
      chance: 0.5,          // 变异概率
      growthBonus: [1, 3]   // 变异宠成长比普通合成结果再 +1~3（稀有加成，不膨胀）
    },
    /* 神级宠合成（成神）门槛：主副宠都【终阶】+ 成长≥minGrowth + 等级≥baseLevelRequire。
     * 概率看选中的合成道具：合成之石 30% / 百变魔石 60% / 至尊神石 100%（必定出神，
     * 且终阶等级要求按其 levelRequireReduce 降低 —— 对齐原版"至尊神石降低等级要求"）。 */
    god: {
      minStage: 5,          // 终阶（evolveStage === 5）
      minGrowth: 60         // ⚠️ 手册原值，落地方案 R1：调快改这里（建议 30）
    }
  },
  /* ================= 涅槃（主宠涨成长 + 突破上限） =================
   * 只有神级宠能涅槃；主宠等级重置为 1，副宠消失，可反复涅槃持续叠成长（无上限）。
   * 2026-09-06 第二版手册 2.4：消耗改【道具化】——选中的涅槃道具（涅槃丹/涅槃兽C3/涅槃兽T4，
   * 见 Config.items），吸收方式由道具 type 决定：
   *   add     → 主宠成长 += 副宠成长 × absorbRatio（涅槃丹 0.5 / T4 1.0）
   *   replace → 主宠成长 = 副宠成长 × absorbRatio（C3 0.95，要求副宠成长 > 主宠成长，UI 置灰拦截）
   * ⚠️ 与上一版手册的差异（以本手册为准）：涅槃丹从「合成保底道具」改为「涅槃消耗品」，
   *    合成保底改由至尊神石（godChance 1.0）承担；涅磐兽不再作为涅槃消耗（保留掉落与交易）。 */
  nirvana: {
    minLevel: 60,           // 主宠与副宠必须达到的等级
    requireGodPet: true,    // 只有神级宠才能涅槃
    defaultItem: 'nir_pill',    // 默认涅槃道具
    levelBonus: 0.01,       // 副宠等级加成：吸收 × (1 + (副宠等级-门槛)×levelBonus)，仅 add 型生效
    // 可选加成：额外投入凝魂晶石，本次吸收 ×(1 + absorbBonus)。仅 add 型道具可用（替换型语义冲突）。
    crystalBonus: { material: '凝魂晶石', amount: 10, absorbBonus: 0.3, onlyType: 'add' },
    resetLevel: true        // 涅槃后主宠等级重置为 1（重新练级）；神级宠成长无软上限，可无限叠
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
    pwdRequireDigit: true,
    // 昵称：注册时玩家自己填（注册成功后写 profiles.nickname，聊天与市场展示都读它）；
    // 玩家没填 / 老账号没资料 → 用下面词库自动生成一个，避免把邮箱前缀（如 776492620）当名字显示。
    nickname: {
      minLen: 2,
      maxLen: 12,
      // 自动生成的暗黑风词库：前段 + 后段随机拼接，末尾补 4 位编号防重名
      prefixes: ['灰烬', '腐叶', '白骨', '暗影', '血月', '荒冢', '锈铁', '寒鸦', '幽冥', '枯荣', '泣腐', '幽影', '血潮', '腐变'],
      suffixes: ['行者', '术士', '游侠', '猎手', '守夜人', '拾荒者', '铸魂者', '引路人', '掘墓人', '游荡者']
    }
  },

  /* ================= 开发者模式（仅管理员账号可见入口） =================
   * adminEmails：登录邮箱在这个名单里，左侧边栏才显示「开发者」按钮。
   * 开发者面板只改内存中的 Config（刷新复原），不写库、不改文件。 */
  /* ================= 新手引导模式（tutorial_mode.js 驱动） =================
   * 2026-09-03 目标驱动主线重写配套：
   *   · 等级门槛不再靠刷怪 —— 进入含 boostLevel 的任务时，tutorial_mode 把名下所有宠顶到该等级
   *     （等价于一份引导经验包，全宠生效）：G2→Lv10 / G7→Lv40 / G9→Lv60。
   *   · 加速祝福降级为「可选提速」：开局送 1 个，玩家用掉才生效 durationMin 分钟（刷材料更快）。
   *   · 引导段（G1~G9）走完 → 发毕业礼包（绑定账号，仅一次；跳过引导的账号不发）。
   *   · grants = 每关「钥匙表」：任务激活时按库存差量补齐本关要用的材料/装备/蛋/副宠
   *     （幂等自愈，不依赖上一关奖励是否还在，见下方 grants 注释）。
   */
  tutorialMode: {
    enabled: true,
    expRate: 6,             // 引导期经验倍率（祝福生效时覆盖 Config.exp.rate）
    fightSpeedMult: 3,      // 引导期战斗提速（祝福生效时缩短战斗间隔）
    dropPool: null,         // 引导期掉率池覆盖（null = 不改掉率）
    levelGate: null,        // 不降门槛：等级全靠经验包顶（null = 不覆盖 synthesize/nirvana.minLevel）
    blessing: { name: '引导祝福', icon: '', durationMin: 30 },
    /* 分档引导经验包（2026-09-08 用户拍板：做成真实道具——背包可见、手动使用、档位锁死）
     * 替代旧的隐式 boostLevel（直接改等级，玩家看不见也摸不着）。
     * - cap = 使用后名下所有低于该级的魂兽顶到该级（不可超，等级只升不降天然幂等）。
     * - 绑定：道具名刻意不进 Config.trade.materials → 既不能上架也不能当收款物，天然绑定，
     *   未来出非绑定经验包（商店/掉落）走同一个 useExpPack 机制即可，零新增。
     * - 账本按 'expPack:{cap}' 记账：G1/G2 同为 Lv10 共享初阶一份，不重复发。 */
    expPacks: [
      { cap: 10, name: '初阶经验包', icon: '📘', desc: '使用后名下所有魂兽直升 Lv10（不可超）' },
      { cap: 40, name: '中阶经验包', icon: '📗', desc: '使用后名下所有魂兽直升 Lv40（不可超）' },
      { cap: 60, name: '终阶经验包', icon: '📕', desc: '使用后名下所有魂兽直升 Lv60（不可超）' }
    ],
    // 毕业礼包（G9 涅槃完成后自动发，全部绑定、不可交易）
    starterPack: {
      gear: [{ rarity: 'gold', areaTier: 8, materialTier: 3, count: 1 }],
      mats: [
        { name: '凝魂晶石', qty: 5 },
        { name: '神圣石', qty: 3 },
        { name: '重铸石', qty: 3 },
        { name: '增缀石', qty: 3 }
      ],
      expItems: [],
      pet: null
    },
    // 开场总览 tour（选宠完成后播一次，spotlight 压暗聚光走一遍核心系统；台词可直接改）
    openingTour: [
      { target: '.sb-btn[data-page="worldmap"]', title: '第一站 · 战场', npc: '怪物横行的腐土，是你魂兽变强的资粮。厮杀可得经验与残甲——可蜕变，不该靠苦熬。' },
      { target: '.sb-btn[data-page="pet"]', title: '第二站 · 魂兽', npc: '资料页藏着它的一切：血统、特质，以及那扇通往更强形态的进化之门。' },
      { target: '.sb-btn[data-page="equip"]', title: '第三站 · 魂铸工坊', npc: '神兵不只出自掉落。这座铁砧，能把废品炼成护身之甲、把特质铸成传承。' },
      { target: '.sb-btn[data-page="market"]', title: '第四站 · 市集', npc: '当你足够强大，多余的造物可挂上市集，与天下魂师交换所需之物。' }
    ],
    /* 「引导钥匙表」（2026-09-08 重构 v2，替代 v1 的整箱补给箱）
     * v1 = 开局一次性整箱发 → 玩家背包一上来就躺满，感知不到"这是上一关给的"，因果链断。
     * v2 = **奖励即钥匙**：每一项的 taskIds 标注"它是哪一关的钥匙"，
     *      在该关激活时（= 上一关完成的瞬间）由 grantKeysFor(taskId) 发放，账本 keys:{taskId} 守门只发一次。
     *      链：G1 经验包→G2 素材→G3 蓝装→G4 重铸石→G5 白装→G6 蛋→G7 合成石+经验包→
     *          G8 白装(不绑定，要上架)→G9 精粹1+传说5+经验包→G10 凝魂晶石×10。
     *      （G4 淬炼的是 G3 穿上身那件，宠物页装备栏点它即可打造，不再多发一件白装。）
     * 数量守恒（改这里必须同步核）：G9 进化 4 次总需 精粹1+传说5（终阶 extra 3 个已算在内）；
     *   G10 魂铸需 凝魂晶石×10（= soulCast.materialCount，给少了必卡）。
     * 玩家中途把钥匙弄丢 → 引导条「补发」按钮手动补，每关每种限 1 次（走账本 reissue:*）。
     * 注意：白装不能绑定 —— G8 教学任务本身要求上架装备，绑了就卡死 G8。防刷靠账本，不靠绑定。 */
    supplyBox: {
      name: '新手补给箱',
      items: [
        { type: 'exppack', cap: 10, qty: 1, taskIds: ['g1'] },
        { type: 'mat', name: '进化素材', qty: 1, taskIds: ['g2'] },
        { type: 'gear', rarity: 'blue', areaTier: 1, materialTier: 3, count: 1, identified: true, taskIds: ['g3'] },
        { type: 'mat', name: '重铸石', qty: 1, taskIds: ['g4'] },   // 淬炼对象 = G3 穿上身的那件（宠物页装备栏直接打造）
        { type: 'gear', rarity: 'white', areaTier: 1, materialTier: 1, count: 1, identified: true, taskIds: ['g5'] },
        { type: 'egg', baseName: '腐噜兽', qty: 1, taskIds: ['g6'] },
        { type: 'mat', name: '合成之石', qty: 1, taskIds: ['g7'] },
        { type: 'exppack', cap: 40, qty: 1, taskIds: ['g7'] },
        { type: 'gear', rarity: 'white', areaTier: 1, materialTier: 1, count: 1, identified: true, taskIds: ['g8'] },
        { type: 'mat', name: '精粹进化素材', qty: 1, taskIds: ['g9'] },
        { type: 'mat', name: '传说进化素材', qty: 5, taskIds: ['g9'] },
        { type: 'exppack', cap: 60, qty: 1, taskIds: ['g9'] },
        { type: 'mat', name: '凝魂晶石', qty: 10, taskIds: ['g10'] }
      ]
    },
  },

  dev: {
    adminEmails: ['776492620@qq.com']
  }
};

/* 2026-09-08 N1-N6 onboarding override.
 * Keep the legacy G1-G10 records above for old save compatibility, but expose
 * one short, action-first chain to new accounts. Rewards are issued only by
 * tutorial_mode.js via task-keyed, idempotent grants.
 */
window.Config.drop.quests = window.Config.drop.quests.filter(q => q.category !== 'tutorial');
window.Config.drop.quests.push(
  { id: 'n1', category: 'tutorial', type: 'kill', need: 3, name: '\u9009\u62e9\u51fa\u6218\u5ba0\u7269\u5e76\u5f00\u59cb\u6302\u673a', isGuide: true,
    guide: { page: 'worldmap', btn: '\u5f00\u59cb\u6302\u673a' }, target: '.sb-btn[data-page="worldmap"]',
    hint: '\u9009\u4e00\u53ea\u51fa\u6218\u5ba0\u7269\uff0c\u5728\u5730\u56fe\u6302\u673a 3 \u573a\u3002\u6302\u673a\u4f1a\u6389\u7ecf\u9a8c\u3001\u88c5\u5907\u548c\u5730\u533a\u6750\u6599\uff1b\u4e0b\u4e00\u6b65\u67e5\u770b\u88c5\u5907\u3002',
    npc: '\u5148\u8ba9\u4e00\u53ea\u5ba0\u7269\u771f\u6b63\u4e0a\u573a\u3002\u6302\u673a\u7684\u6389\u843d\u5c31\u662f\u4f60\u7684\u7b2c\u4e00\u6279\u9009\u62e9\u3002' },
  { id: 'n2', category: 'tutorial', type: 'equip', need: 1, requires: 'n1', name: '\u4ece\u4e24\u4ef6\u88c5\u5907\u4e2d\u9009\u4e00\u4ef6', isGuide: true,
    guide: { page: 'pet', tab: 'equip', btn: '\u53bb\u67e5\u770b\u5e76\u7a7f\u6234' }, target: '.pet-tab[data-pet-tab="equip"]',
    hint: '\u67e5\u770b\u4e24\u4ef6\u4e0d\u540c\u5e95\u6750\u7684\u90e8\u4f4d\u548c\u5929\u751f\u8bcd\u7f00\uff0c\u81ea\u5df1\u9009\u4e00\u4ef6\u7a7f\u4e0a\u3002\u88c5\u5907\u4f1a\u5f71\u54cd\u6302\u673a\u6548\u7387\u4e0a\u9650\u3002',
    npc: '\u8fd9\u4e24\u4ef6\u6ca1\u6709\u7edd\u5bf9\u7684\u597d\u574f\u3002\u5148\u770b\u65b9\u5411\uff0c\u518d\u51b3\u5b9a\u8c01\u8ddf\u4f60\u51fa\u6218\u3002' },
  { id: 'n3', category: 'tutorial', type: 'craft', action: 'reforge', need: 1, requires: 'n2', name: '\u7528\u4e00\u6b21\u91cd\u94f8\u77f3', isGuide: true,
    guide: { page: 'pet', tab: 'equip', btn: '\u91cd\u94f8\u5df2\u9009\u88c5\u5907' }, target: '.pet-tab[data-pet-tab="equip"]',
    hint: '\u6d88\u8017 1 \u679a\u91cd\u94f8\u77f3\u3002\u8bcd\u7f00\u548c Roll \u503c\u4f1a\u968f\u673a\u53d8\u5316\uff0c\u4e0d\u4fdd\u8bc1\u51fa\u76ee\u6807\u8bcd\u7f00\uff1b\u88c5\u5907\u7b49\u7ea7\u4f1a\u9650\u5236\u8bcd\u7f00\u7b49\u7ea7\u3002',
    npc: '\u91cd\u94f8\u662f\u968f\u673a\u6253\u9020\uff0c\u4f60\u4e70\u7684\u662f\u53ef\u80fd\u6027\uff0c\u4e0d\u662f\u4fdd\u8bc1\u3002' },
  { id: 'n4', category: 'tutorial', type: 'evolve', minLevel: 10, need: 1, requires: 'n3', name: '\u7b2c\u4e00\u6b21\u8fdb\u5316', isGuide: true,
    guide: { page: 'pet', tab: 'evolve', btn: '\u53bb\u8fdb\u5316' }, target: '.pet-tab[data-pet-tab="evolve"]',
    hint: '\u8ba9\u51fa\u6218\u5ba0\u7269\u5728 Lv10 \u5de6\u53f3\u5b8c\u6210\u7b2c\u4e00\u6b21\u8fdb\u5316\u3002\u8fdb\u5316\u4f1a\u6539\u53d8\u9636\u6bb5\u548c\u5916\u89c2\uff0c\u6210\u957f\u503c\u4e3b\u8981\u51b3\u5b9a\u8d44\u683c\u548c\u57fa\u7840\u6548\u7387\u3002',
    npc: '\u8fdb\u5316\u662f\u9636\u6bb5\u8df3\u53d8\uff0c\u4e0d\u662f\u65e0\u9650\u653e\u5927\u6218\u529b\u3002' },
  /* N5：原为「处置 + 击败 Boss」，但守关 Boss 是 200 场冷却 / 1-1600 概率 / 2400 场保底
   * （battle-sim 的 BOSS_* 常数，服务器权威），新手要挂几百场才见得到 —— 引导直接卡死。
   * 改为「处置 + 在图1再击败 5 只怪」：同样教「不用的掉落也有出路 + 继续挂机会滚雪球」，
   * 但几分钟内能完成。Boss 是图首通的长线目标（主线 boss1），不进新手引导。 */
  { id: 'n5', category: 'tutorial', type: 'disposeKill', disposeTypes: ['salvage', 'list'], need: 1, secondNeed: 5, requires: 'n4', area: 'corrupted-forest', name: '处理另一件装备并继续推进', isGuide: true,
    guide: { page: 'equip', btn: '上架或分解，再回图1刷 5 场' }, target: '#btn-salvage',
    hint: '把没有选的那件装备上架或分解，然后回到第一张地图再击败 5 只怪。不需要的掉落也有出口：分解换打造材料，上架换别人手里的资源。',
    npc: '一件留下来提效，另一件就用来换资源。挂机久了还会遇到守关 Boss，那是这张图的首通目标，不急。' },
  { id: 'n6', category: 'tutorial', type: 'direction', need: 1, requires: 'n5', name: '\u9009\u62e9\u4e0b\u4e00\u6b65\u65b9\u5411', isGuide: true,
    guide: { page: 'worldmap', btn: '\u9009\u62e9\u65b9\u5411' }, target: '.sb-btn[data-page="worldmap"]',
    options: [{ id: 'map', label: '\u666e\u901a\u5730\u56fe\u6302\u673a', desc: '\u79ef\u7d2f\u5730\u533a\u6750\u6599\u548c\u88c5\u5907' }, { id: 'trial', label: '\u5c1d\u8bd5\u8d44\u6e90\u8bd5\u70bc', desc: '\u5b9a\u5411\u83b7\u53d6\u8fdb\u5316\u3001\u6d85\u69c3\u6216\u6253\u9020\u8d44\u6e90' }],
    hint: '\u9009\u4e00\u4e2a\u65b9\u5411\u5e76\u5f00\u59cb\u6b63\u5e38\u6e38\u620f\u3002\u5b75\u5316\u3001\u5408\u6210\u3001\u6d85\u69c3\u3001\u5e02\u573a\u548c\u9b42\u94f8\u90fd\u662f\u4e4b\u540e\u7684\u957f\u671f\u76ee\u6807\u3002',
    npc: '\u73b0\u5728\u4f60\u5df2\u7ecf\u7406\u89e3\u4e86\u4e3b\u5faa\u73af\u3002\u4eca\u5929\u60f3\u5237\u88c5\u5907\uff0c\u8fd8\u662f\u60f3\u5b9a\u5411\u5237\u8d44\u6e90\uff0c\u7531\u4f60\u51b3\u5b9a\u3002' }
);
window.Config.tutorialMode.supplyBox = {
  name: '\u65b0\u624b\u5f15\u5bfc\u8865\u7ed9',
  items: [
    { type: 'mat', name: '\u533a\u57df\u6750\u6599', qty: 1, taskIds: ['n1'] },
    { type: 'gear', rarity: 'blue', areaTier: 1, materialTier: 2, count: 1, identified: true, baseName: '\u8f7b\u76d4', tutorialSlot: '\u5934\u76d4', taskIds: ['n2'] },
    { type: 'gear', rarity: 'blue', areaTier: 1, materialTier: 2, count: 1, identified: true, baseName: '\u91cd\u7532', tutorialSlot: '\u62a4\u7532', taskIds: ['n2'] },
    { type: 'mat', name: '\u91cd\u94f8\u77f3', qty: 1, taskIds: ['n3'] },
    { type: 'mat', name: '\u8fdb\u5316\u7d20\u6750', qty: 1, taskIds: ['n4'] },
    { type: 'mat', name: '\u8d44\u6e90\u8bd5\u70bc\u95e8\u7968', qty: 1, taskIds: ['n6'] }
  ]
};
window.Config.tutorialMode.expPacks = [];
window.Config.tutorialMode.disableBlessing = true;
window.Config.tutorialMode.starterPack = { gear: [], mats: [], expItems: [], pet: null };

/* 2026-09-10 资源副本改 20 层爬塔：resourceTrials 全部数值与门票注入
 * 已迁至 js/trial/trial-config.js（副本模块自己的配置文件，一个文件一个职责）。
 * 本文件不再定义 resourceTrials —— 加载顺序：config.js → … → battle.js → trial-config.js。 */

/* ================= 通天塔掉落占位（2026-09-09，塔尚未开发） =================
 * 登记已从普通地图掉落表移除、归属通天塔的高级物品（掉落削减的另一半账本）。
 * 作用：防无声断供（锁定石曾因图 16/17 删除断供一次）；塔落地后按此清单接线奖励，
 * 接线前下列物品处于绝版状态（资源试炼不产出、商店已关闭）。
 * enabled=false：塔未上线，本清单纯登记，不参与任何运行逻辑；
 * vtest_resource_matrix.js 守「这些键不得出现在 materialWeightsByTier」。 */
window.Config.towerDrops = {
  enabled: true,
  note: '通天塔已上线（2026-09-10）：下列物品=塔的档位奖励/层掉落产出；其中 3 件此前绝版，现在塔是唯一来源。腐印（进塔词缀）反过来是塔外产出（地图 8~10 图 + 副本·淬炼高档），见 materialWeightsByTier 与 trial-config.js。',
  items: [
    { name: '神圣石', value: 8, backup: '资源试炼·淬炼 Lv43+（不断供）', note: '重随词缀数值，毕业必需' },
    { name: '越龙之石', value: 7, backup: '无（绝版中）', note: '合成 +10% 成长 / 神级宠 30%' },
    { name: '天仙玉露', value: 8, backup: '无（绝版中）', note: '进化成长 +30%，终阶可用' },
    { name: '强化丹B', value: 6, backup: '无（绝版中）', note: '进化成长 +20%' }
  ]
};
