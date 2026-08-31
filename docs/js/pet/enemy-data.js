/* ============================================================
 * enemy-data.js —— 野怪池数据
 * 职责：集中维护野怪来源、等级段、权重、类型与基础蛋映射。
 * 说明：
 *  - 战斗数值（血/攻/防）【不在这里配】：由 battle.js scaleEnemyStats 按
 *    config.battle.enemyBalance 的「参考玩家曲线」实时计算（图 recGrowth 决定强度档）。
 *    这里只配"这个怪是什么"（名字/图标/类型/蛋映射/掉落倾向）。
 *  - 提供野怪池数据，不参与宠物进化、融合、变异逻辑。
 * ============================================================ */
window.EnemyData = {
  list: [
    /* ---- 第 1 档（图 1，1~10 级）---- */
    { id: 'wild-rotten', name: '腐噜兽', icon: '🐹', level: 6, spd: 55,
      rarityWeights: { white: 80, blue: 18, gold: 2 }, levelRange: [1, 10], weight: 9,
      eggBaseName: '腐噜兽', enemyType: 'normal' },
    { id: 'wild-bloodfox', name: '血狐', icon: '🦊', level: 9, spd: 95,
      rarityWeights: { white: 75, blue: 22, gold: 3 }, levelRange: [1, 10], weight: 8,
      eggBaseName: '血狐', enemyType: 'normal' },

    /* ---- 第 2 档（图 2，10~20 级）---- */
    { id: 'wild-bonewolf', name: '骨狼', icon: '🐺', level: 14, spd: 75,
      rarityWeights: { white: 60, blue: 35, gold: 5 }, levelRange: [11, 20], weight: 8,
      eggBaseName: '骨狼', enemyType: 'normal' },
    { id: 'wild-shadowrabbit', name: '幽影兔', icon: '🐰', level: 16, spd: 110,
      rarityWeights: { white: 55, blue: 38, gold: 7 }, levelRange: [11, 20], weight: 7,
      eggBaseName: '幽影兔', enemyType: 'normal' },
    { id: 'wild-plaguebear', name: '瘟熊', icon: '🐻', level: 18, spd: 30,
      rarityWeights: { white: 50, blue: 42, gold: 8 }, levelRange: [11, 20], weight: 6,
      eggBaseName: '瘟熊', enemyType: 'normal' },
    { id: 'wild-bogfrog', name: '毒沼蛙', icon: '🐸', level: 15, spd: 45,
      rarityWeights: { white: 52, blue: 40, gold: 8 }, levelRange: [11, 20], weight: 6,
      eggBaseName: '毒沼蛙', enemyType: 'normal' },
    { id: 'wild-corpsehound', name: '尸犬', icon: '🐶', level: 17, spd: 65,
      rarityWeights: { white: 55, blue: 38, gold: 7 }, levelRange: [11, 20], weight: 7,
      eggBaseName: '尸犬', enemyType: 'normal' },
    { id: 'wild-plaguecat', name: '疫毛兽', icon: '🐱', level: 13, spd: 85,
      rarityWeights: { white: 58, blue: 36, gold: 6 }, levelRange: [11, 20], weight: 7,
      eggBaseName: '疫毛兽', enemyType: 'normal' },

    /* ---- 第 3 档（图 3/4，20~40 级）---- */
    { id: 'wild-bloodfang-fox', name: '血牙狐', icon: '🦷', level: 24, spd: 95,
      rarityWeights: { white: 25, blue: 50, gold: 25 }, levelRange: [21, 35], weight: 4,
      eggBaseName: '血狐', enemyType: 'evolved' },
    { id: 'wild-netherfrost-wolf', name: '冥霜狼', icon: '❄', level: 28, spd: 75,
      rarityWeights: { white: 20, blue: 45, gold: 35 }, levelRange: [21, 35], weight: 4,
      eggBaseName: '骨狼', enemyType: 'evolved' },
    { id: 'wild-withermaw', name: '尸牙犬', icon: '🦷', level: 26, spd: 65,
      rarityWeights: { white: 22, blue: 48, gold: 30 }, levelRange: [21, 35], weight: 4,
      eggBaseName: '尸犬', enemyType: 'evolved' },
    { id: 'wild-blightspine', name: '疫刺兽', icon: '🌵', level: 27, spd: 85,
      rarityWeights: { white: 22, blue: 48, gold: 30 }, levelRange: [21, 35], weight: 4,
      eggBaseName: '疫毛兽', enemyType: 'evolved' },
    { id: 'wild-umbra-rabbit', name: '影刃兔', icon: '🌙', level: 31, spd: 110,
      rarityWeights: { white: 18, blue: 42, gold: 40 }, levelRange: [21, 35], weight: 3,
      eggBaseName: '幽影兔', enemyType: 'evolved' },
    { id: 'wild-bog-king', name: '毒沼王', icon: '👑', level: 33, spd: 45,
      rarityWeights: { white: 18, blue: 42, gold: 40 }, levelRange: [21, 35], weight: 3,
      eggBaseName: '毒沼蛙', enemyType: 'evolved' },

    /* ---- 第 4 档（图 5/6 起，40~100 级，变异怪）----
     * 2026-08-31：levelRange 上限 60 → 100（第二幕图 11-17 复用变异怪池）。
     * 这个字段只管「怪池与图段重叠」过滤；战斗数值来自 areaEnemyStats × 等级缩放，与此处无关。 */
    { id: 'wild-bloodfox-mutant', name: '血狐·异变', icon: '🦊', level: 40, spd: 95,
      rarityWeights: { white: 10, blue: 35, gold: 55 }, levelRange: [36, 100], weight: 1,
      eggBaseName: '血狐', enemyType: 'mutant' },
    { id: 'wild-bonewolf-mutant', name: '骨狼·异变', icon: '🐺', level: 42, spd: 75,
      rarityWeights: { white: 10, blue: 35, gold: 55 }, levelRange: [36, 100], weight: 1,
      eggBaseName: '骨狼', enemyType: 'mutant' },
    { id: 'wild-shadowrabbit-mutant', name: '幽影兔·异变', icon: '🐰', level: 45, spd: 110,
      rarityWeights: { white: 8, blue: 32, gold: 60 }, levelRange: [36, 100], weight: 1,
      eggBaseName: '幽影兔', enemyType: 'mutant' },
    { id: 'wild-plaguebear-mutant', name: '瘟熊·异变', icon: '🐻', level: 48, spd: 30,
      rarityWeights: { white: 10, blue: 30, gold: 60 }, levelRange: [36, 100], weight: 1,
      eggBaseName: '瘟熊', enemyType: 'mutant' }
  ]
};
