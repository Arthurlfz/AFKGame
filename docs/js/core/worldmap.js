/* ============================================================
 * core/worldmap.js —— 世界地图配置（二级菜单：选图 → 战斗）
 * 职责：
 *  1. 世界地图底图路径
 *  2. 主城 + 各野图点位的坐标（百分比 x/y，相对底图），可持续扩展
 *  3. 每个点位的信息卡内容（图名/等级段/掉落预览/推荐成长）
 * 说明：
 *  - 纯配置 + 渲染，不参与战斗逻辑。
 *  - 以后加新图/新大陆：在 points 里加一条即可，不用改代码。
 *  - 坐标是相对底图的百分比（0~100），底图用 cover 铺满时仍能对准。
 *  - 掉落预览数据从 Config.drop.areaMaterials / areaEvolutionTiers / 怪物池推导，集中在此展示。
 * ============================================================ */
(function () {
  'use strict';

  const WORLD_MAP_IMG = 'assets/worldmap/worldmap.png'; // 底图路径

  /* ---------- 主城 ---------- */
  const CAPITAL = {
    id: 'capital',
    name: '不归城',
    type: 'capital',          // capital = 主城/安全区；wild = 野图
    desc: '旅者的据点，暗黑大陆上唯一安全的栖息地。在此休整、回满生命。',
    x: 50, y: 34,             // 底图中央偏上的城池位置（百分比）
    icon: '🏯',               // 占位（后续换水墨城池图）
    capital: true
  };

  /* ---------- 各野图点位（坐标按底图实际地形分布） ----------
   * x/y = 相对底图宽高的百分比（0~100）。
   * areaId 必须与 Config.battle.areas 的 id 对应，进入战斗时用 selectArea(areaId)。 */
  /* 点位必须与 Config.battle.areas【一一对应】：新增图时这里也要加一条，
   * 否则新图在世界地图上不显示（vtest_worldmap.js 守这条一致性）。
   * recommended 与 Config.battle.areas[].recGrowth 保持一致。 */
  const WILD_POINTS = [
    // 枯荣之地：中部森林区
    { id: 'p-corrupted', areaId: 'corrupted-forest', name: '枯荣之地', type: 'wild',
      x: 42, y: 55, recommended: '成长 3', matKey: 'corrupted-forest' },
    // 泣腐泥沼：左中墨绿湿地区
    { id: 'p-plague', areaId: 'plague-swamp', name: '泣腐泥沼', type: 'wild',
      x: 25, y: 50, recommended: '成长 5', matKey: 'plague-swamp' },
    // 白骨旷野：北部山脉
    { id: 'p-shadow', areaId: 'shadow-mountains', name: '白骨旷野', type: 'wild',
      x: 50, y: 20, recommended: '成长 7', matKey: 'shadow-mountains' },
    // 幽影迷境：左下幽冥群岛
    { id: 'p-bone', areaId: 'bone-wastes', name: '幽影迷境', type: 'wild',
      x: 20, y: 75, recommended: '成长 9', matKey: 'bone-wastes' },
    // 血潮裂谷：中部蜿蜒血河
    { id: 'p-blood', areaId: 'blood-rift', name: '血潮裂谷', type: 'wild',
      x: 70, y: 55, recommended: '成长 11', matKey: 'blood-rift' },
    /* ---- 2026-08-30 地图重排：新增 4 图提前 + 腐变之源做最终地图（顺序即等级）---- */
    // 回响崖：左上悬崖带
    { id: 'p-echo', areaId: 'echo-cliffs', name: '回响崖', type: 'wild',
      x: 12, y: 30, recommended: '成长 13', matKey: 'echo-cliffs' },
    // 腐沼泽：底部左侧沼地
    { id: 'p-rotfen', areaId: 'rotfen-bog', name: '腐沼泽', type: 'wild',
      x: 35, y: 88, recommended: '成长 15', matKey: 'rotfen-bog' },
    // 余烬渊：底部中央裂口
    { id: 'p-ember', areaId: 'ember-hollow', name: '余烬渊', type: 'wild',
      x: 58, y: 90, recommended: '成长 17', matKey: 'ember-hollow' },
    // 魂渊：右侧深渊
    { id: 'p-soul', areaId: 'soul-abyss', name: '魂渊', type: 'wild',
      x: 90, y: 40, recommended: '成长 19', matKey: 'soul-abyss' },
    // 腐变之源：右下深暗死地（第一幕终章：Lv60 毕业 —— 终形态 + 学技能 + 涅槃解锁）
    { id: 'p-blight', areaId: 'blight-heart', name: '腐变之源', type: 'wild',
      x: 78, y: 78, recommended: '成长 21', matKey: 'blight-heart' },
    /* ---- 2026-08-31 第二幕 7 图（61-100 级）：节点挂现有世界地图，不画新大地图 ---- */
    // 腐变裂隙：腐变之源向右侧延伸的裂缝
    { id: 'p-rift', areaId: 'rift-fissure', name: '腐变裂隙', type: 'wild',
      x: 90, y: 70, recommended: '成长 23', matKey: 'rift-fissure' },
    // 黑血沼原：中部偏右下的黑色血沼
    { id: 'p-bbmoor', areaId: 'black-blood-moor', name: '黑血沼原', type: 'wild',
      x: 60, y: 72, recommended: '成长 25', matKey: 'black-blood-moor' },
    // 万骨深渊：北部山脉深处的白骨坑
    { id: 'p-boneabyss', areaId: 'bone-abyss', name: '万骨深渊', type: 'wild',
      x: 44, y: 36, recommended: '成长 27', matKey: 'bone-abyss' },
    // 疫潮之心：左上角的瘟疫心脏
    { id: 'p-plagueheart', areaId: 'plague-heart', name: '疫潮之心', type: 'wild',
      x: 26, y: 14, recommended: '成长 29', matKey: 'plague-heart' },
    // 噬魂巢穴：最左侧的巢穴
    { id: 'p-soulnest', areaId: 'soul-nest', name: '噬魂巢穴', type: 'wild',
      x: 6, y: 52, recommended: '成长 31', matKey: 'soul-nest' },
    // 湮灭回廊：右下角的终末回廊
    { id: 'p-annih', areaId: 'annihilation-hall', name: '湮灭回廊', type: 'wild',
      x: 94, y: 90, recommended: '成长 33', matKey: 'annihilation-hall' },
    // 腐变本源：右上角的最终地图（100 级）
    { id: 'p-origin', areaId: 'blight-origin', name: '腐变本源', type: 'wild',
      x: 72, y: 24, recommended: '成长 35', matKey: 'blight-origin' }
  ];

  /* ---------- 掉落预览（从 Config 推导，纯展示） ---------- */
  // 专属材料名 + 进化素材档位 + 金装概率倾向 + 各图材料掉落分布（materialWeightsByTier）
  function buildPreview(point) {
    const D = (window.Config && window.Config.drop) || {};
    const am = (D.areaMaterials || {})[point.matKey];
    // areaEvolutionTiers 的 value 本身就是素材名数组（如 ['进化素材','精粹进化素材']）
    const evoTier = (D.areaEvolutionTiers || {})[point.matKey] || [];
    // 金装概率：取该图怪物池 rarityWeights.gold 的最大值作展示（值已是百分比，如 3 = 3%）
    const goldChance = goldPctOfArea(point.areaId);
    // 材料掉落分布：按图档取 materialWeightsByTier，换算占材料分支的比例与相对条形长度
    const areas = (window.Config && window.Config.battle && window.Config.battle.areas) || [];
    const areaIdx = areas.findIndex(x => x.id === point.areaId);
    const tier = areaIdx >= 0 ? areaIdx + 1 : -1;
    const wTbl = tier > 0 ? (D.materialWeightsByTier || {})[tier] : null;
    let dropDist = null;
    if (wTbl) {
      const vals = Object.keys(wTbl).map(k => wTbl[k] || 0);
      const total = vals.reduce((s, v) => s + v, 0) || 1;
      const maxW = Math.max.apply(null, vals) || 1;
      dropDist = Object.keys(wTbl).map(k => {
        const w = wTbl[k] || 0;
        return {
          key: k,
          // 区域材料显示为专属材料名；其余键本身就是材料展示名
          name: k === '区域材料' && am ? am.name : k,
          weight: w,
          pct: Math.round(w / total * 100),   // 占材料分支百分比（数值精确）
          bar: Math.round(w / maxW * 100),    // 相对条形长度（视觉对比，最长=100%）
          variants: k === '进化素材' ? evoTier : null // 进化素材档位（普通/精粹/传说）
        };
      }).sort((x, y) => y.weight - x.weight);
    }
    return {
      mat: am ? am.name : null,
      evoTiers: evoTier,
      gold: goldChance,
      dropDist: dropDist
    };
  }
  function goldPctOfArea(areaId) {
    const area = ((window.Config && window.Config.battle) || {}).areas;
    const a = area && area.find(x => x.id === areaId);
    if (!a || !a.enemyIds) return null;
    const enemies = (window.EnemyData && window.EnemyData.list) || [];
    let max = 0;
    for (const e of a.enemyIds) {
      const hit = enemies.find(en => en.id === e);
      if (hit && hit.rarityWeights && typeof hit.rarityWeights.gold === 'number') {
        max = Math.max(max, hit.rarityWeights.gold);
      }
    }
    return max;
  }

  /* ---------- 对外 API ---------- */
  window.WorldMap = {
    img: WORLD_MAP_IMG,
    capital: CAPITAL,
    points: WILD_POINTS,
    buildPreview: buildPreview
  };
})();
