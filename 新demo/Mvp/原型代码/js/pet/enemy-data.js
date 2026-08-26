/* ============================================================
 * enemy-data.js —— 野怪池数据
 * 职责：集中维护野怪来源、等级段、权重与基础蛋映射。
 * 说明：仅提供野怪池数据，不参与宠物进化、融合、变异逻辑。
 * ============================================================ */
window.EnemyData = {
  list: [
    { id: 'wild-rotten', name: '腐噜兽', icon: '🐹', level: 6, hp: 46, atk: 8, def: 2, spd: 55,
      rarityWeights: { white: 80, blue: 18, gold: 2 }, lootTier: 'low', levelRange: [1, 10], weight: 9,
      eggBaseName: '腐噜兽', enemyType: 'normal' },
    { id: 'wild-bloodfox', name: '血狐', icon: '🦊', level: 9, hp: 54, atk: 10, def: 3, spd: 95,
      rarityWeights: { white: 75, blue: 22, gold: 3 }, lootTier: 'low', levelRange: [1, 10], weight: 8,
      eggBaseName: '血狐', enemyType: 'normal' },

    { id: 'wild-bonewolf', name: '骨狼', icon: '🐺', level: 14, hp: 76, atk: 15, def: 5, spd: 75,
      rarityWeights: { white: 60, blue: 35, gold: 5 }, lootTier: 'mid', levelRange: [11, 20], weight: 8,
      eggBaseName: '骨狼', enemyType: 'normal' },
    { id: 'wild-shadowrabbit', name: '幽影兔', icon: '🐰', level: 16, hp: 80, atk: 16, def: 5, spd: 110,
      rarityWeights: { white: 55, blue: 38, gold: 7 }, lootTier: 'mid', levelRange: [11, 20], weight: 7,
      eggBaseName: '幽影兔', enemyType: 'normal' },
    { id: 'wild-plaguebear', name: '瘟熊', icon: '🐻', level: 18, hp: 102, atk: 17, def: 7, spd: 30,
      rarityWeights: { white: 50, blue: 42, gold: 8 }, lootTier: 'mid', levelRange: [11, 20], weight: 6,
      eggBaseName: '瘟熊', enemyType: 'normal' },
    { id: 'wild-bogfrog', name: '毒沼蛙', icon: '🐸', level: 15, hp: 88, atk: 15, def: 6, spd: 45,
      rarityWeights: { white: 52, blue: 40, gold: 8 }, lootTier: 'mid', levelRange: [11, 20], weight: 6,
      eggBaseName: '毒沼蛙', enemyType: 'normal' },
    { id: 'wild-corpsehound', name: '尸犬', icon: '🐶', level: 17, hp: 92, atk: 16, def: 5, spd: 65,
      rarityWeights: { white: 55, blue: 38, gold: 7 }, lootTier: 'mid', levelRange: [11, 20], weight: 7,
      eggBaseName: '尸犬', enemyType: 'normal' },
    { id: 'wild-plaguecat', name: '疫毛兽', icon: '🐱', level: 13, hp: 82, atk: 15, def: 5, spd: 85,
      rarityWeights: { white: 58, blue: 36, gold: 6 }, lootTier: 'mid', levelRange: [11, 20], weight: 7,
      eggBaseName: '疫毛兽', enemyType: 'normal' },

    { id: 'wild-bloodfang-fox', name: '血牙狐', icon: '🦷', level: 24, hp: 122, atk: 23, def: 8, spd: 95,
      rarityWeights: { white: 25, blue: 50, gold: 25 }, lootTier: 'high', levelRange: [21, 35], weight: 4,
      eggBaseName: '血狐', enemyType: 'evolved' },
    { id: 'wild-netherfrost-wolf', name: '冥霜狼', icon: '❄', level: 28, hp: 136, atk: 25, def: 10, spd: 75,
      rarityWeights: { white: 20, blue: 45, gold: 35 }, lootTier: 'high', levelRange: [21, 35], weight: 4,
      eggBaseName: '骨狼', enemyType: 'evolved' },
    { id: 'wild-withermaw', name: '尸牙犬', icon: '🦷', level: 26, hp: 128, atk: 24, def: 9, spd: 65,
      rarityWeights: { white: 22, blue: 48, gold: 30 }, lootTier: 'high', levelRange: [21, 35], weight: 4,
      eggBaseName: '尸犬', enemyType: 'evolved' },
    { id: 'wild-blightspine', name: '疫刺兽', icon: '🌵', level: 27, hp: 126, atk: 24, def: 8, spd: 85,
      rarityWeights: { white: 22, blue: 48, gold: 30 }, lootTier: 'high', levelRange: [21, 35], weight: 4,
      eggBaseName: '疫毛兽', enemyType: 'evolved' },
    { id: 'wild-umbra-rabbit', name: '影刃兔', icon: '🌙', level: 31, hp: 118, atk: 26, def: 7, spd: 110,
      rarityWeights: { white: 18, blue: 42, gold: 40 }, lootTier: 'high', levelRange: [21, 35], weight: 3,
      eggBaseName: '幽影兔', enemyType: 'evolved' },
    { id: 'wild-bog-king', name: '毒沼王', icon: '👑', level: 33, hp: 142, atk: 25, def: 12, spd: 45,
      rarityWeights: { white: 18, blue: 42, gold: 40 }, lootTier: 'high', levelRange: [21, 35], weight: 3,
      eggBaseName: '毒沼蛙', enemyType: 'evolved' },

    { id: 'wild-bloodfox-mutant', name: '血狐·异变', icon: '🦊', level: 40, hp: 156, atk: 31, def: 11, spd: 95,
      rarityWeights: { white: 10, blue: 35, gold: 55 }, lootTier: 'high', levelRange: [36, 60], weight: 1,
      eggBaseName: '血狐', enemyType: 'mutant' },
    { id: 'wild-bonewolf-mutant', name: '骨狼·异变', icon: '🐺', level: 42, hp: 166, atk: 33, def: 13, spd: 75,
      rarityWeights: { white: 10, blue: 35, gold: 55 }, lootTier: 'high', levelRange: [36, 60], weight: 1,
      eggBaseName: '骨狼', enemyType: 'mutant' },
    { id: 'wild-shadowrabbit-mutant', name: '幽影兔·异变', icon: '🐰', level: 45, hp: 152, atk: 34, def: 10, spd: 110,
      rarityWeights: { white: 8, blue: 32, gold: 60 }, lootTier: 'high', levelRange: [36, 60], weight: 1,
      eggBaseName: '幽影兔', enemyType: 'mutant' },
    { id: 'wild-plaguebear-mutant', name: '瘟熊·异变', icon: '🐻', level: 48, hp: 194, atk: 30, def: 16, spd: 30,
      rarityWeights: { white: 10, blue: 30, gold: 60 }, lootTier: 'high', levelRange: [36, 60], weight: 1,
      eggBaseName: '瘟熊', enemyType: 'mutant' }
  ]
};
