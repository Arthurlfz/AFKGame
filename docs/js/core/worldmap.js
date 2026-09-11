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
    icon: '<svg class="eic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5V3"/><path d="M14 5V3"/><path d="M15 21v-3a3 3 0 0 0-6 0v3"/><path d="M18 3v8"/><path d="M18 5H6"/><path d="M22 11H2"/><path d="M22 9v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9"/><path d="M6 3v8"/></svg>',               // 占位（后续换水墨城池图）
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
    // 腐变之源：右下深暗死地（Lv60 毕业 —— 终形态 + 学技能 + 神级宠之门）
    { id: 'p-blight', areaId: 'blight-heart', name: '腐变之源', type: 'wild',
      x: 78, y: 78, recommended: '成长 21', matKey: 'blight-heart' }
    /* ---- 2026-09-06 地图精简 17→10（手册 2.1）----
     * 删除第二幕 7 个点位（rift-fissure / black-blood-moor / bone-abyss / plague-heart /
     * soul-nest / annihilation-hall / blight-origin）：那些图因 maxLevel=60 早已进不去；
     * 「地狱/通天塔」以后作为独立系统另行设计。点位必须与 Config.battle.areas 一一对应
     * （vtest_worldmap.js 守一致性）。 */
  ];

  /* ---------- 资源副本点位（2026-09-09）：三个资源试炼副本，节点进入 ----------
   * routeId 必须与 Config.resourceTrials.routes[].id 一一对应（vtest_resource_trial.js 守一致性）。
   * 落点选在地图左侧水域的「试炼群岛」上，与野图（wild）和主城（capital）视觉区分。
   * 点击节点 → 打开副本详情页（免费次数 / 门票 / 掉落 / 选宠）→ 进入试炼。 */
  const TRIAL_POINTS = [
    { id: 't-metamorph', routeId: 'metamorph', name: '副本·蜕变试炼', type: 'trial', x: 8, y: 10 },
    { id: 't-nirvana', routeId: 'nirvana', name: '副本·涅槃试炼', type: 'trial', x: 6, y: 45 },
    { id: 't-temper', routeId: 'temper', name: '副本·淬炼试炼', type: 'trial', x: 9, y: 82 }
  ];

  /* ---------- 通天塔节点（2026-09-10）：后期内容，独立于野图与副本 ----------
   * 单独一个节点、不参与 areaId 体系（不经过 Battle.selectArea），与副本节点同构。
   * 落点取右上角留白：左侧 6~9% 已被三个副本节点占用，野图节点分布在 12~90%，
   * 右上（x≈88, y≈12）无冲突，视觉上与左侧「试炼群岛」形成左右对称。 */
  const TOWER_POINT = {
    id: 'p-tower',
    name: '通天塔',
    type: 'tower',
    x: 88, y: 12,
    desc: '后期挑战：30 层连续爬塔。白图能通，贴腐印换掉率。'
  };

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
    trialPoints: TRIAL_POINTS,
    towerPoint: TOWER_POINT,
    buildPreview: buildPreview
  };
})();
