/* ============================================================
 * tower/tower-config.js —— 通天塔·全部数值配置（唯一事实源）
 * 职责：只放数值与静态配置，不放逻辑。
 *   1. Config.tower：30 层曲线参数、每层怪数、档位奖励、每层掉落池、腐印词缀池
 *   2. 塔专属门票名（通天塔重置卡）
 * 规范：一个文件一个职责 —— 运行逻辑见 tower-access.js（资格）/
 *       tower-engine.js（层推进）/ tower-rewards.js（结算）。
 * 依赖：config.js 必须先加载。
 *
 * 定调（2026-09-10 用户拍板）：
 *   · 塔 = 神级宠玩家的硬实力考卷。怪满级起步（Lv60→120）、全部会放技能；
 *     30 层是**长线目标**（用户拍板「就是要加强难度」）——当前满配也摸不到顶，
 *     要推进只能继续变强（涅槃无成长上限 / 更好词缀装备 / 更高成长）。
 *   · 腐印 = 给毕业玩家自愿加的杠杆：风险换掉率，加腐失败才花钱。
 *     ⚠️ 文案统一叫【腐蚀度】（2026-09-10 用户指定）。
 *   · 每层 5 只怪：前 4 只杂兵 + 第 5 只该层守卫；5 只全清才进下一层。
 *   · 每局从第 1 层重开（无存档）；死或通关即结算，按最高到达层数发档位奖励。
 *   · 每日 1 次免费；用尽后需「通天塔重置卡」（魔石商店，硬限购）。
 *   · 入口不硬拦：谁都能进，只在 UI 标注「推荐神级宠」。
 * ============================================================ */
(function () {
  'use strict';

  window.Config.tower = {
    enabled: true,
    name: '通天塔',
    floors: 30,

    /* ---------- 资格：每日 1 次免费 + 重置卡 ----------
     * freePerDay 与副本的 freeEntriesPerDay 是分开的两套账（塔不共享副本的 3 次）。
     * 重置卡同时是「失败/通关后再来一局」的唯一额外入口。 */
    freePerDay: 1,
    resetCardName: '通天塔重置卡',
    resetCard: {
      priceGems: 60,          // 60 魔石 = 6 元（1 元 = 10 魔石，见 Config.shop.rmbPerGem）
      limitPerWeek: 3,        // 硬限购：每周最多买 3 张（这是「限量刹车」，不许改成无限购）
      weekResetNote: '每周一 00:00（北京时间）重置购买额度'
    },

    /* ---------- 入口提示（不硬拦） ---------- */
    unlock: { hardGate: null, hint: '推荐神级宠（怪满级起步、会放技能；裸装连第 1 层都过不去）' },

    /* ---------- 校准锚点（不是上限，只是「满配」这个参照物的定义） ----------
     * 满配 = 神级宠 Lv60 + 涅槃 5 次（成长 350）+ 12 件金装。
     * 神级宠涅槃无上限，所以比这更强是正常的 —— 更强之后靠腐印（腐蚀度）继续。 */
    calibration: { nirvanaTimes: 5, goldEquips: 12, growth: 350 },

    /* ================= 每层怪数（2026-09-10 用户拍板：每层 5 只） =================
     * 一层 = mobsPerFloor 只怪连续打完才进下一层，血量全程累计（楼层之间、楼内之间都不回满）。
     *   前 4 只 = 杂兵（mobMult 缩放），第 5 只 = 该层守卫（guardianMult 缩放，更硬）。
     *   名字：杂兵取 mobNames 轮转、守卫取 guardians（都能出真实立绘，零美术成本）。
     * ⚠️ 改成 5 只后单只怪必须更脆（否则一层 = 5 倍伤害，整座塔直接崩），
     *    所以 baseStats.hp 已按「单只 ≈ 原单层强度 / 5」重校（见文件末尾校准记录）。 */
    mobsPerFloor: 5,
    mobNames: ['腐烂之母', '剧毒魔君', '霜狼祭司', '冥霜狼', '咒毒蛙王', '幽冥猎犬'],
    /* 2026-09-10 第三轮：用户反馈「60 级的怪怎么这么垃圾」——根因是低层被压成 1/182 的软脚虾。
     * 杂兵攻 1.0→1.35（原来打人像挠痒，一下只掉 300 血）、守卫攻 1.35→1.5；
     * 配合曲线压平（见 curve 注释）让「Lv60」这个招牌与真实强度对上。 */
    mobMult: { hp: 0.8, atk: 1.35, def: 1.0 },       // 杂兵相对基础值的缩放
    guardianMult: { hp: 3.0, atk: 1.5, def: 1.1 },   // 第 5 只守卫（每层一收尾）
    mobGapMs: 420,   // 楼内两只怪之间的停顿（比楼层停顿短，保持推进感）

    /* ================= 塔怪技能（2026-09-10 用户要求：怪物不能是死靶子） =================
     * 全部怪都会放技能：守卫用 guardianSkills（强），杂兵用 mobSkills（弱），
     * 按 (层 + 第几只) 稳定分配，同一层每次进都一样（可复现，便于校准与对账）。
     * 字段与玩家主动技同口径（battle.js 共用同一套结算）：
     *   triggerChance    每次出手时、命中判定之前先摇一次（不放技能就走普攻）
     *   cooldownTurns    放完要等几回合才能再放
     *   damageMultiplier 本次伤害倍率（期望提升 = 概率 ×(倍率−1)）
     *   maxHpDamageRate  追加「对方最大生命 × 该比例」的真伤（对高血宠物更狠）
     * ⚠️ 野图怪没有 skill 字段 → 不消耗任何随机数、行为零变化（服务端同源测试靠这条）。 */
    guardianSkills: [
      { id: 'gv-rend',   name: '腐爪撕裂', triggerChance: 0.25, cooldownTurns: 3, damageMultiplier: 1.5 },
      { id: 'gv-spew',   name: '瘟毒喷吐', triggerChance: 0.25, cooldownTurns: 3, damageMultiplier: 1.5, maxHpDamageRate: 0.02 },
      { id: 'gv-spike',  name: '骨刺穿刺', triggerChance: 0.22, cooldownTurns: 3, damageMultiplier: 1.7, maxHpDamageRate: 0.01 },
      { id: 'gv-cleave', name: '尸界撕裂', triggerChance: 0.20, cooldownTurns: 3, damageMultiplier: 1.9, maxHpDamageRate: 0.02 },
      { id: 'gv-erupt',  name: '剧毒爆发', triggerChance: 0.20, cooldownTurns: 3, damageMultiplier: 1.8, maxHpDamageRate: 0.03 },
      { id: 'gv-exec',   name: '影蚀绝杀', triggerChance: 0.18, cooldownTurns: 3, damageMultiplier: 2.1, maxHpDamageRate: 0.03 }
    ],
    mobSkills: [
      { id: 'mb-bite',  name: '腐咬',     triggerChance: 0.12, cooldownTurns: 4, damageMultiplier: 1.35 },
      { id: 'mb-claw',  name: '湿腐爪',   triggerChance: 0.12, cooldownTurns: 4, damageMultiplier: 1.3,  maxHpDamageRate: 0.01 },
      { id: 'mb-thorn', name: '腐骨刺',   triggerChance: 0.10, cooldownTurns: 4, damageMultiplier: 1.45 },
      { id: 'mb-fume',  name: '腥血吐息', triggerChance: 0.10, cooldownTurns: 4, damageMultiplier: 1.4,  maxHpDamageRate: 0.01 }
    ],

    /* ---------- 难度曲线（全部定死，不搞动态难度） ----------
     * 与副本同一套公式形态（见 trial-engine.js，塔引擎复用同一形态）：
     *   怪等级 = levelStart ~ levelEnd 线性插值（第 1 层 → 第 30 层）
     *   层难度 = difficultyStart × (1+difficultyPerFloor)^(N-1)
     *            × eliteMult^(已跨过的强档层数)
     *            —— 复合递增 + 强档层阶梯永久保留，难度绝不倒退
     *   怪数值 = baseStats × (怪等级 / levelEnd) × 层难度
     * 与副本的关键差别：曲线陡得多（塔的满配玩家有效战力约 14 倍于中档，曲线必须覆盖这个跨度）。 */
    /* ---------- 怪等级（2026-09-10 用户要求：60 级起步、每层提升） ----------
     * levelStart/levelEnd 既决定【显示等级】也决定【强度爬升】：
     *   第 1 层 Lv60 → 第 30 层 Lv120（后期内容不该出现小号怪，满级起步才有压迫感）。
     * 注意：它同时是「怪数值 = baseStats × (怪等级 / levelEnd) × 层难度」里的缩放项，
     *   所以低层怪比旧版（Lv10 起步）硬得多 —— baseStats 已按此重校（见文件末尾校准记录）。 */
    curve: {
      levelStart: 60,
      levelEnd: 120,
      /* ⚠️ 起点比旧版低得多（0.30→0.08）、每层更陡（0.105→0.155）：
       * 旧曲线靠「怪等级 10→100」贡献了 10 倍强度，第 1 层才那么软；
       * 改成 Lv60→120 后等级只贡献 2 倍，缺的 5 倍必须还给曲线起点，
       * 否则裸装玩家第 1 层就被打死（用户自己的宠就在这一档）。 */
      /* 2026-09-10 第四轮（用户拍板 A：**低层怪最凶，档位不改**）：
       *   起点 0.14 → **0.50**、每层 0.17 → **0.124**（曲线大幅压平）。
       * 结果：第 1 层杂兵 血 9792 / 攻 2096 —— 真的像个满级怪（3 刀才能砍死它，
       *   它 4 刀就能打死一只普通 Lv60 宠）。代价见校准记录：裸装玩家第 1 层就过不去，
       *   中档 10 层、涅槃5 21 层 → 15/20/25/30 档位变成少数人的东西（用户知情并选择）。 */
      difficultyStart: 0.5,
      difficultyPerFloor: 0.124,
      eliteEvery: 5,
      eliteMult: 1.05
    },
    /* baseStats 锚点 = 第 30 层（Lv100 · 层难度 ≈1.0 口径）的【单只守卫】数值。
     * ⚠️ 2026-09-10 每层改 5 只后，hp 已按 ~1/5 重校；atk/def 保持（靠「单只更脆」而不是
     *    「单只更软」来维持总伤害不变，见校准记录）。 */
    baseStats: { hp: 48960, atk: 6210, def: 3060 },

    /* 守卫命中：高于野怪默认 90 —— 满配玩家闪避 ~50+，90 会被砍半，
     * 塔的守卫要能打到人（战斗才有压力）。 */
    guardianHit: 160,
    /* 楼层之间的停顿（毫秒）：给日志/血条一点喘息 */
    floorDelayMs: 700,

    /* 每 5 层换一名守卫（立绘复用宠物终形态素材，零美术成本；见 PetSprites） */
    guardians: [
      { from: 1,  to: 5,  name: '骸骨君主' },
      { from: 6,  to: 10, name: '瘟疫之主' },
      { from: 11, to: 15, name: '刺骨魔兽' },
      { from: 16, to: 20, name: '尸界狱主' },
      { from: 21, to: 25, name: '剧毒魔神' },
      { from: 26, to: 30, name: '影蚀魔君' }
    ],
    /* 塔战斗页背景（复用现有地图背景 id，不新画图） */
    bgAreaId: 'blight-heart',

    /* ================= 腐印（词缀）= 腐蚀度系统 =================
     * 规则（用户拍板）：
     *   · 进塔前贴 1~maxPerRun 条，影响整局，进入时消耗掉。
     *   · 每条腐印必须能换算成明确的掉率%（dropBonus），且必须满足
     *       期望掉率增益 > 失败概率增量 × 重置卡成本
     *     —— 否则玩家不会加腐，腐印市场直接死（定价锚见 evAnchor）。
     *   · 「不可读」组合同局最多 unreadableLimit 条（基线 §6.3：不做同时
     *     高爆发 + 高减伤 + 高闪避的不可读组合）。
     * 字段：
     *   corrosion 腐蚀度值（展示 + 周榜排序 + 难度预估，不参与伤害计算）
     *   enemy     怪修正：*Mult 为乘算，其余为加算（dr/pen/dmgBonus/hit 是点数）
     *   flags     healBlock = 本局玩家吸血/回血失效
     *   dropBonus 掉率增益（百分点，直接加到每层掉落权重上）
     *   tags      含 'unreadable' 的算「不可读」类，同局最多 1 条
     *   ev        期望值自检（策划账，不是运行参数）：approvalFailPct = 预估失败率增量（百分点） */
    affix: {
      maxPerRun: 3,
      unreadableLimit: 1,
      /* 定价锚（算 ev 用）：
       *   重置卡成本 C = 60 魔石（一次通关产出 V 折算约 30 魔石）
       *   要求：dropBonus.equipPct × V/100 > approvalFailPct% × C
       *        即 equipPct > approvalFailPct × 2
       *   下表每条都过这个不等式（见 ev 字段），改动必须重算。 */
      evAnchor: { cardCostGems: 60, runValueGems: 30 },
      items: [
        { id: 'blight-fury',   name: '腐印·暴怒', corrosion: 12,
          desc: '怪血 +25%、怪攻 +15%',
          enemy: { hpMult: 1.25, atkMult: 1.15 },
          dropBonus: { equipPct: 25, matPct: 20 },
          tags: [], ev: { approvalFailPct: 10 } },

        { id: 'blight-thorn',  name: '腐印·荆棘', corrosion: 14,
          desc: '怪受伤减免 +15 点',
          enemy: { dr: 15 },
          dropBonus: { equipPct: 30, matPct: 25 },
          tags: ['tank'], ev: { approvalFailPct: 12 } },

        { id: 'blight-swift',  name: '腐印·疾影', corrosion: 10,
          desc: '怪速度 +25%',
          enemy: { spdMult: 1.25 },
          dropBonus: { equipPct: 20, matPct: 15 },
          tags: [], ev: { approvalFailPct: 8 } },

        { id: 'blight-rend',   name: '腐印·蚀甲', corrosion: 13,
          desc: '怪穿透 +1200 点',
          enemy: { pen: 1200 },
          dropBonus: { equipPct: 30, matPct: 25 },
          tags: [], ev: { approvalFailPct: 12 } },

        { id: 'blight-frenzy', name: '腐印·狂乱', corrosion: 11,
          desc: '怪命中 +40 点',
          enemy: { hit: 40 },
          dropBonus: { equipPct: 22, matPct: 18 },
          tags: [], ev: { approvalFailPct: 9 } },

        { id: 'blight-brood',  name: '腐印·增殖', corrosion: 16,
          desc: '怪血 +45%',
          enemy: { hpMult: 1.45 },
          dropBonus: { equipPct: 35, matPct: 30 },
          tags: ['tank'], ev: { approvalFailPct: 14 } },

        { id: 'blight-slaugh', name: '腐印·屠戮', corrosion: 16,
          desc: '怪攻 +30%',
          enemy: { atkMult: 1.30 },
          dropBonus: { equipPct: 35, matPct: 30 },
          tags: ['burst'], ev: { approvalFailPct: 14 } },

        { id: 'blight-thirst', name: '腐印·渴血', corrosion: 15,
          desc: '怪吸血 +15%',
          enemy: { lifesteal: 0.15 },
          dropBonus: { equipPct: 25, matPct: 20 },
          tags: ['unreadable'], ev: { approvalFailPct: 11 } },

        { id: 'blight-doom',   name: '腐印·破阵', corrosion: 14,
          desc: '怪伤害加成 +20%',
          enemy: { dmgBonus: 20 },
          dropBonus: { equipPct: 30, matPct: 25 },
          tags: ['burst'], ev: { approvalFailPct: 12 } },

        { id: 'blight-wither', name: '腐印·枯竭', corrosion: 13,
          desc: '怪防 +40%',
          enemy: { defMult: 1.40 },
          dropBonus: { equipPct: 25, matPct: 20 },
          tags: [], ev: { approvalFailPct: 11 } },

        { id: 'blight-silence', name: '腐印·禁疗', corrosion: 20,
          desc: '本局吸血与回血全部失效',
          enemy: {},
          flags: { healBlock: true },
          dropBonus: { equipPct: 45, matPct: 40 },
          tags: ['unreadable'], ev: { approvalFailPct: 18 } },

        { id: 'blight-judge',  name: '腐印·天罚', corrosion: 30,
          desc: '怪血 +60%、怪攻 +35%（复合重腐）',
          enemy: { hpMult: 1.60, atkMult: 1.35 },
          dropBonus: { equipPct: 80, matPct: 70 },
          tags: ['unreadable', 'burst', 'tank'], ev: { approvalFailPct: 30 } }
      ]
    },

    /* ================= 掉落结构（2026-09-10 用户定：每只怪都掉） =================
     * 三层奖励：
     *   ① 打死杂兵 → 小随机掉落（mobPool，每只都摇一次）
     *   ② 打死第 5 只守卫 → 大随机掉落（guardianPool，明显更肥 → 一层一个收尾高潮）
     *   ③ 过 5 层 → 固定档位奖励（floorTiers，与随机掉落互不替代）
     * 一局 roll 次数 = 层数 × mobsPerFloor = 30 × 5 = 150 次（杂兵 120 + 守卫 30）。
     * 腐印 dropBonus 直接加到 material/equipment 权重上；none 权重不变 → 加腐稀释空手。
     * 产出估算（白图、无腐印）：材料约 26 次/局、装备约 6 件/局 —— 比原来（每层 2 次、材料 14 次/装备 5 件）
     * 略厚但不翻倍：**爽感来自"每只都掉"，不是总量爆炸**（每日 1 次免费 + 每周 3 张重置卡是硬上限）。 */
    layerDrop: {
      mobPool: { none: 84, material: 13, equipment: 3 },       // 杂兵：材料为主，偶尔爆装（装备 1.2→3）
      guardianPool: { none: 42, material: 40, equipment: 18 }, // 守卫：材料+装备都明显更高（装备 15→18）
      equipmentRarityWeights: { blue: 60, gold: 40 },
      equipmentAreaTier: 10,     // 塔装备按最高图档生成（底材/词缀 T 阶随之拉满）
      equipmentIdentified: false // 掉落即未鉴定 —— 鉴定是第二爽点
    },

    /* 材料子池·按深度分档（用户拍板的「层数门槛」：好货只在深层出）
     *   band 1 = 第 1~10 层 / band 2 = 11~20 / band 3 = 21~30
     * 表中没有的键 = 该深度还不出。改这里只动材料比例，不碰掉落率总盘。 */
    /* 🔴 2026-09-10 用户实测反馈「奖励太差，基本都是打造的」→ 本表按「换质量不换数量」重排：
     *   · 打造通货（重铸/增缀/剥离）**压成保底碎屑**（地图、副本、分解都能拿到，不缺塔这一份）
     *   · 主力换成【塔专属材料】（神圣石/越龙之石/天仙玉露/强化丹B）+【腐印】
     *   · 鉴定石保留较高权重：塔掉大量未鉴定装备，鉴定石不够会卡死玩家（产出 ≥ 装备产出）
     *   · 腐印进塔的掉落池是刻意的：它是塔的入场消耗品，让塔「自给自足」，不必回头刷地图
     * 17~20 层必须有越龙之石：它是合成页默认道具而合成 Lv40 就解锁，只放 21+ 会断档。 */
    materialBands: [
      { from: 1,  to: 10, weights: { '鉴定石': 30, '重铸石': 10, '增缀石': 8, '剥离石': 5,
                                     '腐印·暴怒': 8, '腐印·疾影': 8, '腐印·狂乱': 8 } },
      { from: 11, to: 20, weights: { '鉴定石': 22, '重铸石': 6, '增缀石': 5, '剥离石': 5,
                                     '神圣石': 12, '强化丹B': 10, '越龙之石': 6,
                                     '腐印·荆棘': 8, '腐印·蚀甲': 8, '腐印·破阵': 6 } },
      { from: 21, to: 30, weights: { '鉴定石': 16, '重铸石': 4, '增缀石': 4, '剥离石': 4,
                                     '神圣石': 16, '强化丹B': 10, '越龙之石': 12, '天仙玉露': 12, '锁魂玉': 4, '琼浆玉露': 10,
                                     '腐印·屠戮': 8, '腐印·渴血': 8, '腐印·枯竭': 6, '腐印·禁疗': 4, '腐印·天罚': 3 } }
    ],
    materialQty: { min: 1, max: 3 },

    /* ================= 档位奖励（每 5 层一档，按最高到达层数取最深一档） =================
     * 死在第 7 层 = 拿第 5 层档；不足第 5 层 = 只给 consolation。
     * 2026-09-10 加厚：装备件数与材料数量整体上调（用户要求"奖励丰厚一点"）。
     * 2026-09-11 修：materialTier 全改 1 —— 底材 T 是反向档（T1 ×1.5 最优 → T5 ×0.6 最烂），
     *   旧值 3/4/5 = 档位越深装备越垃圾，被野图图 10 全面碾压。塔=最高强度区域，底材一律 T1，
     *   深层成长走 ilvl（塔怪 Lv60→120）。 */
    floorTiers: [
      { floor: 5,  gear: { rarity: 'blue', count: 2, areaTier: 10, materialTier: 1 }, items: [{ name: '鉴定石', qty: 5 }, { name: '重铸石', qty: 2 }] },
      { floor: 10, gear: { rarity: 'gold', count: 2, areaTier: 10, materialTier: 1 }, items: [{ name: '神圣石', qty: 2 }, { name: '强化丹B', qty: 1 }] },
      { floor: 15, gear: { rarity: 'gold', count: 3, areaTier: 10, materialTier: 1 }, items: [{ name: '神圣石', qty: 2 }, { name: '强化丹B', qty: 2 }] },
      { floor: 20, gear: { rarity: 'gold', count: 3, areaTier: 10, materialTier: 1 }, items: [{ name: '越龙之石', qty: 2 }, { name: '神圣石', qty: 2 }] },
      { floor: 25, gear: { rarity: 'gold', count: 4, areaTier: 10, materialTier: 1 }, items: [{ name: '越龙之石', qty: 2 }, { name: '天仙玉露', qty: 2 }, { name: '锁魂玉', qty: 1 }] },
      { floor: 30, gear: { rarity: 'gold', count: 5, areaTier: 10, materialTier: 1 }, items: [{ name: '越龙之石', qty: 3 }, { name: '天仙玉露', qty: 3 }, { name: '强化丹B', qty: 3 }, { name: '琼浆玉露', qty: 1 }] }
    ],
    /* 不足第一档（死在第 1~4 层）的保底：必须属于塔本身（内向进度），不发区域材料 */
    consolation: [{ name: '重铸石', qty: 2 }],

    /* ================= 成绩感 =================
     * 称号按「最高到达层数 + 本局腐蚀度」给（本地判定，零美术成本）。
     * 周榜在第二批（EF 权威）落地，这里只登记上榜口径。 */
    titles: [
      { id: 'tower-10', minFloor: 10, name: '登塔者' },
      { id: 'tower-20', minFloor: 20, name: '破塔者' },
      { id: 'tower-30', minFloor: 30, name: '通天者' },
      { id: 'tower-30-hot', minFloor: 30, minCorrosion: 60, name: '焚天·通天者' }
    ],
    weeklyBoard: { metric: 'corrosionThenFloor', note: '先比本局腐蚀度，再比到达层数；每周一 00:00 重置' }
  };

  /* ================= 难度校准记录（2026-09-10，BattleSim 蒙特卡洛） =================
   * 脚本：docs/tests/sim_tower_balance.js（一次性，数值定稿后删除）
   * 校准画像（2026-09-10 修正：**用真实 12 件金装，不再用代理点数**）：
   *   低档 = 普通宠 Lv60 成长 30 无装备              → 攻 4306 / 血 8930 / 防 1847 / 暴击 16%
   *   中档 = 普通宠 Lv60 成长 100 + 12 件金装         → 攻 14489 / 血 29945 / 防 6224
   *          （金装真值中位：暴击 47.8% / 暴伤 203% / 命中 134 / 闪避 50 / 吸血 16.8% / 速 127 /
   *            穿透 38 / 伤害加成 8 / 减伤 4；装备对攻血防只贡献约 1%，印证「公式脱钩成长」）
   *   满配 = 神级宠 Lv60 成长 100+50N + 12 件金装    → 攻 21453+10710N / 血 44265+22050N
   * ⚠️ 教训：早先版本用「代理点数」（暴击 20% / 命中 100 / 速度 +20）代表金装，比真实金装
   *    低约一半（真实暴击 47.8%），把玩家算弱了约 50%。装备的机制属性（暴击/速度/吸血）
   *    才是战力大头，攻血防反而不是。改画像必须用 probe_gear_panel.js 重新采样。
   * 验收区间（用户拍板）：
   *   （2026-09-10 第二轮已改强：低档 6 层 / 中档 18 层 / 涅槃5 25 层，30 层为长线目标）
   * 【单只怪版本，2026-09-10 上午】start 0.30 / per 0.105 / elite 1.05 / baseStats{hp:86400,…,atk:6210,def:3060}
   *   → 低 8 / 中 19 / 涅槃1 24 / 涅槃3 27 / 涅槃5 通关 61%（剩 24.0%）← 锚点=涅槃5
   * 【2026-09-10 第二轮定稿：Lv60→120 + 全部怪会技能 + 属性「大大加强」】
   *   用户明确拍板：**「我这个宠物凭什么能进？就是要加强难度」** → 不保「满配能通」，
   *   30 层做成**真·长线目标**（当前谁都摸不到顶，逼你继续涅槃/做装备）。
   *   定稿 start=0.08 / perFloor=0.19 / baseStats.hp=48960（atk 6210 / def 3060 不变）。
   *   实测（14 局/档，含怪物技能的真实模拟）· **第四轮定稿（start 0.5 / per 0.124 / hp 48960）**：
   *     低档（成长 30 裸装）   中位 **0 层**  ← 第 1 层就过不去（用户拍板「我这个宠物凭什么能进」）
   *     中档（成长 100+金装）  中位 **10 层**
   *     涅槃1 → 16 层 / 涅槃3 → 19 层
   *     涅槃5（旧锚点）        中位 21 层、通关率 0%
   *   第 1 层杂兵面板 = 血 9792 / 攻 2096（挂 Lv60 的牌子就该有这个样子）；
   *   档位 5/10/15/20/25/30 保持不变 → **深层档位成为少数人的东西（用户知情选择）**。
   *   ⚠️ 关键设计事实：**腐印只加难度、不加战斗力**，所以「通关」纯靠硬实力 →
   *     **不存在「必须叠腐印才通」的付费墙**（付费买重置卡只是买「多打几把」）。
   *     要摸到 30 层只有一条路：继续变强（神级宠涅槃无成长上限 / 更好词缀装备 / 更高成长）。
   *   ⚠️ 结构性悬崖：perFloor 0.155↔0.160 就能让「满配稳过」翻成「几乎过不去」——
   *     因为本项目的有效战力是平方级（攻×血同时涨）。所以这里的数值只能按「目标画像」反推，
   *     不许凭手感微调。
   *   改 curve / baseStats / mobsPerFloor / skills 任意一项，都必须重跑 sim_tower_balance.js。
   *
   * ⚠️ 结构性事实（别试图「调平」它）：成长同时放大攻/血/防，有效战力是平方级，
   *    所以「打不过 → 无伤碾过」之间的过渡带很窄，是悬崖不是斜坡。
   *    因此「剩余血 10~30%」这条验收只在某个特定涅槃档成立 —— 当前那一档是涅槃 5。
   *    改 curve/baseStats/mobsPerFloor 必须重跑 sim 脚本，不许手调。
   * ============================================================================ */
})();
