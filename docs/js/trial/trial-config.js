/* ============================================================
 * trial/trial-config.js —— 资源副本·全部数值配置（唯一事实源）
 * 职责：
 *  1. Config.resourceTrials：20 层爬塔参数、层难度曲线、档位奖励、三条路线
 *  2. 门票注入地图委托（collect_loop 每轮 1 张）
 * 规范：一个文件一个职责 —— 这里只放数值与静态配置，不放任何逻辑；
 *       运行逻辑见 trial-access.js（资格）/ trial-engine.js（层推进）/ trial-rewards.js（结算）。
 * 依赖：config.js 必须先加载。
 * ============================================================ */
(function () {
  'use strict';

  window.Config.resourceTrials = {
    enabled: true,
    ticketName: '资源试炼门票',
    /* 每副本每日免费进入次数（北京时间 12:00 刷新，见 trial-access.js 的 dayKeyOf）。
     * 免费次数用尽后进入需消耗 1 张门票。设为 0 即回到纯门票模式。 */
    freeEntriesPerDay: 3,
    ticketSources: '完成地图委托（每轮 1 张）',

    /* ================= 20 层爬塔 =================
     * 每层一只真怪（数值体系与大地图同源，见 trial-engine.js 的 floorEnemyStats），
     * 血量跨层累计不回满，死亡或通关即结算。
     * 难度曲线（全部定死，不搞动态难度）：
     *   怪等级   = floorLevelStart ~ floorLevelEnd 线性插值（第 1 层→第 20 层）
     *   层难度   = floorDifficultyStart × (1+floorDifficultyPerFloor)^(N-1)
     *              × eliteMult^(已跨过的强档层数) × route.difficulty
     *              —— 复合递增 + 强档层阶梯永久保留，全程严格递增（难度绝不倒退）
     *   强档层   = 每 eliteEvery 层（5/10/15/20）难度 × eliteMult 跳一档，与奖励档位对齐
     *   怪数值   = baseStats × (怪等级 / floorLevelEnd) × 层难度
     * baseStats 锚点 = 第 20 层（Lv100·难度 ≈1.0）的怪，校准目标：
     *   「当前满成长 + 主流装备」打得过但紧张（校准记录见 tests/vtest_resource_trial.js）。 */
    floors: 20,
    floorLevelStart: 10,
    floorLevelEnd: 100,
    floorDifficultyStart: 0.3,
    floorDifficultyPerFloor: 0.045,
    eliteEvery: 5,
    eliteMult: 1.1,
    baseStats: { hp: 100000, atk: 7200, def: 3600 },
    /* 守关者命中：高于野怪默认 90 —— 满成长玩家闪避 ~88，90 命中会被砍半，
     * 守关者要能打到人（战斗有压力），160 → 命中率 ~64%。 */
    guardianHit: 160,
    /* 【难度校准记录 2026-09-10，BattleSim 蒙特卡洛 500 场/层】
     * 参考玩家 = Lv60 + 满成长100 + 12件金装(T10/底材T5)（面板 攻1.45万/血3.0万/防6184/闪避46-88/吸血14-22%）：
     *   第20层胜率 100% 但单层掉血 30%（6.6刀）——叠加血量跨层累计，实战通关剩余血 ~20-50%，紧张但能过；
     * 成长30裸装（攻4306）：≥50%胜率最深第 9 层；成长60金装（攻8806）：最深第 19 层 —— 曲线按成长"以此类推"成立。
     * 注意：满成长玩家对野图顶格数值（图10 血2520）是一刀秒（引擎注释"涅槃叠成长→一刀秒"），
     *   所以副本锚点必须远超野图顶格 —— 这就是"顶层=满成长+装备才拿得下"的物理含义。 */
    /* 层与层之间的停顿（毫秒）：给日志/血条一点喘息，太快看不清推进感 */
    floorDelayMs: 700,

    /* ================= 三条路线 =================
     * floorTiers：按【最高到达层数】取档（5/10/15/20），越深越好；
     *   不足 5 层失败只给 consolation。废除旧「按宠物等级取档」机制。
     * consolation：失败补偿，必须属于本路线（内向进度），绝不是区域材料。 */
    routes: [
      {
        id: 'metamorph', name: '副本·蜕变试炼',
        desc: '定向获得进化素材的 20 层爬塔：层数越深，素材档位越高（进化 → 精粹 → 传说）。',
        minLevel: 1, difficulty: 1.0,
        bgAreaId: 'corrupted-forest',
        guardian: { name: '影蚀魔君', title: '蜕变守护者' },
        floorTiers: [
          { floor: 5,  items: [{ name: '进化素材', qty: 3 }] },
          { floor: 10, items: [{ name: '精粹进化素材', qty: 2 }] },
          { floor: 15, items: [{ name: '精粹进化素材', qty: 2 }, { name: '传说进化素材', qty: 1 }] },
          { floor: 20, items: [{ name: '传说进化素材', qty: 2 }] }
        ],
        consolation: [{ name: '进化素材', qty: 1 }]
      },
      {
        id: 'nirvana', name: '副本·涅槃试炼',
        desc: '定向获得涅槃丹的 20 层爬塔（涅槃时可选消耗，吸收 ×1.2）：爬得越深，丹越多。',
        minLevel: 25, difficulty: 1.35,
        bgAreaId: 'plague-swamp',
        guardian: { name: '幽火魔狐', title: '涅槃守护者' },
        floorTiers: [
          { floor: 5,  items: [{ name: '涅槃丹', qty: 1 }] },
          { floor: 10, items: [{ name: '涅槃丹', qty: 2 }] },
          { floor: 15, items: [{ name: '涅槃丹', qty: 3 }] },
          { floor: 20, items: [{ name: '涅槃丹', qty: 4 }] }
        ],
        consolation: [{ name: '合成之石', qty: 1 }]
      },
      {
        id: 'temper', name: '副本·淬炼试炼',
        desc: '定向获得打造通货的 20 层爬塔：高阶层产出神圣石与锁定石（锁前/锁后的唯一来源）。',
        minLevel: 1, difficulty: 1.1,
        bgAreaId: 'shadow-mountains',
        guardian: { name: '骸骨君主', title: '淬炼守护者' },
        floorTiers: [
          { floor: 5,  items: [{ name: '重铸石', qty: 3 }] },
          { floor: 10, items: [{ name: '增缀石', qty: 1 }, { name: '剥离石', qty: 1 }] },
          // 15/20 档各带一枚腐印（通天塔用的词缀道具）：副本是腐印的第二个稳定来源。
          // 名称必须与 Config.tower.affix.items[].name 一致（tower-affix.js 按名字扣道具）。
          { floor: 15, items: [{ name: '神圣石', qty: 1 }, { name: '腐印·荆棘', qty: 1 }] },
          { floor: 20, items: [{ name: '神圣石', qty: 1 }, { name: '锁定石', qty: 1 }, { name: '腐印·屠戮', qty: 1 }] }
        ],
        consolation: [{ name: '重铸石', qty: 1 }]
      }
    ]
  };

  /* 门票的稳定来源：地图委托每交一轮给 1 张。
   * 挂在 collect_loop 上而不是掉落表：不新增货币、不改掉落与战斗公式，
   * 且「挂机攒材料 → 交委托 → 换门票 → 定向补资源」正好是副本要验证的主循环。
   * 统一注入而非逐条改奖励表：以后加新图委托自动跟上。 */
  (function () {
    const ticket = window.Config.resourceTrials.ticketName;
    (window.Config.drop.quests || []).forEach(q => {
      if (q.type !== 'collect_loop') return;
      q.reward = Object.assign({}, q.reward, { [ticket]: 1 });
    });
  })();
})();
