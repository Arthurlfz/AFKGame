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
  function readFlag(key, cloudKey) {
    const local = lsGet(key);
    if (local != null) return local;
    const q = qx(); if (!q) return null;
    const v = q.getExtra(cloudKey);
    return v == null ? null : String(v);
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
  function guideAllDone() {
    const quests = Config.drop && Config.drop.quests ? Config.drop.quests : [];
    return quests.every(q => q.category !== 'tutorial'|| !q.isGuide ||
      (window.Quest && window.Quest.isFinished ? window.Quest.isFinished(q) : true));
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
  // 开局发 1 个引导祝福（账号幂等，云端唯一真相）+ 明确提示用途与绑定属性
  async function grantInitialBlessing() {
    const M = window.Materials;
    if (!M || !M.gain) return;
    try { if (readFlag(blessingGivenKey(), 'blessingGiven') === '1') return; } catch (e) { /* 忽略 */ }
    // 先落「已送」标记（本地+云端），再发货：清缓存/换设备也不会再送第二个
    try { await writeFlag(blessingGivenKey(), 'blessingGiven', '1'); } catch (e) { console.warn('[guide] 祝福标记云端落盘失败', e); }
    await M.gain(blessingName(), 1);
    if (M.flushMaterials) await M.flushMaterials();
    if (window.UI && window.UI.addLog) {
      window.UI.addLog(`获得绑定道具「${blessingName()}」×1：使用后 ${blessingDurationMin()} 分钟加速（经验×${TM().expRate || 6}）。不可交易/上架。`);
    }
  }

  /* ============================================================
   * 教学补给 = 「这一关的钥匙」按库存差量补齐（第一原则版）
   * 反模式（已废弃）：一次性标记发放 + 靠"上一关奖励喂下一关"。
   *   奖励会被玩家花掉/卖掉/穿在身上，链因此断；补发标记一丢又造成重复发放。
   * 现在：每个引导关在 config.tutorialMode.grants 声明它【自己】要用的钥匙，
   * checkGuide 在任务激活时调用 applyGrantsFor → 逐项对当前库存求差：
   *   - 材料：< 需求量 → 补到需求
   *   - 装备：背包未穿戴件数 < 需求量 → 补足
   *   - 蛋  ：该品种蛋数 < 需求量 → 补足
   *   - 宠物：缺同名 → 建一只
   * 幂等（不靠标记）：补齐后库存达标，再次调用什么都不发。
   * 自愈：奖励被花掉/历史账号卡链，重登触发一次 reconcile 即恢复，无需推倒重走。
   * ============================================================ */
  async function applyGrantsFor(taskId) {
    if (!taskId) return;
    // 安全闸：只允许给「当前正在做的引导关」补钥匙。
    // 反例：玩家开控制台调 applyGrantsFor('g9') 想提前刷涅槃材料 → 不是当前任务，拒绝。
    // 引导条显示的当前关（getGuideQuest）才是唯一合法任务。
    const cur = (window.Quest && window.Quest.getGuideQuest) ? window.Quest.getGuideQuest() : null;
    if (!cur || cur.id !== taskId) {
      console.warn('[guide] 已拒绝：非当前引导任务，不允许补发钥匙:', taskId);
      return;
    }
    const t = TM();
    const list = (t.grants || []).filter(g => g.taskId === taskId);
    if (!list.length) return;
    const E = window.Equipment, D = window.Drop, Pet = window.Pet, I = window.Items, M = window.Materials;
    const added = [];
    for (const g of list) {
      try {
        if (g.type === 'gear') {
          if (!E || !E.generateEquipment || !E.addToInventory) continue;
          const spec = g.spec || {};
          const need = Math.max(1, Number(spec.count) || 1);
          const have = (E.getInventory ? E.getInventory() : []).length; // 背包 = 未穿戴
          let add = need - have;
          if (add <= 0) continue;
          const rarity = (Config.equipment.rarities || []).find(r => r.id === (spec.rarity || 'white')) || (Config.equipment.rarities || [])[0];
          for (let i = 0; i < add; i++) {
            const eq = E.generateEquipment(rarity, spec.areaTier || 1, spec.materialTier || 1);
            eq.identified = spec.identified === false ? false : true;
            E.addToInventory(eq);
            added.push('装备×1');
            if (I && I.saveItem) { const r = await I.saveItem(eq); if (r && r.error) console.warn('[guide] 补给装备云端存档失败', r.error); }
          }
        } else if (g.type === 'mat' || g.type === 'mats') {
          const items = g.type === 'mat' ? [{ name: g.name, qty: g.qty || 1 }] : (g.list || []);
          for (const m of items) {
            const need = Math.max(1, Number(m.qty) || 1);
            const have = (M && M.getQuantity) ? M.getQuantity(m.name) : 0;
            const add = need - have;
            if (add <= 0) continue;
            await M.gain(m.name, add);
            added.push(m.name + '×' + add);
          }
        } else if (g.type === 'egg') {
          if (!D || !D.grantEgg) continue;
          const base = g.baseName || '腐噜兽';
          const need = Math.max(1, Number(g.qty) || 1);
          const have = D.getEggCountOf ? D.getEggCountOf(base) : 0;
          const add = need - have;
          for (let i = 0; i < add; i++) { await D.grantEgg(base, 1); added.push(base + '蛋×1'); }
        } else if (g.type === 'pet') {
          if (!Pet || !Pet.getPets || !Pet.createPet) continue;
          if (Pet.getPets().some(p => p && p.name === g.name)) continue;
          await grantPet(g); // 内部已做同名幂等 + 云端建档失败兜底
          added.push('宠物「' + g.name + '」');
        } else if (g.type === 'petCount') {
          // 素材池差量补宠：总数 < min → 补到 min（用真实基础宠，不发明新物种）
          if (!Pet || !Pet.getPets || !Pet.createPet) continue;
          const min = Math.max(1, Number(g.min) || 1);
          const add = min - Pet.getPets().length;
          const base = g.baseName || '腐噜兽';
          for (let i = 0; i < add; i++) { await grantFodderPet(base); added.push('素材宠「' + base + '」'); }
        }
      } catch (e) {
        console.warn('[guide] 教学补给失败', g, e);
      }
    }
    if (!added.length) {
      // 诊断：任务激活了、钥匙表也配了，却无事可补 —— 把“应该补 vs 实际有”打出来，方便定位
      console.warn('[guide] reconcile 无事可补（清单与当前库存）:', taskId, list.map(function (g) {
        if (g.type === 'egg') {
          return { type: 'egg', base: g.baseName, need: g.qty, have: (D && D.getEggCountOf) ? D.getEggCountOf(g.baseName || '腐噜兽') : '?', eggMap: (D && D.getEggs) ? D.getEggs() : null };
        }
        if (g.type === 'gear') {
          return { type: 'gear', need: (g.spec && g.spec.count) || 1, haveBag: (E && E.getInventory) ? E.getInventory().length : '?' };
        }
        if (g.type === 'pet') {
          return { type: 'pet', name: g.name, have: (Pet && Pet.getPets) ? Pet.getPets().some(p => p && p.name === g.name) : '?' };
        }
        const items = g.type === 'mat' ? [{ name: g.name, qty: g.qty }] : (g.list || []);
        return { type: g.type, mats: items.map(m => ({ name: m.name, need: m.qty, have: (M && M.getQuantity) ? M.getQuantity(m.name) : '?' })) };
      }));
      return;
    }
    if (M && M.flushMaterials) { try { await M.flushMaterials(); } catch (e) { /* 忽略 */ } }
    if (window.UI && window.UI.renderAll) { try { window.UI.renderAll(); } catch (e) { /* 忽略渲染异常 */ } }
    if (window.UI && window.UI.addLog) window.UI.addLog(`教学补给到账（${taskId}）：${added.join('、')}`);
    if (window.UI && window.UI.showToast) {
      try { window.UI.showToast('教学补给到账', added.join('、') + ' —— 这一关的钥匙已备好'); } catch (e) { /* 忽略 */ }
    }
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

  // 教学副宠：创建 + 特质 + 存档（有 cloudId 才能被合成/涅槃/魂铸）
  async function grantPet(g) {
    const Pet = window.Pet;
    if (!Pet || !Pet.createPet) return;
    // 幂等：账号名下已有同名教学副宠（登录时云端宠物已全量在本地列表）→ 不再重复发。
    // 血泪：补发标记曾只存 localStorage，清缓存/换设备就丢 → checkGuide 每登一次重发一只，
    // 云端一路 INSERT 出 N 只同款「泥沼从者」。这里按名挡一层，并把已存在的重复旧档顺手清掉。
    const same = (Pet.getPets ? Pet.getPets() : []).filter(p => p && p.name === g.name);
    if (same.length) {
      if (same.length > 1) {
        // 自愈：只留一只（优先有 cloudId 的正式档，否则最早那只），其余删云端+本地
        const keep = same.find(p => p.cloudId) || same[0];
        const supabase = window.Supabase;
        let cleaned = 0;
        for (const d of same) {
          if (d === keep) continue;
          try {
            if (d.cloudId && supabase && supabase.deletePet) {
              const r = await supabase.deletePet(d.cloudId);
              if (r && r.error) { console.warn('[guide] 删除重复教学副宠云端失败', d.cloudId, r.error); continue; }
            }
            Pet.removePet(d.id);
            cleaned++;
          } catch (e) { console.warn('[guide] 清理重复教学副宠异常', e); }
        }
        if (cleaned > 0) console.warn(`[guide] 教学副宠重复，已自动清理 ${cleaned} 只，保留 ${keep.name}`);
      }
      return;
    }
    const base = (Config.pet.starters || []).find(s => s.name === g.baseName);
    const B = Config.pet.legacyBase || {};
    const pet = Pet.createPet(g.name || g.baseName, (base && base.icon) || '',
      g.growth || 5, (base && base.baseHp) || B.hp || 100, (base && base.baseAtk) || B.atk || 20,
      (base && base.baseDef) || B.def || 10, (Config.pet.speeds && Config.pet.speeds[g.baseName]) || B.spd || 40, g.baseName || '腐噜兽');
    pet.level = g.level || 1;
    if (g.traits && g.traits.length) {
      pet.traits = g.traits.map(id => ({ id, tier: 2 }));
    } else if (Pet.rollPetTraits) {
      Pet.rollPetTraits(pet, {});
    }
    Pet.addPet(pet);
    const supabase = window.Supabase;
    if (supabase && supabase.savePet) {
      try {
        const { data, error } = await supabase.savePet(pet);
        if (!error && data && data.id) pet.cloudId = data.id;
        else if (error) console.warn('[guide] 教学副宠云端建档失败', error);
      } catch (e) {
        // 存档失败不抛：本地已在（applyGrantsFor 已先落「已发」标记），下次同名幂等会跳过，不会叠宠
        console.warn('[guide] 教学副宠云端建档异常', e);
      }
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
   * 持久化：本地即时生效 + 逐只 savePet 云端（失败只提示不回滚）。 */
  async function boostGuidePetToLevel(target) {
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
      if (Supabase && Supabase.savePet) {
        try { await Supabase.savePet(pet); }
        catch (e) { console.warn('[guide] 引导经验包等级云端存档失败', e); }
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

  /* ---------- 引导驱动核心：登录后 / 定时调用 ----------
   * 1) 有未完成的引导任务 → 发教学补给 + 按任务 boostLevel 顶出战宠等级（引导经验包）
   * 2) 已激活的 buff 超时 → 自动退出（兜底；加速只由道具「引导祝福」触发）
   * 3) 引导段全部完成 → 退加速 + 发毕业礼包（仅一次，跳过的账号不发） */
  async function checkGuide() {
    if (!TM().enabled) return;
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
      // buff 已激活且超时 → 自动关（玩家用完 30 分钟恢复正式节奏）
      if (active && buffExpired()) exit();
      // 引导经验包：把名下所有宠顶到本任务的等级门槛
      // （进化 Lv10 / 合成 Lv40 两只都要 / 涅槃 Lv60 两只都要 —— 只顶出战宠会卡在融合）
      if (task.boostLevel) await boostGuidePetToLevel(task.boostLevel);
      // 教学补给 = 按库存差量补齐这一关的钥匙（幂等自愈，不依赖任何"已发"标记）
      await applyGrantsFor(task.id);
      return;
    }
    // 引导段全完成
    if (active) exit();
    // 只有"真正走过引导"的账号才发礼包（Q6 修复：老账号自动完成新手链 → 不再白拿）
    if (readStarted() && !hasClaimedPack()) {
      // 只对"完整走完引导"的账号发：跳过引导时 Quest.skipGuide 会把引导段全标完成，
      // 这里会误判成"完成"。所以跳过的账号要打标记（见 markSkipped）。
      const sk = readSkipped();
      if (!sk) {
        // 记账先行：先把「已领」落到本地 + 云端，再发货。中途断网 → 最多少拿一次，绝不重复拿。
        try { await markClaimedPack(); } catch (e) { console.warn('[guide] 礼包已领标记云端落盘失败', e); }
        await grantStarterPack();
      }
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
    hasClaimedPack, markClaimedPack, checkGuide, applyGrantsFor, grantStarterPack, markSkipped,
    hasBlessing, useBlessing, blessingActive, blessingRemainSec, grantInitialBlessing,
    startGuideRoutine,
    boostGuidePetToLevel   // 引导经验包：把出战宠顶到指定等级（教学期等级门槛专用）
  };
})();
