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
  const WILD_POINTS = [
    // 枯荣之地：中部森林区
    { id: 'p-corrupted', areaId: 'corrupted-forest', name: '枯荣之地', type: 'wild',
      x: 42, y: 55, recommended: '成长 3', matKey: 'corrupted-forest' },
    // 泣腐泥沼：左中墨绿湿地区
    { id: 'p-plague', areaId: 'plague-swamp', name: '泣腐泥沼', type: 'wild',
      x: 25, y: 50, recommended: '成长 5', matKey: 'plague-swamp' },
    // 白骨旷野：北部山脉
    { id: 'p-shadow', areaId: 'shadow-mountains', name: '白骨旷野', type: 'wild',
      x: 50, y: 20, recommended: '成长 8', matKey: 'shadow-mountains' },
    // 幽影迷境：左下幽冥群岛
    { id: 'p-bone', areaId: 'bone-wastes', name: '幽影迷境', type: 'wild',
      x: 20, y: 75, recommended: '成长 11', matKey: 'bone-wastes' },
    // 血潮裂谷：中部蜿蜒血河
    { id: 'p-blood', areaId: 'blood-rift', name: '血潮裂谷', type: 'wild',
      x: 70, y: 55, recommended: '成长 15', matKey: 'blood-rift' },
    // 腐变之源：右下深暗死地
    { id: 'p-blight', areaId: 'blight-heart', name: '腐变之源', type: 'wild',
      x: 78, y: 78, recommended: '成长 20', matKey: 'blight-heart' }
  ];

  /* ---------- 掉落预览（从 Config 推导，纯展示） ---------- */
  // 专属材料名 + 进化素材档位 + 金装概率倾向
  function buildPreview(point) {
    const D = (window.Config && window.Config.drop) || {};
    const am = (D.areaMaterials || {})[point.matKey];
    // areaEvolutionTiers 的 value 本身就是素材名数组（如 ['进化素材','精粹进化素材']）
    const evoTier = (D.areaEvolutionTiers || {})[point.matKey] || [];
    // 金装概率：取该图怪物池 rarityWeights.gold 的最大值作展示（值已是百分比，如 3 = 3%）
    const goldChance = goldPctOfArea(point.areaId);
    return {
      mat: am ? am.name : null,
      evoTiers: evoTier,
      gold: goldChance
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

  /* ---------- 渲染 ---------- */
  // 渲染世界地图页：底图 + 主城 + 各野图点位（印章点）
  function renderWorldMap(container) {
    if (!container) return;
    // 背景
    container.style.backgroundImage = 'url("' + WORLD_MAP_IMG + '")';
    container.style.backgroundSize = 'cover';
    container.style.backgroundPosition = 'center';
    // 主城
    container.appendChild(makeMarker(CAPITAL));
    // 野图点位
    for (const p of WILD_POINTS) {
      p._preview = buildPreview(p);
      container.appendChild(makeMarker(p));
    }
  }
  // 生成单个点位标记（印章点；capital 用城池样式）
  function makeMarker(point) {
    const el = document.createElement('button');
    el.className = 'wm-marker' + (point.type === 'capital' ? ' wm-marker--capital' : '');
    el.dataset.point = point.id;
    el.style.left = point.x + '%';
    el.style.top = point.y + '%';
    el.title = point.name;
    el.innerHTML = point.type === 'capital'
      ? '<span class="wm-marker-icon">' + (point.icon || '🏯') + '</span>'
      : '<span class="wm-marker-dot"></span>';
    return el;
  }

  /* ---------- 对外 API ---------- */
  window.WorldMap = {
    img: WORLD_MAP_IMG,
    capital: CAPITAL,
    points: WILD_POINTS,
    render: renderWorldMap,
    buildPreview: buildPreview
  };
})();
