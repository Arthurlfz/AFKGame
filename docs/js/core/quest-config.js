/* ============================================================
 * quest-config.js —— 任务表结构规范化层
 * 职责（一个文件一个职责）：只做「数据规范化 + 校验」，不含任何玩法逻辑。
 *
 * 为什么需要它：
 *   Config.drop.quests 是一张扁平表，任务的"身份"只能靠 repeat / repeatable / category
 *   三个字段的组合去猜，于是出现两类结构性问题：
 *     · 可重复的循环委托（collect_loop / 觉醒之路）被塞进「主线 / 宠物」分类 ——
 *       而 isFinished() 对 repeatable 恒返回 false，它们永远占着一次性分类的列表与角标；
 *     · 每日任务与一次性收集任务长得一模一样，UI 无法做「日常 → 收集 → 具体任务」的分级。
 *
 * 本层在配置加载完之后跑一次，给每条任务补 4 个规范字段（不新增表、不改云端结构）：
 *   kind     一级分类：guide / series / pet / daily / loop / achieve
 *   reset    重置周期：none / daily
 *   chapter  系列归属的地图 id（仅 kind='series'）
 *   group    二级分组 { id, label, order } —— UI 的分级折叠靠它
 *
 * 设计约束：
 *   · 只增字段，不删不改原字段 —— 旧存档的 completed 键、旧测试的断言都不受影响
 *   · 派生优先于手写：能算出来的一律算，不往 config 里再抄一份
 *   · 校验失败只 console.warn，不 throw（一条脏数据不能让游戏起不来）
 *
 * 加载顺序：config.js → trial-config.js → quest-config.js → quest.js
 *   （放在 trial-config 之后，是因为它会给 collect_loop 注入门票奖励；
 *     quest.js 读表是懒加载，所以排在它前后都安全。）
 * ============================================================ */
(function () {
  'use strict';
  const C = window.Config;

  /* ---------- 一级分类（UI 的 tab，顺序 = 注意力优先级） ---------- */
  const KIND_META = [
    { id: 'guide',    label: '引导', icon: '🌱', order: 1 },
    { id: 'series',   label: '系列', icon: '📜', order: 2 },
    { id: 'pet',      label: '宠物', icon: '🐾', order: 3 },
    { id: 'daily',    label: '日常', icon: '🔁', order: 4 },
    { id: 'weekly',   label: '周常', icon: '🗓', order: 5 },
    { id: 'exchange', label: '兑换', icon: '🔄', order: 6 },
    { id: 'bonus',    label: '目标', icon: '🎯', order: 7 },
    { id: 'loop',     label: '循环', icon: '♻️', order: 8 },
    { id: 'achieve',  label: '成就', icon: '🏆', order: 9 }
  ];
  const KIND_LABEL = KIND_META.reduce((m, k) => { m[k.id] = k.label; return m; }, {});
  const RESETS = ['none', 'daily', 'weekly'];

  /* ---------- 目标形式 → 二级分组族 ----------
   * UI 上「日常任务 → 收集任务 → 具体任务」里的中间那一层就是它。
   * 同族的任务合并到一组，族的顺序由 order 决定。 */
  const FAMILY = {
    collect:      { id: 'collect', label: '收集任务', order: 1 },
    collect_loop: { id: 'collect', label: '收集任务', order: 1 },
    kill:         { id: 'kill',    label: '击败任务', order: 2 },
    boss:         { id: 'boss',    label: '守关 Boss', order: 3 },
    equipDrop:    { id: 'gear',    label: '装备任务', order: 4 },
    equip:        { id: 'gear',    label: '装备任务', order: 4 },
    craft:        { id: 'craft',   label: '打造任务', order: 5 },
    salvage:      { id: 'craft',   label: '打造任务', order: 5 },
    soulcast:     { id: 'craft',   label: '打造任务', order: 5 },
    disposeKill:  { id: 'craft',   label: '打造任务', order: 5 },
    disposeBoss:  { id: 'craft',   label: '打造任务', order: 5 },
    evolve:       { id: 'grow',    label: '养成任务', order: 6 },
    nirvana:      { id: 'grow',    label: '养成任务', order: 6 },
    synth:        { id: 'grow',    label: '养成任务', order: 6 },
    hatch:        { id: 'grow',    label: '养成任务', order: 6 },
    level:        { id: 'grow',    label: '养成任务', order: 6 },
    list:         { id: 'trade',   label: '交易任务', order: 7 },
    trade:        { id: 'trade',   label: '交易任务', order: 7 },
    /* 副本/塔（2026-09-11 接入任务系统）：次数与最高层数的上报类型 */
    trialRun:     { id: 'dungeon', label: '副本任务', order: 8 },
    trialFloor:   { id: 'dungeon', label: '副本任务', order: 8 },
    towerRun:     { id: 'tower',   label: '通天塔任务', order: 8 },
    towerFloor:   { id: 'tower',   label: '通天塔任务', order: 8 },
    chapterChest: { id: 'chest',   label: '章宝箱',    order: 9 },
    direction:    { id: 'other',   label: '其他',     order: 9 }
  };
  const FAMILY_FALLBACK = { id: 'other', label: '其他任务', order: 9 };

  const areas = () => (C.battle && C.battle.areas) || [];
  const areaById = id => areas().find(a => a.id === id) || null;

  /* ---------- kind 判定 ----------
   * 顺序要紧：重置周期（repeat = 每日）优先于 category，
   * 因为"日常"是周期属性，"主线/宠物"是内容归属，两者不是一个维度。 */
  function kindOf(q) {
    // 显式声明优先：新增的一级分类（如 exchange）没有可推导的旧字段，只能在数据里写明 kind。
    if (q.kind && KIND_META.some(k => k.id === q.kind)) return q.kind;
    if (q.repeat) return 'daily';
    if (q.repeatable) return 'loop';
    if (q.category === 'tutorial') return 'guide';
    if (q.category === 'achieve') return 'achieve';
    if (q.category === 'daily') return 'daily';
    if (q.category === 'pet') return 'pet';
    return 'series';   // category 'main' 里的一次性条目
  }

  /* ---------- 章节归属 ----------
   * 系列天然是「10 图 × 4 条」，所以编号即章节，不需要人工标注：
   *   m1~m4 → 第 1 章（枯荣之地），m5~m8 → 第 2 章，以此类推
   *   boss{N} → 第 N 章的守关 Boss
   * 用「编号」而不是「matName / area 反查」是因为 m 系列的后半条（进化/打造/装备）
   * 本身不带 area 也不带 material，反查不出来。 */
  function chapterIndexOf(q) {
    const m = /^m(\d+)$/.exec(q.id || '');
    if (m) return Math.ceil(Number(m[1]) / 4);   // m1~m40：每 4 条一章
    const k = /^mk(\d+)$/.exec(q.id || '');
    if (k) return Number(k[1]);                   // mk1~mk10「久战」：编号即章节
    const b = /^boss(\d+)$/.exec(q.id || '');
    if (b) return Number(b[1]);                   // boss1~boss10：编号即章节
    const c = /^chest(\d+)$/.exec(q.id || '');
    if (c) return Number(c[1]);                   // chest1~chest10 章宝箱（2026-09-11）：编号即章节
    return 0;
  }

  function familyOf(q) { return FAMILY[q.type] || FAMILY_FALLBACK; }

  /* ---------- 二级分组 ---------- */
  const petOrderCache = {};
  function petOrder(name) {
    if (petOrderCache[name] == null) petOrderCache[name] = Object.keys(petOrderCache).length + 1;
    return petOrderCache[name];
  }

  function groupOf(q) {
    if (q.kind === 'guide') return { id: 'g:guide', label: '新手引导链', order: 1 };

    if (q.kind === 'series') {
      const idx = chapterIndexOf(q);
      const a = areas()[idx - 1];
      if (a) return { id: 'ch:' + a.id, label: '第 ' + idx + ' 章 · ' + a.name, order: idx, area: a.id };
      return { id: 'ch:?', label: '系列任务', order: 99, area: null };
    }

    if (q.kind === 'pet') {
      const n = q.petName || '未知';
      return { id: 'fam:' + n, label: n, order: petOrder(n), petName: n };
    }

    if (q.kind === 'loop') {
      // 两条语义分得开：collect_loop = 跟图绑定的循环委托；其余（觉醒之路）= 长线收集
      return q.type === 'collect_loop'
        ? { id: 'l:map',  label: '地图委托（每图一轮）', order: 1 }
        : { id: 'l:long', label: '长线收集',            order: 2 };
    }

    // 兑换：按重置周期分成两组（硬上限是它的灵魂，要写在组名上让玩家一眼看到）
    if (q.kind === 'exchange') {
      return q.reset === 'weekly'
        ? { id: 'x:week', label: '每周兑换 · 各限 1 次', order: 2 }
        : { id: 'x:day',  label: '每日兑换 · 各限 1 次', order: 1 };
    }

    // 目标（bonus）：今日勤勉 / 本周活跃 —— 按周期分组，与兑换同一套口径
    if (q.kind === 'bonus') {
      return q.reset === 'weekly'
        ? { id: 'b:week', label: '每周目标', order: 2 }
        : { id: 'b:day',  label: '每日目标', order: 1 };
    }

    // daily / achieve：按目标形式族分组
    const f = familyOf(q);
    return { id: 'tf:' + f.id, label: f.label, order: f.order };
  }

  /* ---------- 规范化：把字段挂回 config ---------- */
  function normalize() {
    const list = (C.drop && C.drop.quests) || [];
    list.forEach(q => {
      const kd = kindOf(q);
      q.kind = kd;
      // 兑换是新增分类，没有对应的旧 category（数据里写的是 'daily' 以免旧代码读到未知值）
      // → 这里把 category 对齐成 'exchange'，别让它在任何按 category 读的地方谎报自己是日常。
      if (kd === 'exchange') q.category = 'exchange';
      // reset 先定，groupOf 要用它区分「每日兑换 / 每周兑换」
      if (!q.reset || RESETS.indexOf(q.reset) < 0) q.reset = (q.repeat || kd === 'daily') ? 'daily' : 'none';
      q.chapter = kd === 'series' ? (groupOf(q).area || null) : null;
      q.group = groupOf(q);
    });
    return list;
  }

  /* ---------- 校验（只 warn，不抛） ---------- */
  function validate() {
    const list = (C.drop && C.drop.quests) || [];
    const warn = msg => console.warn('[quest-config] ' + msg);
    const seen = {};
    list.forEach(q => {
      if (!q.id) return warn('存在没有 id 的任务：' + JSON.stringify(q).slice(0, 80));
      if (seen[q.id]) warn('任务 id 重复：' + q.id);
      seen[q.id] = true;
      if (KIND_META.every(k => k.id !== q.kind)) warn(q.id + ' 的 kind 非法：' + q.kind);

      if (q.kind === 'series') {
        const idx = chapterIndexOf(q);
        const a = areas()[idx - 1];
        if (!a) return warn(q.id + ' 找不到所属章节（编号 ' + idx + '）');
        // 章节与解锁等级必须对得上，否则玩家会在错误的阶段看到这一章
        const lv = Number(q.unlockLevel) || 1;
        const lo = a.levelRange ? a.levelRange[0] : 0;
        if (lv < lo || lv > lo + 2) {
          warn(q.id + ' 解锁等级 ' + lv + ' 与第 ' + idx + ' 章「' + a.name + '」(Lv' + lo + ') 不匹配');
        }
      }
      if (q.kind === 'daily' && !q.repeat) warn(q.id + ' 是日常却没有 repeat 标记');
      if (q.kind === 'weekly' && q.reset !== 'weekly') warn(q.id + ' 是周常却没有 reset:"weekly"（额度会失效）');
      if (q.kind === 'loop' && q.repeat) warn(q.id + ' 同时带 repeat 与 repeatable，语义冲突');
      // 兑换的灵魂是「硬上限」：没有重置周期就等于无限刷，会直接取代地图与试炼
      if (q.kind === 'exchange' && q.reset === 'none') warn(q.id + ' 是兑换任务却没有 reset（会变成无限刷）');
      if (q.kind === 'exchange' && q.repeatable) warn(q.id + ' 是兑换任务但同时标了 repeatable（会绕过每日/每周上限）');
    });
    return true;
  }

  /* ---------- 对外 API ---------- */
  window.QuestConfig = {
    KIND_META, KIND_LABEL, FAMILY,
    kindOf, familyOf, chapterIndexOf, groupOf,
    list: () => (C.drop && C.drop.quests) || []
  };

  normalize();
  validate();
})();
