/* ============================================================
 * core/tutorial_mode.js —— 新手引导驱动（任务系统形态）
 * 2026-09-02 改版（用户拍板：引导 = 任务系统，不要弹窗/高亮/HUD）：
 *   - 引导载体 = 新手链任务（config.drop.quests 里 category='tutorial'）+ 顶部引导条
 *   - 引导段 = isGuide 标记的任务（t1~t10，到涅槃为止）；t13 魂铸已转主线（2026-09-02 拍板）
 *   - 引导段进行中：自动进入「加速模式」（经验×6 / 战斗提速 / 掉率提升 / 合成20·涅槃30）
 *   - 每进入一个新引导任务：自动发该任务的教学补给（grants，防卡手）
 *   - 引导段全部完成：退出加速 + 发新手礼包（绑定账号，仅一次）
 * 职责：
 *  1. enter()/exit()：临时覆盖/还原 Config 加速数值（只改配置，不动玩法逻辑）
 *  2. bindUser()：状态按账号隔离（换号/注册新号各自独立，防止旧号状态污染）
 *  3. hasClaimedPack()/markClaimedPack()：新手礼包已领标记（按账号，防重复领）
 *  4. checkGuide()：引导驱动核心 —— 检测当前引导任务 → 进加速 + 发补给；完成 → 退加速 + 发礼包
 *  5. grantStarterPack()：新手礼包发放（全部绑定，不可交易/上架/赠送）
 * ============================================================ */
(function () {
  'use strict';
  const Config = window.Config;

  let active = false;
  const saved = {};   // 被覆盖的正式值，exit 时还原

  /* ---------- 读取教程配置（容错：配置段缺失时用安全默认，不崩） ---------- */
  const TM = () => Config.tutorialMode || {};

  /* ---------- 账号隔离：state key 按邮箱区分 ----------
   * 早期用固定 key：主号点过"跳过"后，注册新小号 → 读到旧 asked=true → 新号没引导。
   * 现在 setAuthUser 调 bindUser(email) 切换 key，换号各自独立。 */
  let userKey = '';
  function bindUser(email) {
    userKey = email ? String(email).replace(/[^a-zA-Z0-9@._-]/g, '') : '';
  }

  /* ---------- 一次性标记统一读写：云端唯一真相，本地只做加速缓存 ----------
   * 血泪（2026-09-03）：引导补给/礼包/祝福的"已发"标记之前只写 localStorage，
   * 清缓存/换设备就丢 → checkGuide 每次登录都重发教学副宠，云端一路 INSERT 出 N 只同款。
   * 第一原则：发过什么必须记在云端（quest_progress.extra），localStorage 丢了能自愈，
   * 且经济相关标记一律「先落云端，再发放」（宁可少拿一次，不可重复领）。 */
  const packKey = () => 'fos_pack_claimed'+ (userKey ? '_'+ userKey : '');
  const startedKey = () => 'fos_tutorial_started'+ (userKey ? '_'+ userKey : '');

  const qx = () => (window.Quest && window.Quest.getExtra && window.Quest.setExtra) ? window.Quest : null;
  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* 忽略 */ } }
  /* 标记读取：云端优先（2026-09-08 纠正）。
   * 原实现本地优先，注释却写"云端唯一真相"——实际云端只是"本地丢了才查的备份"。
   * 现在反过来：云端已加载且查到值 → 以云端为准（顺手回写本地缓存）；
   * 云端没查到 / 还没加载 → 退回本地兜底（本地可能刚写完还没落盘）。
   * 注意：云端没有 ≠ 标记没发过（云端写可能失败），真正的防重复由 grantOnce 账本把守，
   * readFlag 只负责"已领/已跳过/已开始"这类体验型标记的正确读取。 */
  function readFlag(key, cloudKey) {
    const q = qx();
    if (q && window.Quest && window.Quest.isCloudLoaded && window.Quest.isCloudLoaded()) {
      try {
        const v = q.getExtra(cloudKey);
        if (v != null) {
          const s = String(v);
          try { if (lsGet(key) !== s) lsSet(key, s); } catch (e) { /* 忽略 */ }
          return s;
        }
      } catch (e) { /* 云端读取异常 → 落到本地兜底 */ }
    }
    const local = lsGet(key);
    return local != null && local !== '' ? local : null;
  }
  function writeFlag(key, cloudKey, val) {
    lsSet(key, val);
    const q = qx();
    return q ? q.setExtra(cloudKey, val) : Promise.resolve();
  }

  // 2026-09-02 Q6 修复：老账号白拿礼包 —— 只有真正走过引导的账号才发礼包。
  // started 标记在进入第一个引导任务时打（本地 + 云端双写，云端防换设备/清缓存丢失）。
  function readStarted() {
    try { return readFlag(startedKey(), 'tutorialStarted') === '1'; } catch (e) { return false; }
  }
  function markStarted() {
    try { writeFlag(startedKey(), 'tutorialStarted', '1'); } catch (e) { /* 忽略 */ }
  }

  /* ---------- 进入 / 退出加速模式 ---------- */
  function enter() {
    if (active) return true;
    const t = TM();
    if (!t || t.enabled === false) return false;
    saved.expRate = Config.exp.rate;
    saved.speedScale = Config.battle.speedScale;
    saved.dropPool = Config.drop.pool;
    saved.synMin = Config.synthesize.minLevel;
    saved.nirMin = Config.nirvana.minLevel;

    Config.exp.rate = Number(t.expRate) || 1;
    Config.battle.speedScale = Math.max(1, (Config.battle.speedScale || 12) / (Number(t.fightSpeedMult) || 1));
    if (t.dropPool) Config.drop.pool = Object.assign({}, t.dropPool);
    if (t.levelGate) {
      if (t.levelGate.synthesize) Config.synthesize.minLevel = t.levelGate.synthesize;
      if (t.levelGate.nirvana) Config.nirvana.minLevel = t.levelGate.nirvana;
    }
    active = true;
    return true;
  }
  function exit() {
    if (saved.expRate != null) Config.exp.rate = saved.expRate;
    if (saved.speedScale != null) Config.battle.speedScale = saved.speedScale;
    if (saved.dropPool != null) Config.drop.pool = saved.dropPool;
    if (saved.synMin != null) Config.synthesize.minLevel = saved.synMin;
    if (saved.nirMin != null) Config.nirvana.minLevel = saved.nirMin;
    active = false;
    return true;
  }
  const isActive = () => active;

  /* ---------- 新手礼包已领标记（按账号，云端唯一真相） ---------- */
  function hasClaimedPack() {
    try { return readFlag(packKey(), 'packClaimed') === '1'; } catch (e) { return false; }
  }
  function markClaimedPack() {
    try { return writeFlag(packKey(), 'packClaimed', '1'); } catch (e) { return Promise.resolve(); }
  }

  /* ============================================================
   * 发放账本（2026-09-08 根治"重登重复领取"）
   * 血泪：以前"发没发过"靠库存差量反推（玩家消耗钥匙即误判）或靠
   * localStorage 标记（清缓存即丢、云端写失败被吞）。现在统一记账：
   *   存 quest_progress.extra.grantLedger = { [keyId]: { count, at } }
   *   （复用 extra 通道，不加表不加列）
   * grantOnce 三步：① 查账本（有记录 → 拒）② 记账（strict 落云端，
   * 失败 → 不发货）③ 发货（不回滚：货可能已部分到手，回滚=可再领）。
   * 失败语义与项目铁律一致：宁可少拿，不可重发。
   * ============================================================ */
  const granting = new Set();   // keyId 级防重入（并发第二道闸）
  function ledgerOf() {
    const q = qx(); if (!q) return {};
    const v = q.getExtra('grantLedger');
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  }
  // 记一条账（count+1）。必须 strict：账没落盘成功就抛错，调用方不发货。
  async function ledgerRecord(keyId) {
    const Q = window.Quest;
    const q = qx();
    if (!q || !Q || !Q.saveProgressStrict) throw new Error('云端进度通道不可用，不能记账');
    const ledger = ledgerOf();
    ledger[keyId] = { count: ((ledger[keyId] && ledger[keyId].count) || 0) + 1, at: Date.now() };
    // 先进内存（extra），再 strict 落盘；落盘失败 → 抛错（内存里的记录会在下次
    // 同会话查重时挡住重发，跨会话以云端为准可自愈）
    q.setExtra('grantLedger', ledger);
    await Q.saveProgressStrict();
  }
  // 老档兼容：旧标记体系（packClaimed/blessingGiven）发过的东西补进账本，防账本缺失导致重发
  async function ledgerBackfill(keyId) {
    if (ledgerOf()[keyId]) return;
    try { await ledgerRecord(keyId); } catch (e) { console.warn('[guide] 账本补记失败', keyId, e); }
  }
  // 统一发放入口。opts.max：同一 keyId 允许发放的总次数（补发钥匙用，默认 1）
  async function grantOnce(keyId, grantFn, opts) {
    if (!keyId || typeof grantFn !== 'function') return { ok: false, error: '参数缺失' };
    if (granting.has(keyId)) return { ok: false, error: '该发放正在进行中，请稍候' };
    const max = Math.max(1, Number(opts && opts.max) || 1);
    const rec = ledgerOf()[keyId];
    if (rec && (rec.count || 0) >= max) return { ok: false, error: '已发放过（账本记录）' };
    granting.add(keyId);
    try {
      await ledgerRecord(keyId);   // 记账先行：失败抛错 → 不发货
      await grantFn();
      return { ok: true };
    } catch (e) {
      console.warn('[guide] 发放被拦', keyId, e);
      return { ok: false, error: (e && e.message) || '发放失败' };
    } finally {
      granting.delete(keyId);
    }
  }

  /* ---------- 当前该做的引导任务 ----------
   * 新手链里第一个「未完成 && isGuide」的任务（引导段 t1~t10）。
   * t13 魂铸已转主线（2026-09-02 拍板：只教到涅槃），不参与加速引导。 */
  function currentGuideTask() {
    const quests = Config.drop && Config.drop.quests ? Config.drop.quests : [];
    for (const q of quests) {
      if (q.category !== 'tutorial'|| !q.isGuide) continue;
      if (window.Quest && window.Quest.isFinished ? window.Quest.isFinished(q) : false) continue;
      // 未完成且已解锁 → 当前引导任务
      if (window.Quest && window.Quest.isUnlocked ? window.Quest.isUnlocked(q) : true) return q;
    }
    return null;
  }

  /* ---------- 加速道具「引导祝福」（2026-09-02 用户拍板：加速=绑定道具，用掉才生效） ----------
   * 规则：
   *  - 开局（选宠进入引导时）送 1 个（grantInitialBlessing，账号幂等）
   *  - 玩家使用（useBlessing）→ 扣 1 个 → 记录起始时间 → 进加速，持续 durationMin 分钟
   *  - 到期（buffExpired）自动 exit 恢复正式节奏
   *  - 绑定：不进 market.js 白名单 → 不可上架交易
   * 时长：主用 Config.tutorialMode.blessing.durationMin，兼容旧 buffDurationMin；0 = 不限时。 */
  const buffKey = () => 'fos_buff_start'+ (userKey ? '_'+ userKey : '');
  const blessingGivenKey = () => 'fos_blessing_given'+ (userKey ? '_'+ userKey : '');
  const blessingName = () => (TM().blessing && TM().blessing.name) || '引导祝福';
  const blessingDurationMin = () => {
    const b = TM().blessing;
    const d = Number(b && b.durationMin) || Number(TM().buffDurationMin) || 0;
    return d;
  };
  function readBuffStart() {
    try { return Number(localStorage.getItem(buffKey())) || 0; } catch (e) { return 0; }
  }
  function writeBuffStart() {
    try { localStorage.setItem(buffKey(), String(Date.now())); } catch (e) { /* 忽略 */ }
  }
  function buffExpired() {
    const min = blessingDurationMin();
    if (!min) return false; // 0 = 不限时
    const start = readBuffStart();
    if (!start) return false;
    return (Date.now() - start) >= min * 60 * 1000;
  }
  // buff 是否生效中（有起始时间且未超时）
  function blessingActive() {
    const start = readBuffStart();
    if (!start) return false;
    return !buffExpired();
  }
  // 剩余秒数（按钮显示"剩余约 N 分钟"用）；未激活返回 0
  function blessingRemainSec() {
    const min = blessingDurationMin();
    const start = readBuffStart();
    if (!min || !start) return 0;
    const remain = min * 60 - Math.floor((Date.now() - start) / 1000);
    return Math.max(0, remain);
  }
  // 手上是否还有引导祝福道具
  function hasBlessing() {
    const M = window.Materials;
    return !!(M && M.getQuantity && M.getQuantity(blessingName()) > 0);
  }
  // 使用引导祝福：扣道具 → 记录起始 → 进加速（30 分钟）
  async function useBlessing() {
    const M = window.Materials;
    if (!M || !M.spend) return { ok: false, error: '材料系统未就绪'};
    if (blessingActive()) return { ok: false, error: '加速已生效中，别浪费'};
    if (M.getQuantity(blessingName()) <= 0) return { ok: false, error: '没有引导祝福（开局会自动送 1 个）'};
    const spent = await M.spend(blessingName(), 1);
    if (!spent.ok) return { ok: false, error: spent.error || '使用失败'};
    writeBuffStart();
    enter();
    if (window.UI && window.UI.addLog) window.UI.addLog(`使用「${blessingName()}」：加速已生效（${blessingDurationMin()} 分钟，经验×${TM().expRate || 6}）`);
    return { ok: true };
  }
  // 开局发 1 个引导祝福（账号幂等，走发放账本）+ 明确提示用途与绑定属性
  async function grantInitialBlessing() {
    if (TM().disableBlessing) return { ok: false, skipped: true };
    const M = window.Materials;
    if (!M || !M.gain) return;
    // 老档兼容：旧 blessingGiven 标记发过的 → 只补账不发货，防账本缺失导致重送
    try { if (readFlag(blessingGivenKey(), 'blessingGiven') === '1') { await ledgerBackfill('blessing'); return; } } catch (e) { /* 忽略 */ }
    await grantOnce('blessing', async () => {
      await M.gain(blessingName(), 1);
      if (M.flushMaterials) await M.flushMaterials();
      if (window.UI && window.UI.addLog) {
        window.UI.addLog(`获得绑定道具「${blessingName()}」×1：使用后 ${blessingDurationMin()} 分钟加速（经验×${TM().expRate || 6}）。不可交易/上架。`);
      }
    });
  }

  /* ============================================================
   * 引导钥匙表（2026-09-08 v2「奖励即钥匙」，替代 v1 开局整箱补给箱）
   * v0（已删）：任务激活时按库存差量补钥匙 → 玩家消耗即误判"没发过" → 无限刷。
   * v1：进入第一个引导关时整箱发 → 不刷了，但玩家背包一上来就躺满，
   *     感知不到"这是上一关给的"，奖励与下一关的因果链是断的。
   * v2：钥匙按关发放（grantKeysFor），该关激活的那一刻（= 上一关完成瞬间）到手。
   *   - 防刷：账本 keys:{taskId}，每关只发一次；花掉不补。
   *   - 自愈：钥匙弄丢卡关 → 引导条「补发」按钮（reissueKeys），每关每种限 1 次。
   *   - 白装不能绑定（G8 教学任务本身要求上架装备），防刷靠账本不靠绑定。
   * ============================================================ */
  function boxItems() { return (TM().supplyBox && TM().supplyBox.items) || []; }
  // 每把钥匙的唯一 key（补发账本 keyId 用）
  function itemKeyOf(it) {
    if (it.type === 'exppack') return 'exppack:cap' + (it.cap || 0);
    return it.type + ':' + (it.name || it.baseName || '') + (it.rarity ? ':' + it.rarity : '');
  }
  // 该钥匙当前持有量（与发放口径一致：背包=未穿戴；素材宠=全宠数量）
  function haveOf(it) {
    const E = window.Equipment, D = window.Drop, Pet = window.Pet, M = window.Materials;
    if (it.type === 'mat') return (M && M.getQuantity) ? (M.getQuantity(it.name) || 0) : 0;
    if (it.type === 'exppack') {
      const pk = expPackFor(it.cap);
      return (pk && M && M.getQuantity) ? (M.getQuantity(pk.name) || 0) : 0;
    }
    if (it.type === 'gear') {
      if (!E || !E.getInventory) return 0;
      const rid = it.rarity || 'white';
      return (E.getInventory() || []).filter(eq => eq && eq.rarity && eq.rarity.id === rid && (!it.baseName || eq.tutorialBase === it.baseName)).length;
    }
    if (it.type === 'egg') return (D && D.getEggCountOf) ? (D.getEggCountOf(it.baseName || '腐噜兽') || 0) : 0;
    if (it.type === 'fodder') return (Pet && Pet.getPets) ? (Pet.getPets() || []).length : 0;
    return 0;
  }
  function needOf(it) {
    if (it.type === 'gear') return Math.max(1, Number(it.count) || 1);
    if (it.type === 'fodder') return Math.max(1, Number(it.min) || 1);
    return Math.max(1, Number(it.qty) || 1);
  }
  // 只读：这一关的钥匙清单（UI 展示"完成上一关会拿到什么"用，不发任何东西）
  function keyItemsFor(taskId) {
    if (!taskId) return [];
    return boxItems().filter(it => it.taskIds && it.taskIds.indexOf(taskId) >= 0);
  }
  // 只读检测：这一关还缺哪些钥匙（引导条显示用，不发任何东西）
  function missingKeysFor(taskId) {
    if (!taskId) return [];
    return boxItems()
      .filter(it => !it.taskIds || it.taskIds.indexOf(taskId) >= 0)
      .map(it => ({ it, key: itemKeyOf(it), need: needOf(it), have: haveOf(it) }))
      .filter(x => x.have < x.need)
      .map(x => ({ key: x.key, type: x.it.type, name: x.it.name || x.it.baseName, need: x.need, have: x.have, item: x.it }));
  }
  // 按缺口发一把钥匙（amount = 要发的数量）。云端存档失败只提示不回滚（同任务奖励口径）。
  async function grantBoxItem(it, amount) {
    const E = window.Equipment, D = window.Drop, I = window.Items, M = window.Materials;
    const n = Math.max(0, Number(amount) || 0);
    if (n <= 0) return [];
    const got = [];
    if (it.type === 'mat') {
      if (M && M.gain) { await M.gain(it.name, n); got.push(it.name + '×' + n); }
    } else if (it.type === 'gear') {
      if (!E || !E.generateEquipment || !E.addToInventory) return got;
      const rarity = (Config.equipment.rarities || []).find(r => r.id === (it.rarity || 'white')) || (Config.equipment.rarities || [])[0];
      for (let i = 0; i < n; i++) {
        const eq = E.generateEquipment(rarity, it.areaTier || 1, it.materialTier || 1);
        eq.identified = it.identified === false ? false : true;
        if (it.baseName) eq.tutorialBase = it.baseName;
        if (it.tutorialSlot && eq.slot !== it.tutorialSlot) {
          eq.slot = it.tutorialSlot;
          eq.name = it.baseName || eq.name;
        }
        E.addToInventory(eq);
        got.push(((eq.rarity && eq.rarity.label) || '') + '装备「' + eq.name + '」');
        if (I && I.saveItem) { const r = await I.saveItem(eq); if (r && r.error) console.warn('[guide] 补给装备云端存档失败', r.error); }
      }
    } else if (it.type === 'egg') {
      if (D && D.grantEgg) { for (let i = 0; i < n; i++) await D.grantEgg(it.baseName || '腐噜兽', 1); got.push((it.baseName || '腐噜兽') + '蛋×' + n); }
    } else if (it.type === 'fodder') {
      for (let i = 0; i < n; i++) { await grantFodderPet(it.baseName || '腐噜兽'); got.push('素材宠「' + (it.baseName || '腐噜兽') + '」'); }
    } else if (it.type === 'exppack') {
      const pk = expPackFor(it.cap);
      if (pk) { for (let i = 0; i < n; i++) await grantExpPack(pk); got.push(pk.name + '×' + n); }
    }
    return got;
  }
  /* 按关发放钥匙（2026-09-08 v2：奖励即钥匙，替代 v1 的开局整箱）
   * 时机：该关成为"当前引导关"的那一刻 —— completeQuest 后会 fire-and-forget 触发
   *       checkGuide，此时 getGuideQuest 已切到下一关 → 钥匙正好在"上一关完成的瞬间"到手，
   *       玩家的因果感就是「做完了 → 拿到下一样要用的东西」。
   * 防刷：账本 keys:{taskId}，每关只发一次；花掉不补（补发走 reissueKeys，每关每种限 1 次）。
   * 老档：v1 已整箱发过的账号 → keys:* 全部补账，不会二次到手。 */
  async function grantKeysFor(taskId) {
    if (!taskId) return [];
    const items = boxItems().filter(it => it.taskIds && it.taskIds.indexOf(taskId) >= 0);
    if (!items.length) return [];
    let added = [];
    await grantOnce('keys:' + taskId, async () => {
      for (const it of items) {
        try {
          const add = Math.max(0, needOf(it) - haveOf(it));
          if (add <= 0) continue;
          const got = await grantBoxItem(it, add);
          added.push.apply(added, got);
        } catch (e) { console.warn('[guide] 钥匙发放失败', taskId, it, e); }
      }
      const M = window.Materials;
      if (M && M.flushMaterials) { try { await M.flushMaterials(); } catch (e) { /* 忽略 */ } }
    });
    if (added.length) {
      if (window.UI && window.UI.addLog) window.UI.addLog(`获得引导奖励：${added.join('、')}（下一关要用）`);
      if (window.UI && window.UI.showToast) {
        try { window.UI.showToast('任务奖励', added.join('、') + ' —— 下一关要用'); } catch (e) { /* 忽略 */ }
      }
    }
    if (window.UI && window.UI.renderAll) { try { window.UI.renderAll(); } catch (e) { /* 忽略 */ } }
    return added;
  }
  // 手动补发（引导条「补发」按钮）：只给当前引导关补缺的钥匙，每关每种限 1 次（账本）
  async function reissueKeys(taskId) {
    const cur = (window.Quest && window.Quest.getGuideQuest) ? window.Quest.getGuideQuest() : null;
    if (!cur || cur.id !== taskId) return { ok: false, error: '只能为当前引导关补发钥匙' };
    const missing = missingKeysFor(taskId);
    if (!missing.length) return { ok: true, skipped: true };
    const granted = [], blocked = [];
    for (const m of missing) {
      const r = await grantOnce('reissue:' + taskId + ':' + m.key, async () => {
        const got = await grantBoxItem(m.item, Math.max(1, m.need - m.have));
        const M = window.Materials;
        if (M && M.flushMaterials) { try { await M.flushMaterials(); } catch (e) { /* 忽略 */ } }
        if (got.length && window.UI && window.UI.addLog) window.UI.addLog(`补发钥匙（${taskId}）：${got.join('、')}`);
      }, { max: 1 });
      if (r.ok) granted.push(m.name || m.key);
      else if (!/已发放过/.test(r.error || '')) blocked.push((m.name || m.key) + '：' + r.error);
    }
    if (window.UI && window.UI.renderAll) { try { window.UI.renderAll(); } catch (e) { /* 忽略 */ } }
    return { ok: granted.length > 0, granted, blocked };
  }

  function rarityLabel(r) {
    const rr = (Config.equipment.rarities || []).find(x => x.id === r);
    return rr ? rr.label : (r || '');
  }

  // 素材池差量补宠：不发明新物种，直接用已有基础宠补足数量（G7 合成 / G9 涅槃需要"够用的材料宠"）
  async function grantFodderPet(baseName) {
    const Pet = window.Pet;
    if (!Pet || !Pet.createPet) return;
    const base = (Config.pet.starters || []).find(s => s.name === baseName);
    const B = Config.pet.legacyBase || {};
    const pet = Pet.createPet(baseName, (base && base.icon) || '', 5,
      (base && base.baseHp) || B.hp || 100, (base && base.baseAtk) || B.atk || 20,
      (base && base.baseDef) || B.def || 10, (Config.pet.speeds && Config.pet.speeds[baseName]) || B.spd || 40, baseName);
    pet.level = 1;
    if (Pet.rollPetTraits) Pet.rollPetTraits(pet, {});
    Pet.addPet(pet);
    const supabase = window.Supabase;
    if (supabase && supabase.savePet) {
      try {
        const { data, error } = await supabase.savePet(pet);
        if (!error && data && data.id) pet.cloudId = data.id;
      } catch (e) { console.warn('[guide] 素材宠云端建档异常', e); }
    }
  }

  /* ---------- 引导经验包：把【所有】宠物顶到目标等级 ----------
   * 2026-09-03 用户拍板「教学期间所有等级门槛都给经验包」，第一版只升出战宠，漏掉关键：
   *   - G7 合成要求「两只素材宠都 Lv40」
   *   - G9 涅槃要求「主宠+副宠都 Lv60」
   * 只顶出战宠 → 另一只不够 → 玩家卡在融合/涅槃，看起来"经验包没发"。
   * 现在语义：经验包不是发给"一只宠"，而是发给"这一关要用的所有宠"——把名下宠物全部
   * 顶到门槛等级，保证无论选哪两只配对都能过。
   * 幂等：达标即跳过；只在教学链进行中调用，不会污染正常养成。
   * 持久化：本地即时生效 + 逐只同步云端（失败只提示不回滚）。
   * ⚠️ 血泪（2026-09-08 根因修复）：这里原来调 savePet——它是无条件 INSERT（建档语义），
   * 结果每用一次经验包，名下每只宠都被再插一行，刷新后 loadPets 全量拉回 =
   * 「莫名多出一堆重复宠」。顶等级是"更新已有宠"，必须走 updatePet；无 cloudId 才建档。 */
  async function boostGuidePetToLevel(target) {
    /* ⚠️ 托管挂机中顶等级：先把挂机的账结清再顶（顶完自动重新挂上，2026-09-13）。
     * 为什么：托管期间本地 level/exp 是**演出预演值**（云端真账领先本地最多一个窗口），
     * 而这里正是"按本地等级判断要不要顶 + 把 level/exp 写回云端"——预演值一掺进来，
     * 要么把云端真账改小（经验倒退），要么顶完被下一次真账校准回去（等级乱跳）。
     * 结清真账后本地 = 服务器那一份，写的才是"该写的那一份"。
     * IdleBridge 不在（测试桩）/ 没在挂机 → 直接执行，零影响。 */
    const IB = window.IdleBridge;
    return (IB && IB.duringPetEdit)
      ? IB.duringPetEdit(() => boostGuidePetToLevelInner(target))
      : boostGuidePetToLevelInner(target);
  }
  async function boostGuidePetToLevelInner(target) {
    const lv = Number(target) || 0;
    if (!lv) return { ok: false, error: '目标等级为空' };
    const Pet = window.Pet;
    const list = (Pet && Pet.getPets) ? Pet.getPets() : [];
    if (!list.length) {
      console.warn('[guide] 引导经验包未生效：没有宠物');
      return { ok: false, error: '没有宠物' };
    }
    const Supabase = window.Supabase;
    const needName = [];
    let boosted = 0;
    for (const pet of list) {
      if (!pet) continue;
      const cur = Number(pet.level) || 1;
      if (cur >= lv) continue;
      pet.level = lv;
      if ('exp' in pet) pet.exp = 0;   // 顶完不残留旧经验，避免到门槛就立刻再升一级
      needName.push(pet.name || '魂兽');
      boosted++;
      if (Supabase) {
        try {
          if (pet.cloudId) {
            // 已建档：更新等级/经验（绝不 INSERT——savePet 是建档，会复制出重复宠）
            await Supabase.updatePet(pet.cloudId, { level: pet.level, exp: 0 });
          } else if (Supabase.savePet) {
            const r = await Supabase.savePet(pet);
            if (!r.error && r.data && r.data.id) pet.cloudId = r.data.id;
          }
        } catch (e) {
          console.warn('[guide] 引导经验包等级云端存档失败', e);
          // 2026-09-11：这条失败绝不能再静默 —— 本地已顶到目标等级、UI 也弹了"生效"，
          // 但云端没写进去。玩家一刷新等级回退，而账本已记账（不能再领一次），等于凭空丢了。
          // 至少要如实告诉玩家，让他知道要重新登录而不是以为游戏坏了。
          if (window.UI && window.UI.addLog) {
            window.UI.addLog('⚠️ 引导等级云端存档失败，刷新后可能回退（重新登录可再试）');
          }
        }
      }
    }
    if (!boosted) {
      console.warn(`[guide] 引导经验包跳过：名下宠物均已 ≥ Lv${lv}`);
      return { ok: true, skipped: true, level: lv };
    }
    if (window.UI && window.UI.renderAll) {
      try { window.UI.renderAll(); } catch (e) { /* 忽略渲染异常 */ }
    }
    const names = needName.slice(0, 3).join('、') + (needName.length > 3 ? ` 等 ${needName.length} 只` : '');
    if (window.UI && window.UI.addLog) {
      window.UI.addLog(`引导经验包生效：${names} 全部升至 Lv${lv}（教学期等级门槛，无需刷怪）`);
    }
    // 强反馈：浮层 toast，让玩家一眼看到「经验包确实发了」
    if (window.UI && window.UI.showToast) {
      try { window.UI.showToast('引导经验包生效', `${names} 直升 Lv${lv}（教学期门槛，无需刷怪）`); } catch (e) { /* 忽略 */ }
    }
    return { ok: true, level: lv };
  }

  /* ---------- 分档经验包（2026-09-08）：真实道具版 ----------
   * expPackFor(cap)：按等级门槛找对应档位配置。
   * grantExpPack(pack)：发货（Materials.gain + 提示），由 grantOnce 账本守门调用。
   * useExpPack(name)：通用使用入口（背包点卡片）——教学三档走 cap 锁死（全宠顶到 cap，
   *   不超）；未来非绑定经验包可扩展 exp 字段（给定宠加经验），走同一入口零新增机制。 */
  function expPackFor(boostLevel) {
    const lv = Number(boostLevel) || 0;
    if (!lv) return null;
    return ((TM().expPacks) || []).find(p => Number(p.cap) === lv) || null;
  }
  async function grantExpPack(pack) {
    const M = window.Materials;
    if (!M || !M.gain) return;
    await M.gain(pack.name, 1);
    if (M.flushMaterials) { try { await M.flushMaterials(); } catch (e) { /* 忽略 */ } }
    if (window.UI && window.UI.addLog) window.UI.addLog(`获得「${pack.name}」×1（绑定）：去背包·消耗品使用，魂兽直升 Lv${pack.cap}`);
    if (window.UI && window.UI.showToast) {
      try { window.UI.showToast('经验包已发放', `${pack.name} ×1 —— 背包 · 消耗品里点击使用（直升 Lv${pack.cap}）`); } catch (e) { /* 忽略 */ }
    }
  }
  async function useExpPack(name) {
    const M = window.Materials;
    if (!M || !M.spend) return { ok: false, error: '材料系统未就绪' };
    const pack = ((TM().expPacks) || []).find(p => p.name === name);
    if (!pack) return { ok: false, error: '未知经验包' };
    if ((M.getQuantity(name) || 0) <= 0) return { ok: false, error: '没有' + name };
    // 档位锁死的前置检查：全部已达标 → 用了也白用，省着
    const Pet = window.Pet;
    const pets = (Pet && Pet.getPets) ? (Pet.getPets() || []) : [];
    if (!pets.length) return { ok: false, error: '名下没有魂兽' };
    if (pets.every(p => (Number(p.level) || 1) >= pack.cap)) {
      return { ok: false, error: '名下魂兽都已 ≥ Lv' + pack.cap + '，别浪费' };
    }
    const spent = await M.spend(name, 1);
    if (!spent.ok) return { ok: false, error: spent.error || '使用失败' };
    const r = await boostGuidePetToLevel(pack.cap);
    if (window.UI && window.UI.renderAll) { try { window.UI.renderAll(); } catch (e) { /* 忽略 */ } }
    return { ok: true, level: pack.cap };
  }

  /* ---------- 引导驱动核心：登录后 / 定时调用 ----------
   * 1) 有未完成的引导任务 → 发教学补给 + 按任务 boostLevel 顶出战宠等级（引导经验包）
   * 2) 已激活的 buff 超时 → 自动退出（兜底；加速只由道具「引导祝福」触发）
   * 3) 引导段全部完成 → 退加速 + 发毕业礼包（仅一次，跳过的账号不发）
   * 外壳（2026-09-08）：门闩 + 并发单飞。真正的驱动逻辑在 checkGuideInner。
   * 门闩：云端任务进度没拉完 → 什么都不做。拿空状态判定"没发过"→ 发货 →
   * 云端随后覆盖内存，发放记录凭空丢失，下次登录再来一遍——重复领取的成因之一。
   * 单飞：completeQuest 后是 fire-and-forget 触发本函数，连点快交会并发跑
   * 同一段发放逻辑（读-改-写无原子性）。进行中直接跳过，结束后尾部补跑一次。 */
  let guiding = false;
  let guideQueued = false;
  async function checkGuide() {
    if (!TM().enabled) return;
    if (window.Quest && window.Quest.isCloudLoaded && !window.Quest.isCloudLoaded()) return;
    if (guiding) { guideQueued = true; return; }
    guiding = true;
    try {
      await checkGuideInner();
    } catch (e) {
      console.warn('[guide] 引导驱动异常', e);
    } finally {
      guiding = false;
      if (guideQueued) { guideQueued = false; Promise.resolve().then(() => checkGuide()).catch(() => {}); }
    }
  }
  async function checkGuideInner() {
    // 未登录不驱动（绑定账号状态 / 发礼包都要账号）
    const user = window.UI && window.UI.getAuthUser ? window.UI.getAuthUser() : null;
    if (!user) return;

    // 「引导条显示的当前关」才是玩家真正在做的那一关（Quest.getGuideQuest 与 UI 同源）。
    // 血泪：内部 currentGuideTask 曾与 UI 判定不一致 → 补给打偏（玩家在 g6 孵化，补给却发给了另一关）。
    const shown = (window.Quest && window.Quest.getGuideQuest) ? window.Quest.getGuideQuest() : null;
    const internal = currentGuideTask();
    if (shown && internal && shown.id !== internal.id) {
      console.warn('[guide] 引导条显示与内部判定不一致，以引导条为准:', internal.id, '→', shown.id);
    }
    const task = shown || internal;
    if (task) {
      // 进入引导 → 打「引导已开始」标记（Q6：老账号链已完成、没真正走过引导 → 不发礼包）
      if (!readStarted()) markStarted();
      // 老档兼容：v1「开局整箱补给箱」已发过的账号 → keys:* 全部补账，v2 不再发第二遍
      if (ledgerOf().supplyBox && !ledgerOf()['keys:g1']) {
        for (const gq of ((Config.drop && Config.drop.quests) || [])) {
          if (gq.category === 'tutorial') await ledgerBackfill('keys:' + gq.id);
        }
      }
      // buff 已激活且超时 → 自动关（玩家用完 30 分钟恢复正式节奏）
      if (active && buffExpired()) exit();
      /* 奖励即钥匙（2026-09-08 v2）：本关的钥匙在这一刻发放（账本 keys:{id} 守门，每关只发一次）。
       * 分档经验包已并入钥匙表（type:'exppack' 按 taskIds 走），不再按 boostLevel 单独发 ——
       * 两套并行会让同一档经验包到手两份。boostLevel 字段保留作等级门槛说明。 */
      await grantKeysFor(task.id);
      return;
    }
    // 引导段全完成
    if (active) exit();
    // 只有"真正走过引导"的账号才发礼包（Q6 修复：老账号自动完成新手链 → 不再白拿）
    if (readStarted() && !readSkipped()) {
      // G10 魂铸不是 isGuide（毕业后普通任务），getGuideQuest 永远不会指向它 →
      // 它的钥匙（凝魂晶石×10 = soulCast.materialCount）只能在引导段收尾时补发，否则必卡。
      await grantKeysFor('g10');
      // 老档兼容：旧 packClaimed 标记领过的 → 只补账不发货，防账本缺失导致重发
      if (hasClaimedPack()) { await ledgerBackfill('graduatePack'); return; }
      // 账本守门：graduatePack 记账成功才发货（strict 落盘失败 → 不发，宁可少拿）
      await grantOnce('graduatePack', grantStarterPack);
    }
  }

  /* ---------- buff 超时自动关定时器（1s，仅引导任务存在时跑，防止常驻空转） ---------- */
  let expireTimer = null;
  function startExpireTimer() {
    if (expireTimer) return;
    expireTimer = setInterval(() => {
      try {
        // 无引导任务（引导完成/跳过）→ 停定时器
        if (!currentGuideTask()) { stopExpireTimer(); return; }
        if (active && buffExpired()) { exit(); if (window.UI && window.UI.addLog) window.UI.addLog('⏱ 引导祝福加速已到期，恢复正式节奏'); }
      } catch (e) { /* 忽略 */ }
    }, 1000);
  }
  function stopExpireTimer() {
    if (expireTimer) { clearInterval(expireTimer); expireTimer = null; }
  }
  // 供 main.js 登录后启动定时器（与 checkGuide 配套）
  function startGuideRoutine() {
    startExpireTimer();
    return checkGuide();
  }

  const skipKey = () => 'fos_guide_skipped'+ (userKey ? '_'+ userKey : '');
  function readSkipped() { try { return readFlag(skipKey(), 'guideSkipped') === '1'; } catch (e) { return false; } }
  // 跳过引导：打账号标记（不发礼包，云端唯一真相）；由 ui-quest 的「跳过」按钮调用
  function markSkipped() { try { return writeFlag(skipKey(), 'guideSkipped', '1'); } catch (e) { return Promise.resolve(); } }

  /* ---------- 新手礼包（config.tutorialMode.starterPack，全部绑定） ---------- */
  async function grantStarterPack() {
    const t = TM();
    const pack = t.starterPack || {};
    const Pet = window.Pet, E = window.Equipment, I = window.Items, Materials = window.Materials;
    if (!Materials) return;
    /* N1-N6 引导把 starterPack 清空了（毕业礼包内容待定）。空包不能照样走完流程 ——
     * 玩家会看到「新手礼包已发放！打开背包查看」，结果背包什么都没有。空包直接不说话。 */
    const emptyPack = !(pack.expItems || []).length && !(pack.gear || []).length &&
      !(pack.mats || []).length && !pack.pet;
    if (emptyPack) return;
    // 经验包
    for (const ei of (pack.expItems || [])) await Materials.gain(ei.name, ei.qty || 1);
    // 装备三件套
    for (const g of (pack.gear || [])) {
      if (!E || !E.generateEquipment) continue;
      for (let i = 0; i < (g.count || 1); i++) {
        const rarity = (Config.equipment.rarities || []).find(r => r.id === (g.rarity || 'blue')) || (Config.equipment.rarities || [])[0];
        const eq = E.generateEquipment(rarity, g.areaTier || 1, g.materialTier || 3);
        eq.identified = true;
        E.addToInventory(eq);
        if (I && I.saveItem) await I.saveItem(eq);
      }
    }
    // 材料
    for (const m of (pack.mats || [])) await Materials.gain(m.name, m.qty || 1);
    // 高成长副宠（设为出战）
    if (pack.pet && Pet && Pet.createPet) {
      const base = (Config.pet.starters || []).find(s => s.name === pack.pet.baseName);
      const B = Config.pet.legacyBase || {};
      const pet = Pet.createPet(pack.pet.name, (base && base.icon) || '', pack.pet.growth || 8,
        (base && base.baseHp) || B.hp || 100, (base && base.baseAtk) || B.atk || 20,
        (base && base.baseDef) || B.def || 10, (Config.pet.speeds && Config.pet.speeds[pack.pet.baseName]) || B.spd || 40, pack.pet.baseName || '毒沼蛙');
      Pet.addPet(pet);
      if (Pet.setActive) Pet.setActive(pet.id);
      if (window.Supabase && window.Supabase.savePet) {
        const { data, error } = await window.Supabase.savePet(pet);
        if (!error && data && data.id) pet.cloudId = data.id;
      }
    }
    await Materials.flushMaterials && await Materials.flushMaterials();
    if (window.UI && window.UI.addLog) window.UI.addLog('新手礼包已发放！打开背包查看。');
    if (window.UI && window.UI.renderAll) window.UI.renderAll();
  }

  window.TutorialMode = {
    enter, exit, isActive, bindUser,
    hasClaimedPack, markClaimedPack, checkGuide, grantStarterPack, markSkipped,
    hasBlessing, useBlessing, blessingActive, blessingRemainSec, grantInitialBlessing,
    startGuideRoutine,
    boostGuidePetToLevel,  // 引导经验包：把出战宠顶到指定等级（教学期等级门槛专用）
    // 发放账本（2026-09-08）：经济类发放统一走这里；补发钥匙用 grantOnce(keyId, fn, {max})
    grantOnce, ledgerOf, ledgerBackfill,
    // 引导钥匙表（2026-09-08 v2 奖励即钥匙）：grantKeysFor 按关发放 + keyItemsFor/missingKeysFor 只读查询 + reissueKeys 手动补发（每关每种限1次）
    grantKeysFor, keyItemsFor, missingKeysFor, reissueKeys,
    // 分档经验包（2026-09-08）：useExpPack 是通用使用入口（背包消耗品点击调用）
    useExpPack, expPackFor
  };
})();
